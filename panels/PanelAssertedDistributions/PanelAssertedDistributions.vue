<template>
  <VCard>
    <ClientOnly>
      <VSpinner v-if="isLoading" />
    </ClientOnly>
    <VCardHeader>
      Asserted distributions ({{ totalCount }})
    </VCardHeader>
    <VCardContent class="min-h-[6rem] overflow-x-auto">

      <!-- Tabs: visible when records span multiple OTUs (descendants + synonyms) -->
      <div
        v-if="showTabs"
        class="flex flex-wrap gap-x-1 mb-4 border-b"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="px-3 py-1.5 text-sm -mb-px border-b-2 transition-colors"
          :class="selectedOtuId === tab.id
            ? 'border-current text-secondary font-medium'
            : 'border-transparent opacity-50 hover:opacity-100'"
          @click="selectedOtuId = tab.id"
        >
          <template v-if="tab.id === 'all'">All</template>
          <template v-else>
            <span
              v-if="tab.isSynonym"
              class="mr-0.5"
              title="Synonym"
            >&#10060;</span>
            <em>{{ tab.label }}</em>
          </template>
          <span class="ml-1 text-xs opacity-60">({{ tab.count }})</span>
        </button>
      </div>

      <VTable v-if="groupedDistributions.length">
        <VTableHeader class="normal-case">
          <VTableHeaderRow>
            <VTableHeaderCell>Area</VTableHeaderCell>
            <VTableHeaderCell v-if="isMergedView">Taxa</VTableHeaderCell>
            <VTableHeaderCell>Annotations</VTableHeaderCell>
            <VTableHeaderCell>Citation</VTableHeaderCell>
          </VTableHeaderRow>
        </VTableHeader>
        <VTableBody>
          <template
            v-for="group in groupedDistributions"
            :key="group.parent"
          >
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

              <!-- Taxa column: merged All-tab view only -->
              <VTableBodyCell
                v-if="isMergedView"
                class="text-sm"
              >
                <template
                  v-for="(entry, i) in item.otuEntries"
                  :key="entry.otuId"
                >
                  <span
                    v-if="entry.isSynonym"
                    class="mr-0.5"
                    title="Synonym"
                  >&#10060;</span>
                  <em>{{ entry.otuName }}</em><span v-if="i < item.otuEntries.length - 1">; </span>
                </template>
              </VTableBodyCell>

              <VTableBodyCell>
                <span
                  v-if="item.isAbsent"
                  class="text-danger text-sm font-medium"
                >Absent</span>
                <VBadge
                  v-for="tag in item.tags || []"
                  :key="tag"
                  class="ml-1"
                  color="yellow"
                  shape="pill"
                  size="sm"
                  weight="normal"
                >{{ tag }}</VBadge>
                <template
                  v-for="attr in item.dataAttributes || []"
                  :key="attr.id"
                >
                  <div
                    v-if="attr.predicate.toLowerCase() === 'reassessment' && attr.citation"
                    class="text-xs mt-0.5"
                  ><b>Reassessed by <button
                        class="hover:underline cursor-pointer text-secondary"
                        @click="activeCitation = attr.citation"
                        v-html="attr.citation.display"
                      /></b><b>:</b> {{ attr.value }}</div>
                  <div
                    v-else
                    class="text-xs mt-0.5"
                  ><b>{{ attr.predicate }}:</b> {{ attr.value }}</div>
                </template>
              </VTableBodyCell>

              <VTableBodyCell class="text-sm">
                <template
                  v-for="(citation, i) in item.citationList"
                  :key="citation.id"
                >
                  <button
                    class="hover:underline cursor-pointer text-secondary"
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

      <!-- Map modal -->
      <Teleport to="body">
        <VModal
          v-if="mapModal.open"
          @close="mapModal = { open: false }"
        >
          <template #header>
            <div class="text-sm font-medium">{{ mapModal.areaName }}</div>
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

      <!-- Citation modal -->
      <Teleport to="body">
        <ReferenceModal
          :citation="activeCitation"
          @close="activeCitation = null"
        />
      </Teleport>

      <div
        v-if="!isLoading && loadError"
        class="text-sm text-center my-8 w-full flex flex-col items-center gap-2"
      >
        <span>Something went wrong loading distributions.</span>
        <VButton
          size="sm"
          @click="loadDistributions"
        >Retry</VButton>
      </div>

      <div
        v-else-if="!isLoading && !groupedDistributions.length"
        class="text-xl text-center my-8 w-full"
      >
        No records found.
      </div>

      <p
        v-if="groupedDistributions.length"
        class="text-xs opacity-50 mt-4 text-center"
      >
        The same distribution data can also be viewed on the map in the Overview panel.
      </p>
    </VCardContent>
  </VCard>
</template>

<script setup>
/**
 * PanelAssertedDistributions.vue
 *
 * Displays asserted distributions for an OTU and its descendants + synonyms.
 *
 * LOAD SEQUENCE
 * -------------
 * Step 1:
 *   /otus?taxon_name_id[]=X&descendants=true&coordinatify=true
 *   Resolves the full OTU set: the valid taxon, its descendants
 *   (subspecies/varieties), and every coordinate OTU (true synonym sharing
 *   the same valid taxon name) among them, all decided by TaxonWorks
 *   itself. This panel does NOT determine synonymy on its own: an earlier
 *   version walked /taxon_name_relationships and filtered by a bare
 *   `type.includes('Invalidating')`, which also matches Misapplication and
 *   Homonym relationships (not synonymy) and could pull in an unrelated
 *   taxon's distributions (see issue #35). `coordinatify` is TaxonWorks'
 *   own, correct notion of "same taxon, different OTU record". Deduplicated
 *   (`new Set`), since coordinatify can list an OTU that also qualifies as
 *   a plain descendant. `/otus` has no id-only/lean response mode, but this
 *   panel is restricted to `rank_group: ['SpeciesGroup']` (taxa_page.yml),
 *   which keeps the OTU set (and so this payload) small in practice.
 *
 * Step 2:
 *   /asserted_distributions?otu_id[]=OTU1&otu_id[]=OTU2&..., one batch for
 *   every OTU resolved in step 1.
 *
 * Steps 1 and 2, plus the citations, tags, and data-attribute fetches in
 * step 3 below, all go through the shared `fetchAllPages()` (panels/_shared/):
 * it follows `pagination-total-pages` rather than assuming everything fits
 * in one `per`-sized page, since a widely-distributed, heavily-synonymized
 * species can exceed 500 records at any of these steps, not just step 2.
 * Remaining pages run through a small concurrency-capped worker pool rather
 * than one unbounded burst of requests.
 *
 * Step 3, one batch each, in parallel, for all records:
 *   citations (/citations?extend[]=source), tags, data attributes.
 *
 * SYNONYM DETECTION (display only: badges/❌, not which records to include)
 * ---------------------------------------------------------------------------
 * asserted_distribution_object.object_tag contains &#10060; for synonyms,
 * &#10003; for valid taxa, no extra API call needed.
 *
 * TABS & MERGED VIEW
 * ------------------
 * Tabs appear when records span more than one OTU. The "All" tab merges
 * rows with the same geographic area into a single row and adds a Taxa
 * column listing all taxa recorded there. Per-OTU tabs show individual rows.
 *
 * ERROR HANDLING
 * --------------
 * A load failure sets `loadError` and leaves `distributions` untouched,
 * rather than the two states being conflated: an empty result set on
 * success renders "No records found.", a thrown error renders a distinct
 * message with a retry button, so a transient network failure never reads
 * as "this taxon has no distributions."
 */

import { computed, onMounted, ref } from 'vue'
import { makeAPIRequest } from '@/utils'
import { fetchAllPages } from '../_shared/fetchAllPages.js'
import { fetchAssertedDistributionTags } from '../_shared/assertedDistributionTags.js'
import { stripHtml, shortCitation } from '../_shared/citationText.js'
import ReferenceModal from '../_shared/ReferenceModal.vue'

const props = defineProps({
  otuId: {
    type: [Number, String],
    required: true
  },
  taxon: {
    type: Object,
    required: true
  },
  per: {
    type: Number,
    default: 500
  }
})

const distributions = ref([])
const isLoading = ref(false)
const loadError = ref(false)
const totalCount = ref(0)
const activeCitation = ref(null)
const selectedOtuId = ref('all')

// Map modal state
const mapModal = ref({ open: false })
// Geographic area ID → GeoJSON Feature, merged from all OTU inventories.
// Keyed by shape.id (geographic area ID) so any tab can find a polygon
// regardless of which OTU's GeoJSON record it came from.
const shapeIdMap = ref({})
// Per-OTU promise cache: deduplicates concurrent requests for the same OTU.
const geoPromiseCache = {}

const showTabs = computed(() => new Set(distributions.value.map((d) => d.otuId)).size > 1)

// True when the All tab is active across multiple OTUs, collapses rows by area
const isMergedView = computed(() => selectedOtuId.value === 'all' && showTabs.value)

const tabs = computed(() => {
  const byOtu = new Map()
  for (const d of distributions.value) {
    if (!byOtu.has(d.otuId)) {
      byOtu.set(d.otuId, { id: d.otuId, label: d.otuName, isSynonym: d.isSynonym, count: 0 })
    }
    byOtu.get(d.otuId).count++
  }
  const otuTabs = [...byOtu.values()].sort((a, b) => a.label.localeCompare(b.label))
  return [{ id: 'all', count: distributions.value.length }, ...otuTabs]
})

const filteredDistributions = computed(() => {
  if (selectedOtuId.value === 'all') return distributions.value
  return distributions.value.filter((d) => String(d.otuId) === String(selectedOtuId.value))
})

/**
 * In the merged All tab: collapses distributions sharing the same geographic
 * area into one row, combining otuEntries and citations across all taxa.
 */
function mergeByArea(dists) {
  const byArea = new Map()
  for (const dist of dists) {
    const key = `${dist.parentName}|${dist.areaName}`
    if (!byArea.has(key)) {
      byArea.set(key, {
        id: dist.id,
        shapeId: dist.shapeId, // needed for map modal lookup
        otuId: dist.otuId,     // needed for map modal GeoJSON fetch
        areaName: dist.areaName,
        areaType: dist.areaType,
        parentName: dist.parentName,
        isAbsent: false,
        tags: [],
        dataAttributes: [],
        otuEntries: [],
        citationList: []
      })
    }
    const m = byArea.get(key)
    m.isAbsent = m.isAbsent || dist.isAbsent
    for (const t of dist.tags || []) if (!m.tags.includes(t)) m.tags.push(t)
    for (const a of dist.dataAttributes || []) {
      if (!m.dataAttributes.some((x) => x.id === a.id)) {
        m.dataAttributes.push(a)
      }
    }
    if (!m.otuEntries.some((e) => e.otuId === dist.otuId)) {
      m.otuEntries.push({ otuId: dist.otuId, otuName: dist.otuName, isSynonym: dist.isSynonym })
    }
    m.citationList.push(...dist.citationList)
  }
  return [...byArea.values()]
}

const groupedDistributions = computed(() => {
  const source = isMergedView.value
    ? mergeByArea(filteredDistributions.value)
    : filteredDistributions.value

  const groups = new Map()
  for (const dist of source) {
    if (!groups.has(dist.parentName)) groups.set(dist.parentName, [])
    groups.get(dist.parentName).push(dist)
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

function makeDistribution(item, citationList, tags = [], dataAttributes = []) {
  const shape = item.asserted_distribution_shape || {}
  const obj = item.asserted_distribution_object || {}
  return {
    id: item.id,
    otuId: item.asserted_distribution_object_id,
    shapeId: shape.id,
    otuName: obj.taxon_name || '',
    isSynonym: (obj.object_tag || '').includes('&#10060;'),
    areaName: shape.name || '',
    areaType: shape.geographic_area_type?.name || '',
    parentName: shape.parent?.name || 'Earth',
    isAbsent: !!item.is_absent,
    tags,
    dataAttributes,
    citationList
  }
}

/**
 * Fetches GeoJSON for one OTU and merges AssertedDistribution polygon features
 * into shapeIdMap, keyed by geographic area ID (shape.id). The promise is cached
 * immediately so concurrent calls share one request.
 * VMap expects properties.base as an array, so base is wrapped: [fp.base].
 */
function fetchGeoForOtu(otuId) {
  if (geoPromiseCache[otuId]) return geoPromiseCache[otuId]
  geoPromiseCache[otuId] = (async () => {
    try {
      const { data } = await makeAPIRequest.get(`/otus/${otuId}/inventory/distribution.geojson`)
      const updates = {}
      for (const f of data?.features || []) {
        const fp = f.properties || {}
        if (fp.base?.type === 'AssertedDistribution' && fp.shape?.id && f.geometry) {
          updates[fp.shape.id] = { ...f, properties: { ...fp, base: [fp.base] } }
        }
      }
      if (Object.keys(updates).length) {
        shapeIdMap.value = { ...shapeIdMap.value, ...updates }
      }
    } catch {
      // remain silent; cached promise prevents retry storms
    }
  })()
  return geoPromiseCache[otuId]
}

/**
 * Opens the map modal for a clicked area row. Awaits the GeoJSON for both
 * the page OTU (comprehensive inventory) and the clicked distribution's OTU,
 * then looks up the polygon by geographic area ID.
 */
async function openMapModal(item) {
  mapModal.value = { open: true, loading: true, areaName: item.areaName, feature: null }
  await Promise.all([fetchGeoForOtu(props.otuId), fetchGeoForOtu(item.otuId)])
  mapModal.value = {
    open: true,
    loading: false,
    areaName: item.areaName,
    feature: shapeIdMap.value[item.shapeId] ?? null
  }
}


// Citations, tags, and data attributes are all fetched by id-set, and that
// id-set is exactly what step 1/2's own pagination fix was guarding against
// growing past one page: a widely-distributed, heavily-synonymized species
// can have more than `per` citation/attribute rows too, not just more than
// `per` AD records. All three go through the shared fetchAllPages() so none
// of them re-truncates what step 2 just finished un-truncating.
async function fetchCitations(distributionIds) {
  if (!distributionIds.length) return new Map()

  const citations = await fetchAllPages('/citations', {
    citation_object_type: 'AssertedDistribution',
    'extend[]': 'source',
    'citation_object_id[]': distributionIds
  }, { per: props.per })

  const result = new Map()
  for (const cit of citations) {
    const entry = {
      id: cit.id,
      display: shortCitation(stripHtml(cit.citation_source_body || '')),
      citation_source_body: cit.source?.cached || cit.citation_source_body || ''
    }
    if (!result.has(cit.citation_object_id)) result.set(cit.citation_object_id, [])
    result.get(cit.citation_object_id).push(entry)
  }
  return result
}

// A data attribute's own citation, e.g. the source that reassessed a record
// as a misidentification. Same shape/behaviour as PanelMapV2's MapPopup
// "Reassessed by [citation]" line; kept in sync with it.
async function fetchDataAttributeCitations(dataAttributeIds) {
  if (!dataAttributeIds.length) return new Map()

  const citations = await fetchAllPages('/citations', {
    citation_object_type: 'DataAttribute',
    'extend[]': 'source',
    'citation_object_id[]': dataAttributeIds
  }, { per: props.per })

  const result = new Map()
  for (const cit of citations) {
    if (result.has(cit.citation_object_id)) continue // one citation per attribute
    result.set(cit.citation_object_id, {
      id: cit.id,
      display: shortCitation(stripHtml(cit.citation_source_body || '')),
      citation_source_body: cit.source?.cached || cit.citation_source_body || ''
    })
  }
  return result
}

async function fetchDataAttributes(distributionIds) {
  if (!distributionIds.length) return new Map()

  const list = await fetchAllPages('/data_attributes', {
    attribute_subject_type: 'AssertedDistribution',
    'attribute_subject_id[]': distributionIds
  }, { per: props.per })
  const citationByAttrId = await fetchDataAttributeCitations(list.map((a) => a.id))

  const result = new Map()
  for (const attr of list) {
    const entry = {
      id: attr.id,
      predicate: attr.predicate_name || attr.import_predicate || '',
      value: attr.value,
      citation: citationByAttrId.get(attr.id) || null
    }
    const id = attr.attribute_subject_id
    if (!result.has(id)) result.set(id, [])
    result.get(id).push(entry)
  }
  return result
}

async function loadDistributions() {
  isLoading.value = true
  loadError.value = false
  try {
    // Step 1: resolve the full OTU set via TaxonWorks' own coordinatify,
    // this panel does not determine synonymy itself (see the file header).
    const otus = await fetchAllPages('/otus', {
      'taxon_name_id[]': props.taxon.id,
      descendants: true,
      coordinatify: true
    }, { per: props.per })
    const otuIds = [...new Set(otus.map((o) => o.id))]
    if (!otuIds.length) {
      distributions.value = []
      totalCount.value = 0
      return
    }

    // Step 2: asserted distributions for all of them, paginated
    const allData = await fetchAllPages(
      '/asserted_distributions',
      { 'otu_id[]': otuIds },
      { per: props.per, cacheKey: 'panel:asserted-distributions' }
    )

    // Step 3: citations + tags + data attributes for all records, one batch each, in parallel
    const [citationsMap, tagsMap, dataAttributesMap] = await Promise.all([
      fetchCitations(allData.map((d) => d.id)),
      fetchAssertedDistributionTags(allData.map((d) => d.id)),
      fetchDataAttributes(allData.map((d) => d.id))
    ])

    distributions.value = allData.map((item) =>
      makeDistribution(
        item,
        citationsMap.get(item.id) || [],
        tagsMap.get(item.id) || [],
        dataAttributesMap.get(item.id) || []
      )
    )
    totalCount.value = distributions.value.length

    // Background: pre-fetch GeoJSON for all OTUs so map popups are instant.
    // Always includes props.otuId, its inventory is most comprehensive.
    const allOtuIds = [...new Set([props.otuId, ...distributions.value.map((d) => d.otuId)])]
    allOtuIds.forEach(fetchGeoForOtu)
  } catch {
    loadError.value = true
  } finally {
    isLoading.value = false
  }
}

onMounted(() => loadDistributions())
</script>
