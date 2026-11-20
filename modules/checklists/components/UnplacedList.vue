<!--
  Not placed tab of the curator page (CuratorPage.vue): the records of
  public/checklists/unplaced.json, one section per kind of reason.

  Sections come from placement/overview.js groupUnplaced: the exact reason
  texts of one kind ('spans several countries: Indonesia 72%, ...') are
  listed under one heading with their counts. A section's records are fetched
  only when it is opened, 50 at a time ("Load more"):
    AD     one call per 50: GET /asserted_distributions, asserted_distribution_id[]=…,
           extend[]=asserted_distribution_shape (live.js fetchDistributionsByIds)
    CO/FO  GET /collection_objects/:id/dwc or /field_occurrences/:id/dwc, one
           each, at most 6 at once (panels/_shared/concurrencyPool.js mapPool)
  Each row: the record (TaxonWorks edit link), its name, its area or DwC
  locality, and the exact reason when the section has more than one. Clicking
  a row opens it in the lookup tab.

  Props
    loadUnplaced  () => Promise<unplaced.json>
  Emits
    lookup ('CO 1380041')
-->
<template>
  <section class="flex flex-col gap-3">
    <p
      v-if="error"
      class="text-sm"
      role="status"
    >
      {{ error }}
    </p>
    <p
      v-else-if="!sections"
      class="text-sm"
      role="status"
    >
      Loading
    </p>
    <template v-else>
      <p class="text-sm">
        {{ total }} records the build could not place, by reason. Open a reason to load its records.
      </p>
      <details
        v-for="section in sections"
        :key="section.kind"
        class="rounded-md border border-base-border bg-base-foreground"
        @toggle="(event) => event.target.open && openSection(section)"
      >
        <summary class="cursor-pointer px-3 py-2 text-sm font-semibold">
          {{ section.kind }} <span class="font-normal">({{ section.count }})</span>
        </summary>
        <div class="flex flex-col gap-2 px-3 pb-3 text-sm">
          <ul
            v-if="section.variants.length > 1"
            class="flex flex-col gap-0.5"
          >
            <li
              v-for="variant in section.variants"
              :key="variant.reason"
            >
              {{ variant.reason }} ({{ variant.count }})
            </li>
          </ul>

          <div
            v-if="state[section.kind]?.rows.length"
            class="overflow-x-auto"
          >
            <table class="w-full border-collapse text-left">
              <thead>
                <tr class="border-b border-base-border">
                  <th class="py-1.5 pr-3 font-semibold">Record</th>
                  <th class="py-1.5 pr-3 font-semibold">Name</th>
                  <th class="py-1.5 pr-3 font-semibold">Place</th>
                  <th
                    v-if="section.variants.length > 1"
                    class="py-1.5 font-semibold"
                  >
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in state[section.kind].rows"
                  :key="row.key"
                  class="cursor-pointer border-b border-base-muted align-top hover:bg-base-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  tabindex="0"
                  :title="`Look up ${row.key}`"
                  @click="emit('lookup', row.key)"
                  @keydown.enter="emit('lookup', row.key)"
                >
                  <td class="whitespace-nowrap py-1 pr-3">
                    <a
                      :href="row.editUrl"
                      target="_blank"
                      rel="noopener"
                      class="text-secondary hover:underline"
                      @click.stop
                    >{{ row.key }}</a>
                  </td>
                  <td class="py-1 pr-3">
                    {{ row.name }}
                  </td>
                  <td class="py-1 pr-3">
                    {{ row.place }}
                  </td>
                  <td
                    v-if="section.variants.length > 1"
                    class="py-1"
                  >
                    {{ row.reason }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p
            v-if="state[section.kind]?.error"
            role="status"
          >
            {{ state[section.kind].error }}
          </p>
          <p
            v-if="state[section.kind]?.loading"
            role="status"
          >
            Loading records
          </p>
          <div
            v-else-if="state[section.kind] && state[section.kind].rows.length < section.records.length"
            class="flex items-center gap-3"
          >
            <button
              type="button"
              class="rounded-md border border-base-border px-3 py-1 font-semibold text-base-content hover:text-secondary"
              @click="loadPage(section)"
            >
              Load more
            </button>
            <span>{{ state[section.kind].rows.length }} of {{ section.records.length }} shown</span>
          </div>
        </div>
      </details>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import { groupUnplaced } from '../placement/overview.js'
import { fetchDistributionsByIds, plainLabel } from '../placement/live.js'
import { mapPool } from '../../../panels/_shared/concurrencyPool.js'
import { twEditUrl } from '../../../panels/_shared/curatorMode/curatorMode.js'

const props = defineProps({
  loadUnplaced: { type: Function, required: true }
})

const emit = defineEmits(['lookup'])

const PAGE = 50
const EDIT = { AD: twEditUrl.assertedDistribution, CO: twEditUrl.collectionObject, FO: twEditUrl.fieldOccurrence }

const sections = shallowRef(null)
const error = ref('')
// Per section kind: { rows, loading, error }.
const state = reactive({})
const total = computed(() => (sections.value ?? []).reduce((sum, section) => sum + section.count, 0))

onMounted(async () => {
  try {
    sections.value = groupUnplaced(await props.loadUnplaced())
  } catch (failure) {
    error.value = `Could not load unplaced.json: ${failure?.message || failure}`
  }
})

function openSection(section) {
  if (!state[section.kind]) {
    state[section.kind] = { rows: [], loading: false, error: '' }
    loadPage(section)
  }
}

async function loadPage(section) {
  const entry = state[section.kind]
  if (entry.loading) return
  entry.loading = true
  entry.error = ''
  try {
    const page = section.records.slice(entry.rows.length, entry.rows.length + PAGE)
    const found = new Map()
    const ads = page.filter((record) => record.kind === 'AD').map((record) => record.id)
    if (ads.length) {
      for (const [id, ad] of await fetchDistributionsByIds(ads)) {
        const area = ad.asserted_distribution_shape
        found.set(`AD ${id}`, {
          name: plainLabel(ad.asserted_distribution_object?.object_tag),
          place: area ? `${area.name} (${ad.asserted_distribution_shape_type === 'Gazetteer' ? 'GZ' : 'GA'} ${area.id})` : 'no area'
        })
      }
    }
    await mapPool(page.filter((record) => record.kind !== 'AD'), 6, async ({ kind, id }) => {
      const path = kind === 'CO' ? `/collection_objects/${id}/dwc` : `/field_occurrences/${id}/dwc`
      try {
        const { data } = await makeAPIRequest.get(path)
        const place = [data.country, data.stateProvince, data.county, data.verbatimLocality || data.locality]
          .filter((value) => String(value ?? '').trim()).join(', ')
        found.set(`${kind} ${id}`, { name: data.scientificName || '', place: place || 'no locality' })
      } catch {
        found.set(`${kind} ${id}`, { name: '', place: 'could not load from TaxonWorks' })
      }
    })
    entry.rows = [...entry.rows, ...page.map(({ kind, id, reason }) => ({
      key: `${kind} ${id}`,
      editUrl: EDIT[kind](id),
      reason,
      ...(found.get(`${kind} ${id}`) ?? { name: '', place: 'not in TaxonWorks any more' })
    }))]
  } catch (failure) {
    entry.error = `Could not load the records: ${failure?.message || failure}`
  } finally {
    entry.loading = false
  }
}
</script>
