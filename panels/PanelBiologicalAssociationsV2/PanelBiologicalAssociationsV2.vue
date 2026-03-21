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

            <!-- Subject label -->
            <VTableBodyCell>
              <div class="flex flex-col gap-0.5">
                <div
                  v-if="isSpecimenType(ba.subjectType)"
                  class="flex items-center gap-1"
                >
                  <span class="text-xs opacity-50">{{ ba.subjectType === 'CollectionObject' ? 'Collection Object' : 'Field Occurrence' }}</span>
                  <button
                    class="shrink-0 opacity-40 hover:opacity-100 cursor-pointer leading-none text-xs"
                    title="Show details"
                    @click="dwcTableRef.show({ id: ba.subjectId, type: ba.subjectType })"
                  >ⓘ</button>
                </div>
                <span>
                  <span v-if="ba.subjectLabelPrefix">{{ ba.subjectLabelPrefix }}</span>
                  <RouterLink
                    v-if="ba.subjectOtuId"
                    :to="{ name: 'otus-id', params: { id: ba.subjectOtuId } }"
                    class="hover:underline"
                    v-html="ba.subjectSpeciesHtml"
                  />
                  <span v-else v-html="ba.subjectSpeciesHtml" />
                </span>
              </div>
            </VTableBodyCell>

            <VTableBodyCell>{{ ba.biologicalPropertySubject }}</VTableBodyCell>
            <VTableBodyCell class="border-l-2 border-r-2">{{ ba.biologicalRelationship }}</VTableBodyCell>
            <VTableBodyCell>{{ ba.biologicalPropertyObject }}</VTableBodyCell>

            <VTableBodyCell>{{ ba.objectFamily }}</VTableBodyCell>

            <!-- Object label -->
            <VTableBodyCell>
              <div class="flex flex-col gap-0.5">
                <div
                  v-if="isSpecimenType(ba.objectType)"
                  class="flex items-center gap-1"
                >
                  <span class="text-xs opacity-50">{{ ba.objectType === 'CollectionObject' ? 'Collection Object' : 'Field Occurrence' }}</span>
                  <button
                    class="shrink-0 opacity-40 hover:opacity-100 cursor-pointer leading-none text-xs"
                    title="Show details"
                    @click="dwcTableRef.show({ id: ba.objectId, type: ba.objectType })"
                  >ⓘ</button>
                </div>
                <span>
                  <span v-if="ba.objectLabelPrefix">{{ ba.objectLabelPrefix }}</span>
                  <RouterLink
                    v-if="ba.objectOtuId"
                    :to="{ name: 'otus-id', params: { id: ba.objectOtuId } }"
                    class="hover:underline"
                    v-html="ba.objectSpeciesHtml"
                  />
                  <span v-else v-html="ba.objectSpeciesHtml" />
                </span>
              </div>
            </VTableBodyCell>

            <!-- Depictions -->
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

            <!-- Area: asserted distributions, or locality from subject CO/FO -->
            <VTableBodyCell>
              <template v-if="ba.distributions.length">
                <div
                  v-for="dist in ba.distributions"
                  :key="dist.id"
                  class="text-sm leading-snug font-semibold"
                  :class="{ 'line-through opacity-60': dist.isAbsent }"
                >{{ dist.area }}</div>
              </template>
              <span
                v-else-if="ba.subjectLocality?.text || ba.objectLocality?.text"
                class="text-sm"
              >{{ ba.subjectLocality?.text || ba.objectLocality?.text }}</span>
            </VTableBodyCell>

            <!-- Citations -->
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
              <span
                v-if="!ba.citationList.length && ba.citations"
                v-html="ba.citations"
                class="text-sm"
              />
              <span
                v-if="!ba.citationList.length && !ba.citations && (ba.subjectCollector || ba.objectCollector)"
                class="text-sm opacity-70"
              >{{ ba.subjectCollector || ba.objectCollector }}</span>
            </VTableBodyCell>
          </VTableBodyRow>
        </VTableBody>
      </VTable>

      <!-- Citation modal -->
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

      <DwcTable ref="dwcTableRef" />



      <!-- ImageViewer -->
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
 * Fetches both the full and basic /biological_associations endpoints in parallel:
 *   - Full endpoint: taxonomy + object_tag for CO/FO/AnatomicalPart labels and OTU resolution
 *   - Basic endpoint: pre-formatted subject.properties / object.properties strings
 *
 * OTU IDs for non-OTU entities (CO, FO, AnatomicalPart) are resolved by extracting
 * taxon_name_id from the otu_tag_taxon_name span and batch-fetching /otus.
 */

import { onMounted, reactive, ref } from 'vue'
import { makeAPIRequest } from '@/utils'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest.js'
import DwcTable from './DwcTable.vue'
import {
  makeBiologicalAssociation,
  isSpecimenType,
  extractTaxonNameId
} from './makeBiologicalAssociation.js'

// Full endpoint: taxonomy + object_tag for rich entity display
const fullExtend = ['object', 'subject', 'biological_relationship', 'taxonomy']
// Basic endpoint: needed for biological_relationship_types → subject.properties / object.properties
const basicExtend = ['object', 'subject', 'biological_relationship_types']

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

const viewer = reactive({ images: [], index: 0 })
const activeCitation = ref(null)
const dwcTableRef = ref(null)

const dwcPromiseCache = {} // keyed by otuId — used for OTU search locality

function fetchDwcForOtu(otuId) {
  if (dwcPromiseCache[otuId]) return dwcPromiseCache[otuId]
  dwcPromiseCache[otuId] = makeAPIRequest
    .get(`/otus/${otuId}/inventory/dwc.json`)
    .then((r) => r.data)
    .catch(() => [])
  return dwcPromiseCache[otuId]
}


function openViewer(ba) {
  viewer.images = ba.images
  viewer.index = 0
}

function linkify(html) {
  if (!html) return ''
  return html.replace(
    /(?<!href=["'])(?<!">)(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-secondary-color hover:underline">$1</a>'
  )
}

onMounted(() => {
  loadBiologicalAssociations()
})

function makeGalleryImage(depiction) {
  return {
    id: depiction.image.id,
    thumb: depiction.image.thumb,
    original: depiction.image.original,
    medium: depiction.image.medium,
    attribution: { label: depiction.attribution?.label || '' },
    source: { label: '' },
    depictions: depiction.figure_label ? [{ label: depiction.figure_label }] : [],
    _associationId: depiction.depiction_object_id
  }
}

async function fetchDepictions(associationIds) {
  if (!associationIds.length) return new Map()

  const depictionParams = new URLSearchParams()
  depictionParams.append('depiction_object_type', 'BiologicalAssociation')
  associationIds.forEach((id) => depictionParams.append('depiction_object_id[]', id))

  const { data: depictions } = await makeAPIRequest.get(`/depictions?${depictionParams.toString()}`)
  if (!depictions.length) return new Map()

  const galleryParams = new URLSearchParams()
  depictions.forEach((d) => galleryParams.append('depiction_id[]', d.id))
  const { data: galleryItems } = await makeAPIRequest.get(`/depictions/gallery?${galleryParams.toString()}`)

  const result = new Map()
  const allImages = []
  for (const item of galleryItems) {
    const image = makeGalleryImage(item)
    if (!result.has(image._associationId)) result.set(image._associationId, [])
    result.get(image._associationId).push(image)
    allImages.push(image)
  }

  await Promise.all(
    allImages.map(async (image) => {
      try {
        const { data: imgData } = await makeAPIRequest.get(`/images/${image.id}?extend[]=source`)
        if (imgData.source?.label) {
          image.source = { label: imgData.source.label.replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-secondary-color hover:underline">$1</a>') }
        }
      } catch { /* source unavailable */ }
    })
  )
  return result
}

async function fetchCitations(associationIds) {
  if (!associationIds.length) return new Map()

  const citParams = new URLSearchParams()
  citParams.append('citation_object_type', 'BiologicalAssociation')
  associationIds.forEach((id) => citParams.append('citation_object_id[]', id))

  const { data: citations } = await makeAPIRequest.get(`/citations?${citParams.toString()}`)
  if (!citations.length) return new Map()

  const sourceIds = [...new Set(citations.map((c) => c.source_id))]
  const srcParams = new URLSearchParams()
  sourceIds.forEach((id) => srcParams.append('source_id[]', id))
  const { data: sources } = await makeAPIRequest.get(`/sources?${srcParams.toString()}`)
  const sourceMap = new Map(sources.map((s) => [s.id, s.cached]))

  const result = new Map()
  for (const cit of citations) {
    const entry = {
      id: cit.id,
      short: cit.citation_source_body || '',
      full: sourceMap.get(cit.source_id) || cit.citation_source_body || ''
    }
    if (!result.has(cit.citation_object_id)) result.set(cit.citation_object_id, [])
    result.get(cit.citation_object_id).push(entry)
  }
  return result
}

async function fetchDistributions(associationIds) {
  if (!associationIds.length) return new Map()

  const params = new URLSearchParams()
  associationIds.forEach((id) => params.append('biological_association_id[]', id))
  const { data } = await makeAPIRequest.get(`/asserted_distributions?${params.toString()}`)

  const result = new Map()
  for (const dist of data) {
    const baId = dist.asserted_distribution_object_id
    const entry = {
      id: dist.id,
      areaId: dist.asserted_distribution_shape?.id,
      area: dist.asserted_distribution_shape?.name || '',
      isAbsent: !!dist.is_absent
    }
    if (!result.has(baId)) result.set(baId, [])
    result.get(baId).push(entry)
  }
  return result
}

/**
 * Batch-fetches OTU IDs for a list of taxon_name_ids.
 * The taxon_name_id is extracted from the otu_tag_taxon_name span title
 * attribute in each subject/object's object_tag HTML.
 * Returns Map<taxonNameId, otuId>.
 */
async function fetchOtuIds(taxonNameIds) {
  if (!taxonNameIds.length) return new Map()
  const params = new URLSearchParams()
  taxonNameIds.forEach((id) => params.append('taxon_name_id[]', id))
  try {
    const { data } = await makeAPIRequest.get(`/otus?${params.toString()}`)
    return new Map(data.map((otu) => [otu.taxon_name_id, otu.id]))
  } catch {
    return new Map()
  }
}

async function loadBiologicalAssociations(page = 1) {
  isLoading.value = true

  const baseParams = {
    'otu_query[coordinatify]': true,
    'otu_query[otu_id][]': props.otuId,
    per: pagination.value.per,
    page
  }

  try {
    // Full endpoint gives taxonomy + object_tag for rich entity labels.
    // Basic endpoint gives pre-formatted subject/object properties strings
    // (the full endpoint only returns biological_property_id without names).
    const [fullResult, basicResult] = await Promise.all([
      useOtuPageRequest(
        'panel:biological-associations-v2',
        () => makeAPIRequest.get('/biological_associations', {
          params: { ...baseParams, extend: fullExtend }
        })
      ),
      makeAPIRequest.get('/biological_associations/basic', {
        params: { ...baseParams, extend: basicExtend }
      }).catch(() => ({ data: [] }))
    ])

    const { data, headers } = fullResult
    pagination.value = {
      page: Number(headers['pagination-page']),
      per: Number(headers['pagination-per-page']),
      total: Number(headers['pagination-total'])
    }

    // Properties map keyed by association ID from the basic endpoint
    const propsMap = new Map(
      (basicResult.data || []).map((item) => [
        item.id,
        {
          subjectProperties: item.subject?.properties || null,
          objectProperties:  item.object?.properties  || null
        }
      ])
    )

    const associationIds = data.map((d) => d.id)

    // Collect taxon_name_ids from all non-OTU entities (CO, FO, AnatomicalPart, …)
    const taxonNameIds = new Set()
    for (const item of data) {
      for (const entity of [item.subject, item.object]) {
        if (!entity || entity.base_class === 'Otu') continue
        const id = extractTaxonNameId(entity.object_tag)
        if (id) taxonNameIds.add(id)
      }
    }

    const [depictionsMap, distributionsMap, citationsMap, otuByTaxonName] = await Promise.all([
      fetchDepictions(associationIds),
      fetchDistributions(associationIds),
      fetchCitations(associationIds),
      fetchOtuIds([...taxonNameIds])
    ])

    // Pre-fetch DWC locality for CO/FO subjects (grouped by OTU to avoid duplicate fetches)
    const cosByOtuId = new Map()
    for (const item of data) {
      for (const entity of [item.subject, item.object]) {
        if (!entity || !isSpecimenType(entity.base_class)) continue
        const taxonNameId = extractTaxonNameId(entity.object_tag)
        const otuId = otuByTaxonName.get(taxonNameId)
        if (otuId && entity.id) {
          if (!cosByOtuId.has(otuId)) cosByOtuId.set(otuId, [])
          cosByOtuId.get(otuId).push(entity.id)
        }
      }
    }
    const localityByCoId = new Map()
    await Promise.all(
      [...cosByOtuId.entries()].map(async ([otuId, coIds]) => {
        const records = await fetchDwcForOtu(otuId)
        for (const coId of coIds) {
          const record = records.find((r) => r.dwc_occurrence_object_id === coId)
          if (record) {
            const parts = [record.country, record.stateProvince, record.county].filter(Boolean)
            const lat = record.decimalLatitude  ? Number(record.decimalLatitude)  : null
            const lon = record.decimalLongitude ? Number(record.decimalLongitude) : null
            if (parts.length || (lat && lon) || record.recordedBy) {
              localityByCoId.set(coId, { text: parts.join(', '), lat, lon, recordedBy: record.recordedBy || null })
            }
          }
        }
      })
    )

    biologicalAssociations.value = data.map((item) =>
      makeBiologicalAssociation(
        item,
        depictionsMap.get(item.id)    || [],
        distributionsMap.get(item.id) || [],
        citationsMap.get(item.id)     || [],
        otuByTaxonName,
        localityByCoId,
        propsMap.get(item.id) || {}
      )
    )

  } catch (e) {
    // silently fail
  } finally {
    isLoading.value = false
  }
}
</script>
