<template>
  <VCard v-if="isEligible && (loading || results.length)">
    <VCardHeader class="flex items-center gap-3">
      <img
        :src="gbifMark"
        alt="GBIF"
        class="h-8 w-auto shrink-0"
      />
      <h2 class="text-md grow">
        Type specimens via GBIF ({{ totalCount }})
      </h2>
      <PanelDropdown
        panel-key="panel:gbif-type-specimens"
        :menu-options="gbifMenuOptions"
      />
    </VCardHeader>
    <VCardContent class="text-sm">
      <VSpinner
        v-if="loading && !results.length"
        logo-class="w-6 h-6"
        legend=""
      />

      <ul
        v-else
        class="divide-y divide-base-border"
      >
        <li
          v-for="row in results"
          :key="row.key"
          class="py-1"
        >
          <a
            :href="`${GBIF_OCCURRENCE_DETAIL}/${row.key}`"
            target="_blank"
            rel="noopener"
            class="flex flex-wrap items-baseline gap-x-2 hover:underline"
          >
            <span
              class="text-xs uppercase tracking-wide px-1.5 py-0.5 rounded bg-base-foreground border border-base-border shrink-0"
            >
              {{ row.typeStatus }}
            </span>
            <span class="grow">
              {{ row.verbatimScientificName || row.classifications?.[CHECKLIST_KEY]?.usage?.name || '—' }}
            </span>
            <svg
              v-if="hasImage(row)"
              class="w-3.5 h-3.5 shrink-0 self-center opacity-60"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-label="image available"
            >
              <title>image available</title>
              <path
                fill-rule="evenodd"
                d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 8.69 3.36-3.36a.75.75 0 0 1 1.06 0l2.06 2.06 3.72-3.72a.75.75 0 0 1 1.06 0l3.68 3.68V5.25a.75.75 0 0 0-.75-.75H3.25a.75.75 0 0 0-.75.75v8.69ZM6.5 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
                clip-rule="evenodd"
              />
            </svg>
            <span
              v-if="repoLabel(row)"
              class="text-xs opacity-60 shrink-0"
            >
              {{ repoLabel(row) }}
            </span>
            <span
              v-if="row.eventDate"
              class="text-xs opacity-60 shrink-0"
            >
              {{ row.eventDate }}
            </span>
          </a>
        </li>
      </ul>

      <div
        v-if="totalPages > 1"
        class="flex items-center justify-between mt-2 text-xs"
      >
        <button
          type="button"
          @click="prevPage"
          :disabled="page === 0 || loading"
          class="px-2 py-1 rounded border border-base-border disabled:opacity-40 hover:bg-base-foreground"
        >
          ‹ Prev
        </button>
        <span class="opacity-70">
          Page {{ page + 1 }} of {{ totalPages }}
        </span>
        <button
          type="button"
          @click="nextPage"
          :disabled="page >= totalPages - 1 || loading"
          class="px-2 py-1 rounded border border-base-border disabled:opacity-40 hover:bg-base-foreground"
        >
          Next ›
        </button>
      </div>
    </VCardContent>
  </VCard>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  useGbifMatch,
  deriveScientificName,
  recordRequest,
  gbifMenuOptions,
  CHECKLIST_KEY,
  GBIF_OCCURRENCE_DETAIL
} from '../_gbifShared/useGbifMatch'
import gbifMark from '../_gbifShared/gbif-mark.svg'
import { TYPE_STATUSES } from '../_gbifShared/typeStatuses'
import { makeGbifNameFilter, occurrenceName } from '../_gbifShared/gbifNameFilter'
import { resolveGbifTaxonScope } from '../_gbifShared/gbifTaxonScope'
import PanelDropdown from '@/modules/otus/components/Panel/PanelDropdown.vue'
import { useOtuPageRequestStore } from '@/modules/otus/store/request'

const GBIF_OCCURRENCE_SEARCH = 'https://api.gbif.org/v1/occurrence/search'
const PAGE_SIZE = 10
// One fetch, filtered + paginated client-side. Type-specimen records for a
// species and its synonyms don't run into the hundreds.
const FETCH_LIMIT = 300
const TYPE_RANKS = new Set(['SPECIES', 'GENUS'])

const props = defineProps({
  otuId: { type: [Number, String], required: true },
  taxonId: { type: [Number, String], required: true },
  taxon: { type: Object, default: undefined },
  otu: { type: Object, default: undefined }
})

const scientificName = computed(() => deriveScientificName(props.taxon, props.otu))
const { match, targetUsage, gbifKey } = useGbifMatch(scientificName)

const allResults = ref([]) // name-filtered, full set
const page = ref(0)
const loading = ref(false)

const results = computed(() =>
  allResults.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE)
)
const totalCount = computed(() => allResults.value.length)

// TYPE_RANKS gates by the matched rank, but a species absent from CoL resolves
// via matchType HIGHERRANK to its genus — that genus key would then list every
// type specimen in the genus as if it were this species'. Exclude that case.
const isEligible = computed(
  () =>
    TYPE_RANKS.has(targetUsage.value?.rank) &&
    match.value?.diagnostics?.matchType !== 'HIGHERRANK'
)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE))
)

const requestStore = useOtuPageRequestStore()

// GBIF (via CoL) may lump what TaxonWorks splits — a `taxonKey` rollup lists a
// neighbouring species' type as this one's — while conversely a TW synonym may
// carry its own GBIF key the accepted key doesn't reach. So: OR every key for
// the accepted name + all TW synonyms, then keep only records whose identified
// name is in that same name set.
async function fetchAll() {
  const forName = scientificName.value // guard against stale OTU navigation
  loading.value = true

  const { names, keys } = await resolveGbifTaxonScope(
    scientificName.value,
    props.taxonId,
    { rejectHigherRank: true }
  )
  if (!keys.length) {
    allResults.value = []
    loading.value = false
    recordRequest(requestStore, 'panel:gbif-type-specimens', { url: '', data: null })
    return
  }

  const url = new URL(GBIF_OCCURRENCE_SEARCH)
  url.searchParams.set('checklistKey', CHECKLIST_KEY)
  keys.forEach((k) => url.searchParams.append('taxonKey', k))
  url.searchParams.set('limit', String(FETCH_LIMIT))
  TYPE_STATUSES.forEach((s) => url.searchParams.append('typeStatus', s))
  const requestUrl = url.toString()

  try {
    const res = await fetch(requestUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    if (scientificName.value !== forName) return // navigated away mid-flight
    const nameOk = makeGbifNameFilter(names)
    const seen = new Set()
    allResults.value = (data?.results || []).filter((r) => {
      if (!nameOk(occurrenceName(r, CHECKLIST_KEY))) return false
      if (seen.has(r.key)) return false
      seen.add(r.key)
      return true
    })
    recordRequest(requestStore, 'panel:gbif-type-specimens', {
      url: requestUrl,
      data
    })
  } catch (e) {
    if (scientificName.value === forName) allResults.value = []
    recordRequest(requestStore, 'panel:gbif-type-specimens', {
      url: requestUrl,
      data: null
    })
  } finally {
    if (scientificName.value === forName) loading.value = false
  }
}

// Repository where the specimen sits: institution + collection code (deduped).
function repoLabel(row) {
  return [row.institutionCode, row.collectionCode]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' · ')
}

function hasImage(row) {
  return (row.media || []).some((m) => !m.type || m.type === 'StillImage')
}

function prevPage() {
  if (page.value > 0) page.value -= 1
}

function nextPage() {
  if (page.value < totalPages.value - 1) page.value += 1
}

watch(
  [gbifKey, isEligible],
  ([key, eligible]) => {
    page.value = 0
    if (key && eligible) {
      fetchAll()
    } else {
      allResults.value = []
    }
  },
  { immediate: true }
)
</script>
