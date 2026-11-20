<!--
  Not placed tab of the curator page (CuratorPage.vue): the records of
  public/checklists/unplaced.json the build could not place (R53).

  One section per kind of reason (placement/overview.js unplacedSections:
  spans several countries, no usable outline, no checklist for a country,
  ...), with its record count and its number of areas (or countries). Under
  it one line per area: the area's name with its key (GA or GZ, a TaxonWorks
  link), the reason detail for that area (the measured shares, no date) and
  its record count, largest first. Records without an area (specimens and
  field occurrences) have one line per DwC country text instead ("no
  country"). The reasons "locality text only" and "no locality at all" come
  last, closed, after a note.

  A line opens (button, aria-expanded) to its records, fetched only then, 50
  at a time ("Load more"):
    AD     one call per 50: GET /asserted_distributions, asserted_distribution_id[]=…
           (live.js fetchDistributionsByIds)
    CO/FO  GET /collection_objects/:id/dwc or /field_occurrences/:id/dwc, one
           each, at most 6 at once (panels/_shared/concurrencyPool.js mapPool)
  Each record: its id (TaxonWorks edit link, copy button) and its name.
  Clicking a record opens it in the lookup tab.

  Props
    loadUnplaced  () => Promise<unplaced.json>
    loadAreas     () => Promise<areas.json>, for the names of the areas
  Emits
    lookup ('CO 1380041')
-->
<template>
  <section class="flex flex-col gap-3 text-sm">
    <p
      v-if="error"
      role="status"
    >
      {{ error }}
    </p>
    <p
      v-else-if="!sections"
      role="status"
    >
      Loading
    </p>
    <template v-else>
      <p>{{ total }} records the build could not place, by reason and by area. Open an area to see its records.</p>

      <template
        v-for="section in sections"
        :key="section.kind"
      >
        <p
          v-if="section.kind === firstLocalityKind"
          class="mt-2"
        >
          The records below have collecting events without a georeference or area, so nothing places them. Fix them in TaxonWorks when convenient.
        </p>
        <details
          class="rounded-md border border-base-border bg-base-foreground"
          :open="!section.locality"
        >
          <summary class="cursor-pointer px-3 py-2 font-semibold">
            {{ section.kind }}
            <span class="font-normal">({{ sectionCounts(section) }})</span>
          </summary>
          <ul class="flex flex-col px-3 pb-3">
            <li
              v-for="line in section.lines"
              :key="line.key"
              class="border-t border-base-muted py-1.5"
            >
              <div class="flex flex-wrap items-baseline gap-x-2">
                <button
                  type="button"
                  class="w-5 shrink-0 text-center"
                  :aria-expanded="isOpen(section, line)"
                  :aria-controls="panelId(section, line)"
                  :aria-label="`${isOpen(section, line) ? 'Hide' : 'Show'} the records of ${line.label}`"
                  @click="toggle(section, line)"
                >
                  {{ isOpen(section, line) ? '▾' : '▸' }}
                </button>
                <span class="font-medium">{{ line.label }}</span>
                <a
                  v-if="line.area"
                  :href="areaUrl(line.area)"
                  target="_blank"
                  rel="noopener"
                  class="text-secondary hover:underline"
                >({{ line.area }})</a>
                <span v-if="line.detail && line.detail !== line.label">{{ line.detail }}</span>
                <span>{{ line.count }} {{ line.count === 1 ? 'record' : 'records' }}</span>
              </div>

              <div
                v-if="isOpen(section, line)"
                :id="panelId(section, line)"
                class="ml-7 mt-1 flex flex-col gap-1"
              >
                <ul v-if="state[stateKey(section, line)]?.rows.length">
                  <li
                    v-for="row in state[stateKey(section, line)].rows"
                    :key="row.key"
                    class="flex cursor-pointer flex-wrap items-baseline gap-x-2 rounded py-0.5 hover:bg-base-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    tabindex="0"
                    :title="`Look up ${row.key}`"
                    @click="emit('lookup', row.key)"
                    @keydown.enter="emit('lookup', row.key)"
                  >
                    <span class="whitespace-nowrap">
                      <a
                        :href="row.editUrl"
                        target="_blank"
                        rel="noopener"
                        class="text-secondary hover:underline"
                        @click.stop
                      >{{ row.key }}</a>
                      <CopyId :text="row.key" />
                    </span>
                    <span>{{ row.name }}</span>
                  </li>
                </ul>
                <p
                  v-if="state[stateKey(section, line)]?.error"
                  role="status"
                >
                  {{ state[stateKey(section, line)].error }}
                </p>
                <p
                  v-if="state[stateKey(section, line)]?.loading"
                  role="status"
                >
                  Loading records
                </p>
                <div
                  v-else-if="state[stateKey(section, line)] && state[stateKey(section, line)].rows.length < line.records.length"
                  class="flex items-center gap-3"
                >
                  <button
                    type="button"
                    class="rounded-md border border-base-border px-3 py-1 font-semibold text-base-content hover:text-secondary"
                    @click="loadPage(section, line)"
                  >
                    Load more
                  </button>
                  <span>{{ state[stateKey(section, line)].rows.length }} of {{ line.records.length }} shown</span>
                </div>
              </div>
            </li>
          </ul>
        </details>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import { unplacedSections } from '../placement/overview.js'
import { fetchDistributionsByIds, plainLabel } from '../placement/live.js'
import { mapPool } from '../../../panels/_shared/concurrencyPool.js'
import { twEditUrl, twRecordUrl } from '../../../panels/_shared/curatorMode/curatorMode.js'
import CopyId from './CopyId.vue'

const props = defineProps({
  loadUnplaced: { type: Function, required: true },
  loadAreas: { type: Function, default: null }
})

const emit = defineEmits(['lookup'])

const PAGE = 50
const EDIT = { AD: twEditUrl.assertedDistribution, CO: twEditUrl.collectionObject, FO: twEditUrl.fieldOccurrence }

const sections = shallowRef(null)
const error = ref('')
// Per line ('<kind>|<line key>'): { open, rows, loading, error }.
const state = reactive({})
const total = computed(() => (sections.value ?? []).reduce((sum, section) => sum + section.count, 0))
const firstLocalityKind = computed(() => (sections.value ?? []).find((section) => section.locality)?.kind ?? null)

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
// '152 records, 21 areas', '2478 records, 3 countries'.
function sectionCounts(section) {
  const parts = [plural(section.count, 'record')]
  if (section.areas) parts.push(plural(section.areas, 'area'))
  if (section.countries) parts.push(plural(section.countries, 'country', 'countries'))
  return parts.join(', ')
}

const stateKey = (section, line) => `${section.kind}|${line.key}`
const panelId = (section, line) => `unplaced-${[section.kind, line.key].join('-').replace(/[^A-Za-z0-9]+/g, '-')}`
const isOpen = (section, line) => Boolean(state[stateKey(section, line)]?.open)

function areaUrl(key) {
  const [kind, id] = key.split(' ')
  return twRecordUrl(kind === 'GZ' ? `/gazetteers/${id}` : `/geographic_areas/${id}`)
}

onMounted(async () => {
  try {
    const [unplaced, areas] = await Promise.all([props.loadUnplaced(), props.loadAreas ? props.loadAreas().catch(() => []) : []])
    sections.value = unplacedSections(unplaced, new Map((areas ?? []).map((row) => [row.key, row.name])))
  } catch (failure) {
    error.value = `Could not load unplaced.json: ${failure?.message || failure}`
  }
})

function toggle(section, line) {
  const key = stateKey(section, line)
  if (!state[key]) {
    state[key] = { open: true, rows: [], loading: false, error: '' }
    loadPage(section, line)
  } else {
    state[key].open = !state[key].open
  }
}

async function loadPage(section, line) {
  const entry = state[stateKey(section, line)]
  if (entry.loading) return
  entry.loading = true
  entry.error = ''
  try {
    const page = line.records.slice(entry.rows.length, entry.rows.length + PAGE)
    const names = new Map()
    const ads = page.filter((record) => record.kind === 'AD').map((record) => record.id)
    if (ads.length) {
      for (const [id, ad] of await fetchDistributionsByIds(ads)) names.set(`AD ${id}`, plainLabel(ad.asserted_distribution_object?.object_tag))
    }
    await mapPool(page.filter((record) => record.kind !== 'AD'), 6, async ({ kind, id }) => {
      const path = kind === 'CO' ? `/collection_objects/${id}/dwc` : `/field_occurrences/${id}/dwc`
      try {
        const { data } = await makeAPIRequest.get(path)
        names.set(`${kind} ${id}`, data.scientificName || '')
      } catch {
        names.set(`${kind} ${id}`, 'could not load from TaxonWorks')
      }
    })
    entry.rows = [...entry.rows, ...page.map(({ kind, id }) => ({
      key: `${kind} ${id}`,
      editUrl: EDIT[kind](id),
      name: names.get(`${kind} ${id}`) ?? 'not in TaxonWorks any more'
    }))]
  } catch (failure) {
    entry.error = `Could not load the records: ${failure?.message || failure}`
  } finally {
    entry.loading = false
  }
}
</script>
