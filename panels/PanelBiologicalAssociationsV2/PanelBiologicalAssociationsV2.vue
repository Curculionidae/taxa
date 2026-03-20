<template>
  <VCard>
    <ClientOnly>
      <VSpinner v-if="isLoading" />
    </ClientOnly>
    <VCardHeader>
      Biological associations ({{ pagination.total }})
    </VCardHeader>
    <VCardContent class="min-h-[6rem] overflow-x-auto">
      <VPagination
        v-if="biologicalAssociations.length"
        class="mb-4"
        v-model="pagination.page"
        :total="pagination.total"
        :per="pagination.per"
        @select="(value) => { loadBiologicalAssociations(value) }"
      />
      <VTable v-if="biologicalAssociations.length">
        <VTableHeader class="normal-case">
          <VTableHeaderRow>
            <VTableHeaderCell colspan="3">Subject</VTableHeaderCell>
            <VTableHeaderCell class="border-l-2 border-r-2">Biological</VTableHeaderCell>
            <VTableHeaderCell colspan="3">Object</VTableHeaderCell>
            <VTableHeaderCell class="border-l-2" colspan="3">Metadata</VTableHeaderCell>
          </VTableHeaderRow>
          <VTableHeaderRow>
            <VTableHeaderCell>Family</VTableHeaderCell>
            <VTableHeaderCell>Label</VTableHeaderCell>
            <VTableHeaderCell>Properties</VTableHeaderCell>
            <VTableHeaderCell class="border-l-2 border-r-2">Relationship</VTableHeaderCell>
            <VTableHeaderCell>Properties</VTableHeaderCell>
            <VTableHeaderCell>Family</VTableHeaderCell>
            <VTableHeaderCell>Label</VTableHeaderCell>
            <VTableHeaderCell class="border-l-2">Depictions</VTableHeaderCell>
            <VTableHeaderCell>Area</VTableHeaderCell>
            <VTableHeaderCell>Citations</VTableHeaderCell>
          </VTableHeaderRow>
        </VTableHeader>
        <VTableBody>
          <VTableBodyRow
            v-for="ba in biologicalAssociations"
            :key="ba.id"
          >
            <VTableBodyCell>{{ ba.subjectFamily }}</VTableBodyCell>
            <VTableBodyCell>
              <template v-if="ba.subjectType === 'Otu'">
                <RouterLink
                  :to="{ name: 'otus-id', params: { id: ba.subjectId } }"
                  v-html="ba.subjectLabel"
                />
              </template>
              <template v-else>{{ ba.subjectLabel }}</template>
            </VTableBodyCell>
            <VTableBodyCell>{{ ba.biologicalPropertySubject }}</VTableBodyCell>
            <VTableBodyCell class="border-l-2 border-r-2">{{ ba.biologicalRelationship }}</VTableBodyCell>
            <VTableBodyCell>{{ ba.biologicalPropertyObject }}</VTableBodyCell>

            <!--
              Object family: only shown for OTU objects. Non-OTU objects
              (e.g. FieldOccurrence) don't have a taxonomic family in this
              response, so the cell is left empty to avoid confusion.
            -->
            <VTableBodyCell>
              {{ ba.objectType === 'Otu' ? ba.objectFamily : '' }}
            </VTableBodyCell>

            <VTableBodyCell>
              <template v-if="ba.objectType === 'Otu'">
                <RouterLink
                  :to="{ name: 'otus-id', params: { id: ba.objectId } }"
                  v-html="ba.objectLabel"
                />
              </template>
              <template v-else>{{ ba.objectLabel }}</template>
            </VTableBodyCell>

            <!-- Depictions: small thumbnail with +N badge, opens ImageViewer on click -->
            <VTableBodyCell class="border-l-2">
              <div
                v-if="ba.images.length"
                class="relative inline-block cursor-pointer"
                @click="openViewer(ba)"
              >
                <img
                  :src="ba.images[0].thumb"
                  :alt="ba.images[0].label"
                  :title="ba.images[0].label"
                  class="h-12 w-12 object-cover rounded"
                />
                <span
                  v-if="ba.images.length > 1"
                  class="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full px-1"
                >
                  +{{ ba.images.length - 1 }}
                </span>
              </div>
            </VTableBodyCell>

            <!--
              Asserted distributions: area name as a button that opens a map
              popup. Absent records are shown with strikethrough.
            -->
            <VTableBodyCell>
              <div
                v-for="dist in ba.distributions"
                :key="dist.id"
                class="text-sm leading-snug"
                :class="{ 'line-through opacity-60': dist.isAbsent }"
              >
                <button
                  class="hover:underline cursor-pointer text-left font-semibold"
                  @click="openMapModal(dist)"
                >{{ dist.area }}</button>
              </div>
            </VTableBodyCell>

            <!-- Citations: short form clickable, opens modal with full reference -->
            <VTableBodyCell>
              <div
                v-for="citation in ba.citationList"
                :key="citation.id"
                class="text-sm leading-snug"
              >
                <button
                  class="text-left hover:underline cursor-pointer text-secondary-color"
                  @click="activeCitation = citation"
                  v-html="citation.short"
                />
              </div>
              <!-- Fallback: plain string for rows with no structured citations -->
              <span
                v-if="!ba.citationList.length && ba.citations"
                v-html="ba.citations"
                class="text-sm"
              />
            </VTableBodyCell>
          </VTableBodyRow>
        </VTableBody>
      </VTable>

      <!-- Citation modal: full reference text for clicked citation -->
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
            v-html="linkify(activeCitation.full)"
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

      <!-- ImageViewer lightbox, rendered outside the table to avoid layout issues -->
      <ImageViewer
        v-if="viewer.images.length"
        :index="viewer.index"
        :images="viewer.images"
        :next="viewer.index < viewer.images.length - 1"
        :previous="viewer.index > 0"
        @select-index="viewer.index = $event"
        @next="viewer.index++"
        @previous="viewer.index--"
        @close="viewer.images = []"
      />


      <VPagination
        v-if="biologicalAssociations.length"
        class="mt-4"
        v-model="pagination.page"
        :total="pagination.total"
        :per="pagination.per"
        @select="(value) => { loadBiologicalAssociations(value) }"
      />
      <div
        v-if="!isLoading && !biologicalAssociations.length"
        class="text-xl text-center my-8 w-full"
      >
        No records found.
      </div>
    </VCardContent>
  </VCard>
</template>

<script setup>
/**
 * PanelBiologicalAssociationsV2.vue
 *
 * External panel (setup branch) displaying biological associations with
 * inline depictions and asserted distributions, registered as
 * panel:biological-associations-v2.
 *
 * Add to taxa_page.yml to enable:
 *   - panel:biological-associations-v2
 *
 * DEPICTIONS
 * ----------
 * The /biological_associations/basic endpoint does not return depictions.
 * After loading associations, two additional requests are made:
 *
 *   1. GET /depictions?depiction_object_type=BiologicalAssociation
 *         &depiction_object_id[]=X&...
 *      Returns depiction records for all associations on the current page.
 *
 *   2. GET /depictions/gallery?depiction_id[]=A&...
 *      Returns full image data in one batch call: thumb, original URLs,
 *      attribution label, and figure label. Same endpoint used by the
 *      gallery panel internally (see useGallery.js).
 *
 * Image objects are shaped to match what ImageViewer expects exactly:
 *   attribution: { label } (object, not string)
 *   source:      { label } (object, from depiction.label)
 *   depictions:  [{ label }] (array, for caption text)
 *
 * Clicking a thumbnail opens the ImageViewer lightbox showing the full-size
 * image with attribution, source, and navigation.
 *
 * ASSERTED DISTRIBUTIONS
 * ----------------------
 * Batch-fetched via /asserted_distributions?biological_association_id[]=...
 * Shown as area names only; absent records are struck through.
 * Citations are not shown in the area column (they are typically the same
 * as the main record citation).
 *
 * CITATIONS
 * ---------
 * Each citation source name is rendered as a clickable button. Clicking
 * opens a VModal popup showing the full reference text (same pattern as
 * the bibliography panel's OtuModal).
 *
 * OBJECT FAMILY
 * -------------
 * Family is only shown for OTU objects. Non-OTU objects (FieldOccurrence
 * etc.) don't carry taxonomic family in this response.
 */

import { onMounted, reactive, ref } from 'vue'
import { makeAPIRequest } from '@/utils'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest.js'
import { makeBiologicalAssociation } from './makeBiologicalAssociation.js'

const extend = [
  'object',
  'subject',
  'biological_relationship',
  'taxonomy',
  'biological_relationship_types'
]

const props = defineProps({
  otuId: {
    type: Number,
    required: true
  },

  per: {
    type: Number,
    default: 50
  }
})

const biologicalAssociations = ref([])
const isLoading = ref(false)
const pagination = ref({
  page: 1,
  per: props.per,
  total: 0
})

// ImageViewer state: images = [] means closed
const viewer = reactive({
  images: [],
  index: 0
})

// Citation modal state: null means closed
const activeCitation = ref(null)

// Map modal state and per-OTU GeoJSON promise cache (same pattern as PanelAssertedDistributions)
const mapModal = ref({ open: false })
const geoPromiseCache = {}

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
        // Index by geographic area ID (shape.id) so we can look up by area
        // regardless of which AssertedDistribution ID is linked here.
        if (fp.base?.type === 'AssertedDistribution' && fp.shape?.id) {
          byId[fp.shape.id] = { ...f, properties: { ...fp, base: [fp.base] } }
        }
      }
    } catch {
      // cache empty result to avoid hammering on error
    }
    return byId
  })()
  return geoPromiseCache[otuId]
}

async function openMapModal(dist) {
  mapModal.value = { open: true, loading: true, areaName: dist.area, feature: null }
  // Distributions here are linked to the biological association (not the OTU directly),
  // so they won't appear by AssertedDistribution ID in the OTU's GeoJSON.
  // Instead we look up by geographic area ID (shape.id), which is the same
  // regardless of how the distribution was created.
  const byAreaId = await fetchGeoForOtu(props.otuId)
  mapModal.value = { open: true, loading: false, areaName: dist.area, feature: byAreaId[dist.areaId] ?? null }
}

function openViewer(ba) {
  viewer.images = ba.images
  viewer.index = 0
}

/**
 * Converts plain URLs in an HTML string into clickable anchor tags.
 * Used to make links in citation full-text references clickable.
 */
function linkify(html) {
  if (!html) return ''
  return html.replace(
    /(?<!href=["'])(?<!">)(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-secondary-color hover:underline">$1</a>'
  )
}

onMounted(() => {
  // Pre-fetch GeoJSON for the current OTU immediately so map popups are instant
  fetchGeoForOtu(props.otuId)
  loadBiologicalAssociations()
})

/**
 * Converts a raw /depictions/gallery response item into the image object
 * shape expected by ImageViewer. Note that attribution and source must be
 * objects with a `label` property, not plain strings.
 *
 * - attribution: { label } — shown by ImageAttribution.vue
 * - source:      { label } — shown by ImageSource.vue
 * - depictions:  [{ label }] — shown by ImageDepictions.vue (caption)
 */
function makeGalleryImage(depiction) {
  return {
    id: depiction.image.id,
    thumb: depiction.image.thumb,
    original: depiction.image.original,
    medium: depiction.image.medium,
    // figure_label: the image caption set on the depiction
    attribution: { label: depiction.attribution?.label || '' },
    // source: fetched separately via /images/:id?extend[]=source, set after fetch
    source: { label: '' },
    // depictions: figure_label as caption; falls back to empty to avoid clutter
    depictions: depiction.figure_label
      ? [{ label: depiction.figure_label }]
      : [],
    _associationId: depiction.depiction_object_id
  }
}

/**
 * Fetches depictions for a list of biological association IDs.
 * Uses two batch requests: /depictions then /depictions/gallery.
 * Returns a Map of associationId -> array of image objects.
 */
async function fetchDepictions(associationIds) {
  if (!associationIds.length) return new Map()

  const depictionParams = new URLSearchParams()
  depictionParams.append('depiction_object_type', 'BiologicalAssociation')
  associationIds.forEach((id) =>
    depictionParams.append('depiction_object_id[]', id)
  )

  const { data: depictions } = await makeAPIRequest.get(
    `/depictions?${depictionParams.toString()}`
  )

  if (!depictions.length) return new Map()

  const galleryParams = new URLSearchParams()
  depictions.forEach((d) => galleryParams.append('depiction_id[]', d.id))

  const { data: galleryItems } = await makeAPIRequest.get(
    `/depictions/gallery?${galleryParams.toString()}`
  )

  const result = new Map()
  const allImages = []
  for (const item of galleryItems) {
    const image = makeGalleryImage(item)
    if (!result.has(image._associationId)) {
      result.set(image._associationId, [])
    }
    result.get(image._associationId).push(image)
    allImages.push(image)
  }

  // Fetch source for each image via /images/:id?extend[]=source
  // These are fired in parallel since depictions per page are typically few
  await Promise.all(
    allImages.map(async (image) => {
      try {
        const { data: imgData } = await makeAPIRequest.get(
          `/images/${image.id}?extend[]=source`
        )
        if (imgData.source?.label) {
          image.source = { label: imgData.source.label.replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-secondary-color hover:underline">$1</a>') }
        }
      } catch (e) {
        // source unavailable, leave empty
      }
    })
  )

  return result
}

/**
 * Fetches citations for a list of biological association IDs.
 *
 * Step 1: GET /citations?citation_object_type=BiologicalAssociation
 *           &citation_object_id[]=X&...
 *   Returns citation records with source_id and citation_source_body
 *   (short formatted string e.g. "Masur & Wartmann, 2025:93").
 *
 * Step 2: GET /sources?source_id[]=A&...
 *   Returns full source records with cached (full HTML reference string).
 *
 * Returns a Map of associationId -> array of { id, short, full }
 */
async function fetchCitations(associationIds) {
  if (!associationIds.length) return new Map()

  const citParams = new URLSearchParams()
  citParams.append('citation_object_type', 'BiologicalAssociation')
  associationIds.forEach((id) =>
    citParams.append('citation_object_id[]', id)
  )

  const { data: citations } = await makeAPIRequest.get(
    `/citations?${citParams.toString()}`
  )

  if (!citations.length) return new Map()

  // Batch-fetch full source records for all unique source IDs
  const sourceIds = [...new Set(citations.map((c) => c.source_id))]
  const srcParams = new URLSearchParams()
  sourceIds.forEach((id) => srcParams.append('source_id[]', id))

  const { data: sources } = await makeAPIRequest.get(
    `/sources?${srcParams.toString()}`
  )

  const sourceMap = new Map(sources.map((s) => [s.id, s.cached]))

  // Group by association ID
  const result = new Map()
  for (const cit of citations) {
    const entry = {
      id: cit.id,
      short: cit.citation_source_body || '',
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
 * Fetches asserted distributions for a list of biological association IDs
 * in a single batch request.
 * Returns a Map of associationId -> array of { id, area, isAbsent }
 */
async function fetchDistributions(associationIds) {
  if (!associationIds.length) return new Map()

  const params = new URLSearchParams()
  associationIds.forEach((id) =>
    params.append('biological_association_id[]', id)
  )

  const { data } = await makeAPIRequest.get(
    `/asserted_distributions?${params.toString()}`
  )

  const result = new Map()
  for (const dist of data) {
    // asserted_distribution_object_id is the biological association ID here
    // (object type is BiologicalAssociation, not Otu)
    const baId = dist.asserted_distribution_object_id
    const entry = {
      id: dist.id,
      areaId: dist.asserted_distribution_shape?.id,
      area: dist.asserted_distribution_shape?.name || '',
      isAbsent: !!dist.is_absent
    }

    if (!result.has(baId)) {
      result.set(baId, [])
    }
    result.get(baId).push(entry)
  }

  return result
}

/**
 * Loads biological associations for the current OTU, then batch-fetches
 * depictions and asserted distributions in parallel.
 */
async function loadBiologicalAssociations(page = 1) {
  isLoading.value = true

  try {
    const { data, headers } = await useOtuPageRequest(
      'panel:biological-associations-v2',
      () =>
        makeAPIRequest.get('/biological_associations/basic', {
          params: {
            'otu_query[coordinatify]': true,
            'otu_query[otu_id][]': props.otuId,
            per: pagination.value.per,
            page,
            extend
          }
        })
    )

    pagination.value = {
      page: Number(headers['pagination-page']),
      per: Number(headers['pagination-per-page']),
      total: Number(headers['pagination-total'])
    }

    const associationIds = data.map((d) => d.id)

    const [depictionsMap, distributionsMap, citationsMap] = await Promise.all([
      fetchDepictions(associationIds),
      fetchDistributions(associationIds),
      fetchCitations(associationIds)
    ])

    biologicalAssociations.value = data.map((item) =>
      makeBiologicalAssociation(
        item,
        depictionsMap.get(item.id) || [],
        distributionsMap.get(item.id) || [],
        citationsMap.get(item.id) || []
      )
    )

  } catch (e) {
    // silently fail; spinner stops and no results show
  } finally {
    isLoading.value = false
  }
}
</script>
