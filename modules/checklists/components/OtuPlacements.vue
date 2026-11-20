<!--
  OTU tab of the curator page (CuratorPage.vue): every record of one OTU,
  placed live, in one table.

  Purpose: a curator picks an OTU and sees at once where each of its asserted
  distributions, specimens and field occurrences lands, which are not placed
  and why, and which differ from the cache (the build is older than the data).

  Props
    otuId   the OTU (?otu= in the address), null for none
    cache   the page's cache loaders (CuratorPage.vue `cache`): context, index,
            unplaced, countryRecords; each fetched once per visit
    built   the build date (index.json updated), for the "differs" line
  Emits
    select-otu (id)    an OTU was picked in the search; the page puts it into ?otu=
    lookup ('AD 123')  a row was clicked; the page opens it in the lookup tab

  Data (placement/live.js)
    GET /otus/:id?extend[]=parents    name, taxon name and parents
    GET /taxon_names/:id              rank: the build leaves out the distributions
                                      of an OTU above species or outside
                                      Curculionoidea (live.js otuLeftOut)
    fetchOtuDistributions             GET /asserted_distributions, otu_id[], per=500, paged
    fetchOtuSpecimens                 GET /dwc_occurrences by taxon name and kind (CSV when paged),
                                      rows of this OTU only
  Each record is placed with placeLive in the engine context of the cache files
  (geometry-browser.js loadCacheContext), so the result equals the build's.
  The Source column lists every source that contributed to the row's
  placement (country, part, state, outline; overview.js sourceTags, R43), each
  rules line a link to the Rules tab; every record id has a copy button
  (CopyId.vue).
  Only the OTU's own records: no synonyms, no subordinate taxa.
-->
<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <span class="block text-sm font-semibold">OTU</span>
      <div class="w-full sm:max-w-md">
        <Autocomplete
          url="/otus/autocomplete"
          query-param="term"
          label="label_html"
          placeholder="Search for an OTU"
          :params="{ having_taxon_name_only: true }"
          @select="(item) => emit('select-otu', item.id)"
        />
      </div>
      <p class="text-sm text-base-soft">
        Only this OTU's own records: its asserted distributions, specimens and field occurrences, not those of synonyms or subordinate taxa.
      </p>
    </div>

    <p
      v-if="!otuId"
      class="text-sm"
    >
      Pick an OTU to see where each of its records is placed.
    </p>

    <template v-else>
      <p
        v-if="otu"
        class="text-sm"
      >
        <span class="font-semibold">{{ otu.label }}</span>
        <a
          :href="twOtuUrl(otu.id)"
          target="_blank"
          rel="noopener"
          class="ml-2 text-secondary hover:underline"
        >OTU {{ otu.id }} in TaxonWorks</a>
      </p>

      <p
        v-if="error"
        class="rounded-md border border-warning bg-base-foreground px-3 py-2 text-sm"
        role="status"
      >
        {{ error }}
      </p>
      <p
        v-else-if="progress"
        class="text-sm"
        role="status"
      >
        {{ progress }}
      </p>

      <template v-else-if="rows">
        <p class="text-sm font-semibold">
          {{ summary }}
        </p>
        <p
          v-if="specimensNote"
          class="text-sm"
        >
          {{ specimensNote }}
        </p>
        <p
          v-if="differing"
          class="text-sm font-semibold"
        >
          {{ differing }} {{ differing === 1 ? 'record differs' : 'records differ' }} from the cache (built {{ built }}): rebuild the checklists to update.
        </p>

        <div
          v-if="rows.length"
          class="overflow-x-auto"
        >
          <table class="w-full border-collapse text-left text-sm">
            <thead>
              <tr class="border-b border-base-border">
                <th class="py-2 pr-3 font-semibold">Record</th>
                <th class="py-2 pr-3 font-semibold">Place</th>
                <th class="py-2 pr-3 font-semibold">Checklist</th>
                <th class="py-2 pr-3 font-semibold">Source</th>
                <th class="py-2 font-semibold">Cache</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.key"
                class="cursor-pointer border-b border-base-muted align-top hover:bg-base-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                tabindex="0"
                :title="`Look up ${row.key}`"
                @click="emit('lookup', row.key)"
                @keydown.enter="emit('lookup', row.key)"
              >
                <td class="whitespace-nowrap py-1.5 pr-3">
                  <a
                    :href="row.editUrl"
                    target="_blank"
                    rel="noopener"
                    class="text-secondary hover:underline"
                    @click.stop
                  >{{ row.key }}</a>
                  <CopyId :text="row.key" />
                </td>
                <td class="py-1.5 pr-3">
                  <a
                    v-if="row.place.href"
                    :href="row.place.href"
                    target="_blank"
                    rel="noopener"
                    class="hover:text-secondary hover:underline"
                    @click.stop
                  >{{ row.place.text }}</a>
                  <template v-else>
                    {{ row.place.text }}
                  </template>
                </td>
                <td
                  class="py-1.5 pr-3"
                  :class="row.leftOut ? '' : row.decision.problem ? 'font-semibold text-danger' : ''"
                >
                  {{ row.leftOut ? `${row.leftOut} (not in checklists)` : row.decision.text }}
                </td>
                <td class="py-1.5 pr-3 font-mono text-xs">
                  <template v-if="!row.leftOut">
                    <RefText
                      v-for="tag in row.sources"
                      :key="tag"
                      class="mr-1 inline-block whitespace-nowrap"
                      :text="tag"
                    />
                  </template>
                </td>
                <td class="whitespace-nowrap py-1.5 font-semibold">
                  {{ row.differs ? 'differs' : '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import {
  fetchOtuDistributions, fetchOtuSpecimens, fromDistribution, fromDwcRow, placeLive, recordLeftOut, otuLeftOut, plainLabel
} from '../placement/live.js'
import { decisionOf, summarizeOtu, cachedPlacement, differsFromCache, sourceTags } from '../placement/overview.js'
import CopyId from './CopyId.vue'
import RefText from './RefText.vue'
import { twEditUrl, twRecordUrl, twOtuUrl } from '../../../panels/_shared/curatorMode/curatorMode.js'

const props = defineProps({
  otuId: { type: Number, default: null },
  cache: { type: Object, required: true },
  built: { type: String, default: '' }
})

const emit = defineEmits(['select-otu', 'lookup'])

const otu = ref(null)
const rows = shallowRef(null)
const progress = ref('')
const error = ref('')

// Why specimens are not loaded, '' when they are.
const specimensNote = computed(() => {
  if (!otu.value) return ''
  if (!otu.value.taxonNameId) return 'Specimens not loaded: this OTU has no taxon name.'
  if (otu.value.leftOut) return `Specimens not loaded: the build leaves out the records of this OTU (${otu.value.leftOut}).`
  return ''
})
const summary = computed(() => summarizeOtu(rows.value ?? []))
const differing = computed(() => (rows.value ?? []).filter((row) => row.differs).length)

const EDIT = { AD: twEditUrl.assertedDistribution, CO: twEditUrl.collectionObject, FO: twEditUrl.fieldOccurrence }
const KIND_ORDER = { AD: 0, CO: 1, FO: 2 }

let run = 0
watch(() => props.otuId, (id) => { if (id) load(id) }, { immediate: true })

async function load(id) {
  const current = ++run
  const stale = () => current !== run
  otu.value = null
  rows.value = null
  error.value = ''
  progress.value = 'Loading the OTU'
  try {
    const { data } = await makeAPIRequest.get(`/otus/${id}`, { params: { extend: ['parents'] } })
    const taxonNameId = data.taxon_name_id ?? null
    const rank = taxonNameId ? (await makeAPIRequest.get(`/taxon_names/${taxonNameId}`)).data.rank ?? null : null
    if (stale()) return
    otu.value = {
      id,
      label: plainLabel(data.object_tag) || data.name || `OTU ${id}`,
      taxonNameId,
      leftOut: otuLeftOut({ rank, parentNames: Object.keys(data.parents ?? {}) })
    }

    progress.value = 'Loading records from TaxonWorks'
    const [distributions, specimens, { ctx }] = await Promise.all([
      fetchOtuDistributions(id, undefined, {
        onProgress: (loaded, total) => {
          if (!stale()) progress.value = `Loading asserted distributions: ${loaded}${total ? ` of ${total}` : ''}`
        }
      }),
      // Not for an OTU the build leaves out: above species the DwC index of the
      // taxon name is the whole subtree (all Curculionidae for the family), and
      // the records of a host plant are not in any checklist either.
      specimensNote.value ? [] : fetchOtuSpecimens(otu.value),
      props.cache.context()
    ])
    if (stale()) return

    const lives = [...distributions.map(fromDistribution), ...specimens.map(fromDwcRow)]
    const placed = []
    for (const [index, live] of lives.entries()) {
      if (index % 25 === 0) progress.value = `Placing ${index + 1} of ${lives.length}`
      placed.push({ live, placement: await placeLive(live, ctx) })
      if (stale()) return
    }

    progress.value = 'Comparing with the cache'
    const built = await comparison(placed.map(({ placement }) => placement))
    if (stale()) return
    rows.value = placed.map(({ live, placement }) => rowOf(live, placement, built)).sort(byProblem)
    progress.value = ''
  } catch (failure) {
    if (stale()) return
    const status = failure?.response?.status
    error.value = status === 404 ? `TaxonWorks has no OTU ${id}.` : `Loading OTU ${id} failed: ${failure?.message || failure}`
    progress.value = ''
  }
}

// The cache files needed to compare: unplaced.json and the country file of
// every checklist a record lands in.
async function comparison(placements) {
  const [index, unplaced] = await Promise.all([props.cache.index(), props.cache.unplaced()])
  const names = [...new Set(placements.filter((p) => p.checklist).map((p) => p.checklist.name))]
  const records = new Map()
  await Promise.all(names.map(async (name) => {
    const entry = index.countries.find((country) => country.name === name)
    records.set(name, entry ? await props.cache.countryRecords(entry.file) : [])
  }))
  return { unplaced, records }
}

function rowOf(live, placement, { unplaced, records }) {
  const { kind, id } = live.subject
  const leftOut = recordLeftOut(live, otu.value.leftOut)
  const name = placement.checklist?.name ?? null
  const cached = cachedPlacement({ kind, id }, { checklistName: name, records: name ? records.get(name) : null, unplaced })
  return {
    key: `${kind} ${id}`,
    kind,
    id,
    editUrl: EDIT[kind](id),
    place: placeOf(live),
    placement,
    decision: decisionOf(placement),
    sources: sourceTags(placement),
    leftOut,
    differs: !leftOut && differsFromCache(placement, cached)
  }
}

function placeOf(live) {
  if (live.area) {
    const path = live.area.kind === 'GZ' ? `/gazetteers/${live.area.id}` : `/geographic_areas/${live.area.id}`
    return { text: `${live.area.name} (${live.area.key})`, href: twRecordUrl(path) }
  }
  if (live.subject.kind === 'AD') return { text: 'no area', href: null }
  const { country, stateProvince, county, locality, lat, lng } = live.record
  const text = [country, stateProvince, county, locality].filter((value) => String(value ?? '').trim()).join(', ')
  const point = String(lat ?? '').trim() && String(lng ?? '').trim() ? ` (${lat}, ${lng})` : ''
  return { text: (text || 'no locality') + point, href: null }
}

// Not placed first, then the others by checklist, records left out last.
function byProblem(a, b) {
  const rank = (row) => (row.leftOut ? 2 : row.decision.problem ? 0 : 1)
  return rank(a) - rank(b) || a.decision.text.localeCompare(b.decision.text) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id
}
</script>
