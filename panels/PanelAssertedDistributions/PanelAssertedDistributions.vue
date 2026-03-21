<template>
  <VCard>
    <ClientOnly>
      <VSpinner v-if="isLoading" />
    </ClientOnly>
    <VCardHeader>
      Asserted distributions ({{ totalCount }})
    </VCardHeader>
    <VCardContent class="min-h-[6rem] overflow-x-auto">

      <!-- Taxon tabs: only shown when records span multiple OTUs (species + subspecies) -->
      <div
        v-if="showTabs"
        class="flex flex-wrap gap-x-1 mb-4 border-b"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="px-3 py-1.5 text-sm -mb-px border-b-2 transition-colors"
          :class="selectedOtuId === tab.id
            ? 'border-current text-secondary-color font-medium'
            : 'border-transparent opacity-50 hover:opacity-100'"
          @click="selectedOtuId = tab.id"
        >
          <template v-if="tab.id === 'all'">All</template>
          <em v-else>{{ tab.label }}</em>
          <span class="ml-1 text-xs opacity-60">({{ tab.count }})</span>
        </button>
      </div>

      <VTable v-if="groupedDistributions.length">
        <VTableHeader class="normal-case">
          <VTableHeaderRow>
            <VTableHeaderCell>Area</VTableHeaderCell>
            <VTableHeaderCell v-if="isMergedView">Taxa</VTableHeaderCell>
            <VTableHeaderCell>Absent</VTableHeaderCell>
            <VTableHeaderCell>Citation</VTableHeaderCell>
          </VTableHeaderRow>
        </VTableHeader>
        <VTableBody>
          <template
            v-for="group in groupedDistributions"
            :key="group.parent"
          >
            <!-- Group header -->
            <tr>
              <td
                :colspan="isMergedView ? 4 : 3"
                class="px-4 pt-5 pb-1 text-sm font-bold border-b text-base-content"
              >
                {{ group.label }}
                <span class="font-normal opacity-50 ml-1">({{ group.items.length }})</span>
              </td>
            </tr>

            <VTableBodyRow
              v-for="item in group.items"
              :key="item.id"
            >
              <!-- Area name (bold) with type (small, muted).
                   Always a button; GeoJSON is pre-fetched in background. -->
              <VTableBodyCell class="pl-8">
                <button
                  class="font-semibold hover:underline cursor-pointer text-left text-base-content"
                  @click="openMapModal(item)"
                >{{ item.areaName }}</button>
                  <span
                    v-if="item.areaType"
                    class="text-xs opacity-50 ml-1.5"
                  >{{ item.areaType }}</span>
                </VTableBodyCell>

                <!-- Taxa column: OTU names for this area (merged / All tab only) -->
                <VTableBodyCell
                  v-if="isMergedView"
                  class="text-sm"
                >
                  <template
                    v-for="(entry, i) in item.otuEntries"
                    :key="entry.otuId"
                  >
                    <em>{{ entry.otuName }}</em><span v-if="i < item.otuEntries.length - 1">; </span>
                  </template>
                </VTableBodyCell>

                <VTableBodyCell>
                  <span
                    v-if="item.isAbsent"
                    class="text-red-600 text-sm font-medium"
                  >Absent</span>
                </VTableBodyCell>

                <!-- Citations inline, separated by "; " -->
                <VTableBodyCell class="text-sm">
                  <template
                    v-for="(citation, i) in item.citationList"
                    :key="citation.id"
                  >
                    <button
                      class="hover:underline cursor-pointer text-secondary-color"
                      @click="activeCitation = citation"
                      v-html="citation.display"
                    />
                    <span v-if="i < item.citationList.length - 1">; </span>
                  </template>
                </VTableBodyCell>
            </VTableBodyRow>
          </template>
        </VTableBody>
      </VTable>

      <!-- Citation modal: full reference for clicked citation -->
      <Teleport to="body">
        <VModal
          v-if="activeCitation"
          @close="activeCitation = null"
        >
          <template #header>
            <div class="text-sm font-medium">Reference</div>
          </template>
          <div
            class="px-4 pb-4 text-sm leading-relaxed"
            v-html="convertUrlsToLinks(activeCitation.full)"
          />
        </VModal>
      </Teleport>

      <!-- Map modal: geographic area polygon for clicked area name -->
      <Teleport to="body">
        <VModal
          v-if="mapModal.open"
          @close="mapModal = { open: false }"
        >
          <template #header>
            <div class="text-sm font-medium">
              {{ mapModal.areaName }}
            </div>
          </template>
          <div class="p-4">
            <div
              v-if="mapModal.loading"
              class="min-h-[200px] flex items-center justify-center"
            >
              <VSpinner />
            </div>
            <p
              v-else-if="!mapModal.feature"
              class="min-h-[200px] flex items-center justify-center text-sm opacity-50"
            >No map data available for this area.</p>
            <VMap
              v-else
              :geojson="{ type: 'FeatureCollection', features: [mapModal.feature] }"
              height="400px"
            />
          </div>
        </VModal>
      </Teleport>

      <div
        v-if="!isLoading && !groupedDistributions.length"
        class="text-xl text-center my-8 w-full"
      >
        No records found.
      </div>

      <p
        v-if="groupedDistributions.length"
        class="text-xs opacity-50 mt-4 text-center"
      >
        The same distribution data can also be viewed on the map in the Overview panel.<br>
        You can also download a Darwin Core (DwC) spreadsheet with all asserted distributions and specimen records.
      </p>
    </VCardContent>
  </VCard>
</template>

<script setup>
/**
 * PanelAssertedDistributions.vue
 *
 * External panel (setup branch) displaying asserted distributions for an OTU,
 * registered as panel:asserted-distributions.
 *
 * DESCENDANT HANDLING
 * -------------------
 * Uses taxon_name_id[] + descendants=true so that:
 *   - A species page includes records for all its subspecies/varieties.
 *   - A subspecies page includes only its own records (no further descendants).
 * The taxon_name_id comes from props.taxon.id (passed by the framework).
 *
 * TAXON TABS
 * ----------
 * When a species has records spanning multiple OTUs (e.g. the species itself
 * and two subspecies), tabs appear:
 *   "All"  — shows combined records for all OTUs
 *   <each OTU name> — filters to that OTU's records only
 * On subspecies pages (single OTU), no tabs are shown.
 *
 * GROUPING
 * --------
 * Within the selected tab, records are grouped by shape.parent.name:
 *   - parent = "Earth"  → top-level countries/territories ("Countries & Territories")
 *   - parent = anything else → sub-national areas grouped under that parent name
 * Groups sorted: Earth first, then alphabetical. Areas within groups: alphabetical.
 *
 * CITATIONS
 * ---------
 * Two-step fetch (same pattern as PanelBiologicalAssociationsV2):
 *   1. GET /citations?citation_object_type=AssertedDistribution&citation_object_id[]=...
 *      → citation_source_body (short form). Note: the ":pages" suffix reflects
 *      whatever was entered in TaxonWorks' pages field, which may contain a taxon
 *      name rather than a page number (data entry convention in TaxonWorks).
 *   2. GET /sources?source_id[]=...
 *      → source.cached (full HTML reference)
 * Multiple citations per area shown inline, separated by "; ".
 * URLs in the full reference modal are made clickable via convertUrlsToLinks
 * from the built-in bibliography module.
 */

import { computed, onMounted, ref } from 'vue'
import { makeAPIRequest } from '@/utils'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest.js'
import { convertUrlsToLinks } from '@/modules/bibliography/utils/convertUrlsToLinks.js'

const props = defineProps({
  taxon: {
    type: Object,
    required: true
  },

  // Load all at once; descendants=true can multiply record count
  per: {
    type: Number,
    default: 500
  }
})

const distributions = ref([])
const isLoading = ref(false)
const totalCount = ref(0)
const activeCitation = ref(null)
const selectedOtuId = ref('all')


// Map modal state
const mapModal = ref({ open: false })
// Per-OTU GeoJSON promise cache: otuId → Promise<{ assertedDistId → GeoJSON Feature }>
// Caching the promise (not the result) means a click that arrives while a pre-fetch is
// still in-flight reuses the same request rather than starting a duplicate.
const geoPromiseCache = {}

// Show tabs only when records span more than one OTU (e.g. species + subspecies)
const showTabs = computed(() => {
  const unique = new Set(distributions.value.map((d) => d.otuId))
  return unique.size > 1
})

// True when the All tab is active with multiple OTUs — shows merged rows (one per area)
const isMergedView = computed(() => selectedOtuId.value === 'all' && showTabs.value)

// One tab per OTU, sorted by name, prefixed with "All"
const tabs = computed(() => {
  const byOtu = new Map()
  for (const d of distributions.value) {
    if (!byOtu.has(d.otuId)) {
      byOtu.set(d.otuId, { id: d.otuId, label: d.otuName, count: 0 })
    }
    byOtu.get(d.otuId).count++
  }
  const otuTabs = [...byOtu.values()].sort((a, b) =>
    a.label.localeCompare(b.label)
  )
  return [{ id: 'all', label: 'All', count: distributions.value.length }, ...otuTabs]
})

// Distributions visible in the current tab
const filteredDistributions = computed(() => {
  if (selectedOtuId.value === 'all') return distributions.value
  return distributions.value.filter(
    (d) => String(d.otuId) === String(selectedOtuId.value)
  )
})

/**
 * In the All tab (isMergedView), collapses distributions sharing the same
 * geographic area into a single row: one entry per area listing all taxa
 * (otuEntries) and all citations merged together.
 * In per-OTU tabs, returns the distributions as-is.
 *
 * Both produce items compatible with openMapModal(item) — merged items
 * carry `otuId` and `id` from the first distribution for map lookups.
 */
function mergeByArea(dists) {
  const byArea = new Map()
  for (const dist of dists) {
    const key = `${dist.parentName}|${dist.areaName}`
    if (!byArea.has(key)) {
      byArea.set(key, {
        id: dist.id,           // first dist's ID — used for GeoJSON map lookup
        otuId: dist.otuId,     // first dist's OTU — used for GeoJSON fetch
        areaName: dist.areaName,
        areaType: dist.areaType,
        parentName: dist.parentName,
        isAbsent: false,
        otuEntries: [],
        citationList: []
      })
    }
    const m = byArea.get(key)
    m.isAbsent = m.isAbsent || dist.isAbsent
    if (!m.otuEntries.some((e) => e.otuId === dist.otuId)) {
      m.otuEntries.push({ otuId: dist.otuId, otuName: dist.otuName })
    }
    m.citationList.push(...dist.citationList)
  }
  return [...byArea.values()]
}

/**
 * Groups items by parent area name for rendering.
 * Source is merged (one row per area) in the All tab, per-distribution otherwise.
 * Earth-children (countries) come first, then sub-national groups alphabetically.
 * Areas within each group are sorted alphabetically.
 */
const groupedDistributions = computed(() => {
  const source = isMergedView.value
    ? mergeByArea(distributions.value)
    : filteredDistributions.value

  const groups = new Map()

  for (const dist of source) {
    const parent = dist.parentName
    if (!groups.has(parent)) groups.set(parent, [])
    groups.get(parent).push(dist)
  }

  for (const items of groups.values()) {
    items.sort((a, b) => a.areaName.localeCompare(b.areaName))
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === 'Earth') return -1
      if (b === 'Earth') return 1
      return a.localeCompare(b)
    })
    .map(([parent, items]) => ({
      parent,
      label: parent === 'Earth' ? 'Countries & Territories' : parent,
      items
    }))
})

/**
 * Transforms a raw /asserted_distributions item into a display object.
 * Geographic area data is in asserted_distribution_shape (no extend needed).
 */
function makeDistribution(item, citationList) {
  const shape = item.asserted_distribution_shape || {}
  const obj = item.asserted_distribution_object || {}

  return {
    id: item.id,
    otuId: item.asserted_distribution_object_id,
    otuName: obj.taxon_name || '',
    areaName: shape.name || '',
    areaType: shape.geographic_area_type?.name || '',
    parentName: shape.parent?.name || 'Earth',
    isAbsent: !!item.is_absent,
    citationList
  }
}

/**
 * Truncates a citation_source_body string to "First Author et al., Year[:pages]"
 * when three or more authors are present. Two or fewer authors are shown as-is.
 *
 * Detects 3+ authors by checking whether an "&" (joining the last two authors)
 * is preceded by at least one comma (meaning there are additional authors before).
 *
 * Examples:
 *   "Bajtenov, 1974a"              → unchanged (1 author)
 *   "Smith & Jones, 2020"          → unchanged (2 authors)
 *   "Smith, Jones & Brown, 2020"   → "Smith et al., 2020"
 *   "Alonso-Zarazaga, ..., 2023"   → "Alonso-Zarazaga et al., 2023"
 */
function shortCitation(body) {
  if (!body) return ''
  // Match trailing ", YYYY[letter][:pages]" — the year+pages suffix
  const m = body.match(/,\s*(\d{4}[a-z]?(?::[^\s,]+)?)\s*$/)
  if (!m) return body
  const year = m[1]
  const authorsStr = body.slice(0, m.index)
  // 3+ authors: "&" exists AND at least one "," precedes the last "&"
  const ampIdx = authorsStr.lastIndexOf('&')
  if (ampIdx < 0 || !authorsStr.slice(0, ampIdx).includes(',')) return body
  const firstAuthor = authorsStr.split(',')[0].trim()
  return `${firstAuthor} et al., ${year}`
}

/**
 * Fetches structured citations (short form + full reference) for a list of
 * asserted distribution IDs.
 * Returns a Map of distributionId -> array of { id, display, short, full }.
 *   display — truncated to "First et al., Year" for 3+ authors; shown in table
 *   short   — original citation_source_body; kept for reference
 *   full    — full HTML reference from source.cached; shown in modal
 */
async function fetchCitations(distributionIds) {
  if (!distributionIds.length) return new Map()

  const params = new URLSearchParams()
  params.append('citation_object_type', 'AssertedDistribution')
  distributionIds.forEach((id) => params.append('citation_object_id[]', id))

  const { data: citations } = await makeAPIRequest.get(
    `/citations?${params.toString()}`
  )

  if (!citations.length) return new Map()

  const sourceIds = [...new Set(citations.map((c) => c.source_id))]
  const srcParams = new URLSearchParams()
  sourceIds.forEach((id) => srcParams.append('source_id[]', id))

  const { data: sources } = await makeAPIRequest.get(
    `/sources?${srcParams.toString()}`
  )

  const sourceMap = new Map(sources.map((s) => [s.id, s.cached]))

  const result = new Map()
  for (const cit of citations) {
    const entry = {
      id: cit.id,
      short: cit.citation_source_body || '',
      display: shortCitation(cit.citation_source_body || ''),
      full: sourceMap.get(cit.source_id) || cit.citation_source_body || ''
    }
    if (!result.has(cit.citation_object_id)) {
      result.set(cit.citation_object_id, [])
    }
    result.get(cit.citation_object_id).push(entry)
  }

  return result
}

/**
 * Fetches GeoJSON for a single OTU and returns a map of
 * AssertedDistribution ID → GeoJSON Feature.
 *
 * The promise itself is cached immediately, so concurrent calls (e.g. a
 * background pre-fetch racing with a user click) share the same in-flight
 * request instead of issuing duplicates.
 */
function fetchGeoForOtu(otuId) {
  if (geoPromiseCache[otuId]) return geoPromiseCache[otuId]

  geoPromiseCache[otuId] = (async () => {
    const byId = {}
    try {
      const { data } = await makeAPIRequest.get(
        `/otus/${otuId}/inventory/distribution.geojson`
      )
      for (const f of data?.features || []) {
        const fp = f.properties || {}
        if (fp.base?.type === 'AssertedDistribution' && fp.base?.id) {
          // VMap's geojsonOptions expects properties.base to be an array
          byId[fp.base.id] = { ...f, properties: { ...fp, base: [fp.base] } }
        }
      }
    } catch {
      // return empty map; promise stays cached to avoid hammering on error
    }
    return byId
  })()

  return geoPromiseCache[otuId]
}

/**
 * Opens the map modal for a distribution row.
 * Awaits the (possibly already in-flight) GeoJSON promise for that OTU.
 */
async function openMapModal(dist) {
  mapModal.value = { open: true, loading: true, areaName: dist.areaName, feature: null }
  const byId = await fetchGeoForOtu(dist.otuId)
  mapModal.value = { open: true, loading: false, areaName: dist.areaName, feature: byId[dist.id] ?? null }
}

/**
 * Loads all asserted distributions for the current taxon (including descendants),
 * then fetches structured citations and geographic GeoJSON for map popups.
 */
async function loadDistributions() {
  isLoading.value = true

  try {
    const { data, headers } = await useOtuPageRequest(
      'panel:asserted-distributions',
      () =>
        makeAPIRequest.get('/asserted_distributions', {
          params: {
            'taxon_name_id[]': props.taxon.id,
            descendants: true,
            per: props.per
          }
        })
    )

    totalCount.value = Number(headers['pagination-total']) || data.length

    const ids = data.map((d) => d.id)
    const citationsMap = await fetchCitations(ids)

    distributions.value = data.map((item) =>
      makeDistribution(item, citationsMap.get(item.id) || [])
    )

    // Kick off GeoJSON fetches in the background so they're ready (or nearly
    // ready) when the user clicks an area name. The promise cache ensures
    // clicks that arrive before a fetch completes reuse the in-flight request.
    const otuIds = [...new Set(distributions.value.map((d) => d.otuId))]
    otuIds.forEach(fetchGeoForOtu)
  } catch (e) {
    // silently fail; spinner stops and no results show
  } finally {
    isLoading.value = false
  }
}

onMounted(() => loadDistributions())
</script>
