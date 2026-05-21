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
import PanelDropdown from '@/modules/otus/components/Panel/PanelDropdown.vue'
import { useOtuPageRequestStore } from '@/modules/otus/store/request'

const GBIF_OCCURRENCE_SEARCH = 'https://api.gbif.org/v1/occurrence/search'
const PAGE_SIZE = 10
const TYPE_RANKS = new Set(['SPECIES', 'GENUS'])
const TYPE_STATUSES = [
  'Paratype',
  'Holotype',
  'Type',
  'Isotype',
  'Syntype',
  'OriginalMaterial',
  'Lectotype',
  'Isolectotype',
  'Paralectotype',
  'Isosyntype',
  'Plastoisotype',
  'Plastoneotype',
  'Exsyntype',
  'Exneotype',
  'Exlectotype',
  'Exepitype',
  'Plastolectotype',
  'Exparatype',
  'Allolectotype',
  'Exisotype',
  'Exholotype',
  'Plastosyntype',
  'Clonotype',
  'SupplementaryType',
  'Plastoparatype',
  'Metatype',
  'Hapantotype',
  'Isoepitype',
  'Plastotype',
  'Plastoholotype',
  'Paraneotype',
  'Extype',
  'Alloneotype',
  'Isoparatype',
  'Paratopotype',
  'Epitype',
  'Plesiotype',
  'Isoneotype',
  'SecondaryType',
  'TypeStrain',
  'TypeSeries',
  'Homeotype',
  'Neotype',
  'Cotype',
  'Topotype',
  'Allotype',
  'Hypotype',
  'Iconotype'
]

const props = defineProps({
  otuId: { type: [Number, String], required: true },
  taxonId: { type: [Number, String], required: true },
  taxon: { type: Object, default: undefined },
  otu: { type: Object, default: undefined }
})

const scientificName = computed(() => deriveScientificName(props.taxon, props.otu))
const { targetUsage, gbifKey } = useGbifMatch(scientificName)

const results = ref([])
const totalCount = ref(0)
const page = ref(0)
const loading = ref(false)

const isEligible = computed(() => TYPE_RANKS.has(targetUsage.value?.rank))

const totalPages = computed(() =>
  Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE))
)

const requestStore = useOtuPageRequestStore()

async function fetchPage(taxonKey, pageIndex) {
  loading.value = true

  const url = new URL(GBIF_OCCURRENCE_SEARCH)
  url.searchParams.set('checklistKey', CHECKLIST_KEY)
  url.searchParams.set('taxonKey', taxonKey)
  url.searchParams.set('limit', String(PAGE_SIZE))
  url.searchParams.set('offset', String(pageIndex * PAGE_SIZE))
  TYPE_STATUSES.forEach((s) => url.searchParams.append('typeStatus', s))
  const requestUrl = url.toString()

  try {
    const res = await fetch(requestUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    results.value = data?.results || []
    totalCount.value = typeof data?.count === 'number' ? data.count : 0
    recordRequest(requestStore, 'panel:gbif-type-specimens', {
      url: requestUrl,
      data
    })
  } catch (e) {
    results.value = []
    totalCount.value = 0
    recordRequest(requestStore, 'panel:gbif-type-specimens', {
      url: requestUrl,
      data: null
    })
  } finally {
    loading.value = false
  }
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
      fetchPage(key, 0)
    } else {
      results.value = []
      totalCount.value = 0
    }
  },
  { immediate: true }
)

watch(page, (p) => {
  if (gbifKey.value && isEligible.value) fetchPage(gbifKey.value, p)
})
</script>
