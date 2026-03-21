<template>
  <VModal
    v-if="isModalVisible"
    @close="isModalVisible = false"
  >
    <template #header>
      <div class="text-sm font-medium">{{ typeLabel }}</div>
      <div
        v-if="subtitle"
        class="text-xs opacity-60 mt-0.5"
      >{{ subtitle }}</div>
    </template>

    <div class="px-4 pb-4 text-sm">
      <div
        v-if="isLoading"
        class="flex items-center gap-2 opacity-60"
      >
        <VSpinner class="h-4 w-4" />
        <span>Loading…</span>
      </div>

      <!-- Single unified grid so all labels share one column width -->
      <dl
        v-else-if="dwc"
        class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-0.5"
      >
        <!-- ── Record ── -->
        <template v-if="hasAny('basisOfRecord','institutionCode','collectionCode','catalogNumber','recordNumber','otherCatalogNumbers')">
          <div class="col-span-2 mt-0 mb-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide opacity-40">Record</h4>
          </div>
          <template v-if="dwc.basisOfRecord">
            <dt class="opacity-50 whitespace-nowrap">Basis of record</dt>
            <dd>{{ dwc.basisOfRecord }}</dd>
          </template>
          <template v-if="dwc.institutionCode">
            <dt class="opacity-50 whitespace-nowrap">Institution</dt>
            <dd>{{ dwc.institutionCode }}</dd>
          </template>
          <template v-if="dwc.collectionCode">
            <dt class="opacity-50 whitespace-nowrap">Collection</dt>
            <dd>{{ dwc.collectionCode }}</dd>
          </template>
          <template v-if="dwc.catalogNumber">
            <dt class="opacity-50 whitespace-nowrap">Catalog no.</dt>
            <dd>{{ dwc.catalogNumber }}</dd>
          </template>
          <template v-if="dwc.recordNumber">
            <dt class="opacity-50 whitespace-nowrap">Record no.</dt>
            <dd>{{ dwc.recordNumber }}</dd>
          </template>
          <template v-if="dwc.otherCatalogNumbers">
            <dt class="opacity-50 whitespace-nowrap">Other catalog nos.</dt>
            <dd>{{ dwc.otherCatalogNumbers }}</dd>
          </template>
        </template>

        <!-- ── Identification ── -->
        <template v-if="hasAny('scientificName','typeStatus','identifiedBy','dateIdentified','identificationQualifier','verbatimIdentification','identificationRemarks')">
          <div class="col-span-2 mt-3 mb-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide opacity-40">Identification</h4>
          </div>
          <template v-if="dwc.scientificName">
            <dt class="opacity-50 whitespace-nowrap">Scientific name</dt>
            <dd class="italic">{{ dwc.scientificName }}</dd>
          </template>
          <template v-if="dwc.typeStatus">
            <dt class="opacity-50 whitespace-nowrap">Type status</dt>
            <dd>{{ dwc.typeStatus }}</dd>
          </template>
          <template v-if="dwc.identifiedBy">
            <dt class="opacity-50 whitespace-nowrap">Identified by</dt>
            <dd>{{ dwc.identifiedBy }}</dd>
          </template>
          <template v-if="dwc.dateIdentified">
            <dt class="opacity-50 whitespace-nowrap">Date identified</dt>
            <dd>{{ dwc.dateIdentified }}</dd>
          </template>
          <template v-if="dwc.identificationQualifier">
            <dt class="opacity-50 whitespace-nowrap">Qualifier</dt>
            <dd>{{ dwc.identificationQualifier }}</dd>
          </template>
          <template v-if="dwc.verbatimIdentification">
            <dt class="opacity-50 whitespace-nowrap">Verbatim ID</dt>
            <dd>{{ dwc.verbatimIdentification }}</dd>
          </template>
          <template v-if="dwc.identificationRemarks">
            <dt class="opacity-50 whitespace-nowrap">ID remarks</dt>
            <dd>{{ dwc.identificationRemarks }}</dd>
          </template>
        </template>

        <!-- ── Collection event ── -->
        <template v-if="hasAny('recordedBy','eventDate','year','verbatimEventDate','fieldNumber','samplingProtocol','samplingEffort','habitat','fieldNotes','eventRemarks')">
          <div class="col-span-2 mt-3 mb-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide opacity-40">Collection event</h4>
          </div>
          <template v-if="dwc.recordedBy">
            <dt class="opacity-50 whitespace-nowrap">Collected by</dt>
            <dd>{{ dwc.recordedBy }}</dd>
          </template>
          <template v-if="dwc.eventDate">
            <dt class="opacity-50 whitespace-nowrap">Date</dt>
            <dd>{{ dwc.eventDate }}</dd>
          </template>
          <template v-else-if="dwc.year">
            <dt class="opacity-50 whitespace-nowrap">Date</dt>
            <dd>{{ [dwc.day, dwc.month, dwc.year].filter(Boolean).join('.') }}</dd>
          </template>
          <template v-if="dwc.verbatimEventDate && dwc.verbatimEventDate !== dwc.eventDate">
            <dt class="opacity-50 whitespace-nowrap">Verbatim date</dt>
            <dd>{{ dwc.verbatimEventDate }}</dd>
          </template>
          <template v-if="dwc.fieldNumber">
            <dt class="opacity-50 whitespace-nowrap">Field no.</dt>
            <dd>{{ dwc.fieldNumber }}</dd>
          </template>
          <template v-if="dwc.samplingProtocol">
            <dt class="opacity-50 whitespace-nowrap">Method</dt>
            <dd>{{ dwc.samplingProtocol }}</dd>
          </template>
          <template v-if="dwc.samplingEffort">
            <dt class="opacity-50 whitespace-nowrap">Sampling effort</dt>
            <dd>{{ dwc.samplingEffort }}</dd>
          </template>
          <template v-if="dwc.habitat">
            <dt class="opacity-50 whitespace-nowrap">Habitat</dt>
            <dd>{{ dwc.habitat }}</dd>
          </template>
          <template v-if="dwc.fieldNotes">
            <dt class="opacity-50 whitespace-nowrap">Field notes</dt>
            <dd>{{ dwc.fieldNotes }}</dd>
          </template>
          <template v-if="dwc.eventRemarks">
            <dt class="opacity-50 whitespace-nowrap">Event remarks</dt>
            <dd>{{ dwc.eventRemarks }}</dd>
          </template>
        </template>

        <!-- ── Location ── -->
        <template v-if="hasAny('higherGeography','continent','waterBody','islandGroup','island','country','stateProvince','county','municipality','locality','verbatimLocality','locationRemarks')">
          <div class="col-span-2 mt-3 mb-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide opacity-40">Location</h4>
          </div>
          <template v-if="dwc.higherGeography">
            <dt class="opacity-50 whitespace-nowrap">Higher geography</dt>
            <dd>{{ dwc.higherGeography }}</dd>
          </template>
          <template v-if="dwc.continent">
            <dt class="opacity-50 whitespace-nowrap">Continent</dt>
            <dd>{{ dwc.continent }}</dd>
          </template>
          <template v-if="dwc.waterBody">
            <dt class="opacity-50 whitespace-nowrap">Water body</dt>
            <dd>{{ dwc.waterBody }}</dd>
          </template>
          <template v-if="dwc.islandGroup">
            <dt class="opacity-50 whitespace-nowrap">Island group</dt>
            <dd>{{ dwc.islandGroup }}</dd>
          </template>
          <template v-if="dwc.island">
            <dt class="opacity-50 whitespace-nowrap">Island</dt>
            <dd>{{ dwc.island }}</dd>
          </template>
          <template v-if="dwc.country">
            <dt class="opacity-50 whitespace-nowrap">Country</dt>
            <dd>{{ dwc.country }}</dd>
          </template>
          <template v-if="dwc.stateProvince">
            <dt class="opacity-50 whitespace-nowrap">State / Province</dt>
            <dd>{{ dwc.stateProvince }}</dd>
          </template>
          <template v-if="dwc.county">
            <dt class="opacity-50 whitespace-nowrap">County</dt>
            <dd>{{ dwc.county }}</dd>
          </template>
          <template v-if="dwc.municipality">
            <dt class="opacity-50 whitespace-nowrap">Municipality</dt>
            <dd>{{ dwc.municipality }}</dd>
          </template>
          <template v-if="dwc.locality">
            <dt class="opacity-50 whitespace-nowrap">Locality</dt>
            <dd>{{ dwc.locality }}</dd>
          </template>
          <template v-if="dwc.verbatimLocality && dwc.verbatimLocality !== dwc.locality">
            <dt class="opacity-50 whitespace-nowrap">Verbatim locality</dt>
            <dd>{{ dwc.verbatimLocality }}</dd>
          </template>
          <template v-if="dwc.locationRemarks">
            <dt class="opacity-50 whitespace-nowrap">Location remarks</dt>
            <dd>{{ dwc.locationRemarks }}</dd>
          </template>
        </template>

        <!-- ── Elevation / Depth ── -->
        <template v-if="hasAny('minimumElevationInMeters','verbatimElevation','minimumDepthInMeters')">
          <div class="col-span-2 mt-3 mb-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide opacity-40">Elevation / Depth</h4>
          </div>
          <template v-if="dwc.minimumElevationInMeters">
            <dt class="opacity-50 whitespace-nowrap">Elevation</dt>
            <dd>
              {{ dwc.minimumElevationInMeters }}<template v-if="dwc.maximumElevationInMeters && dwc.maximumElevationInMeters !== dwc.minimumElevationInMeters"> – {{ dwc.maximumElevationInMeters }}</template> m
            </dd>
          </template>
          <template v-else-if="dwc.verbatimElevation">
            <dt class="opacity-50 whitespace-nowrap">Elevation</dt>
            <dd>{{ dwc.verbatimElevation }}</dd>
          </template>
          <template v-if="dwc.minimumDepthInMeters">
            <dt class="opacity-50 whitespace-nowrap">Depth</dt>
            <dd>
              {{ dwc.minimumDepthInMeters }}<template v-if="dwc.maximumDepthInMeters && dwc.maximumDepthInMeters !== dwc.minimumDepthInMeters"> – {{ dwc.maximumDepthInMeters }}</template> m
            </dd>
          </template>
        </template>

        <!-- ── Coordinates ── -->
        <template v-if="hasAny('decimalLatitude','verbatimCoordinates','georeferencedBy','georeferenceProtocol','georeferenceRemarks')">
          <div class="col-span-2 mt-3 mb-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide opacity-40">Coordinates</h4>
          </div>
          <template v-if="dwc.decimalLatitude">
            <dt class="opacity-50 whitespace-nowrap">Lat / Lon</dt>
            <dd>{{ dwc.decimalLatitude }}, {{ dwc.decimalLongitude }}</dd>
          </template>
          <template v-if="dwc.coordinateUncertaintyInMeters">
            <dt class="opacity-50 whitespace-nowrap">Uncertainty</dt>
            <dd>{{ dwc.coordinateUncertaintyInMeters }} m</dd>
          </template>
          <template v-if="dwc.geodeticDatum">
            <dt class="opacity-50 whitespace-nowrap">Datum</dt>
            <dd>{{ dwc.geodeticDatum }}</dd>
          </template>
          <template v-if="dwc.verbatimCoordinates">
            <dt class="opacity-50 whitespace-nowrap">Verbatim coords.</dt>
            <dd>{{ dwc.verbatimCoordinates }}</dd>
          </template>
          <template v-if="dwc.georeferencedBy">
            <dt class="opacity-50 whitespace-nowrap">Georeferenced by</dt>
            <dd>{{ dwc.georeferencedBy }}</dd>
          </template>
          <template v-if="dwc.georeferenceProtocol">
            <dt class="opacity-50 whitespace-nowrap">Protocol</dt>
            <dd>{{ dwc.georeferenceProtocol }}</dd>
          </template>
          <template v-if="dwc.georeferenceRemarks">
            <dt class="opacity-50 whitespace-nowrap">Georeference remarks</dt>
            <dd>{{ dwc.georeferenceRemarks }}</dd>
          </template>
          <template v-if="dwc.decimalLatitude && dwc.decimalLongitude">
            <dt class="opacity-50 whitespace-nowrap">Map</dt>
            <dd>
              <a
                :href="`https://www.openstreetmap.org/?mlat=${dwc.decimalLatitude}&mlon=${dwc.decimalLongitude}&zoom=10`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-secondary-color hover:underline"
              >Open in OpenStreetMap ↗</a>
            </dd>
          </template>
        </template>

        <!-- ── Other ── -->
        <template v-if="hasAny('dynamicProperties','informationWithheld','dataGeneralizations','associatedTaxa','associatedMedia','associatedReferences','associatedSequences')">
          <div class="col-span-2 mt-3 mb-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide opacity-40">Other</h4>
          </div>
          <template v-if="dwc.associatedTaxa">
            <dt class="opacity-50 whitespace-nowrap">Associated taxa</dt>
            <dd>{{ dwc.associatedTaxa }}</dd>
          </template>
          <template v-if="dwc.associatedMedia">
            <dt class="opacity-50 whitespace-nowrap">Associated media</dt>
            <dd>{{ dwc.associatedMedia }}</dd>
          </template>
          <template v-if="dwc.associatedReferences">
            <dt class="opacity-50 whitespace-nowrap">Associated refs.</dt>
            <dd>{{ dwc.associatedReferences }}</dd>
          </template>
          <template v-if="dwc.associatedSequences">
            <dt class="opacity-50 whitespace-nowrap">Associated sequences</dt>
            <dd>{{ dwc.associatedSequences }}</dd>
          </template>
          <template v-if="dwc.dynamicProperties">
            <dt class="opacity-50 whitespace-nowrap">Dynamic properties</dt>
            <dd>{{ dwc.dynamicProperties }}</dd>
          </template>
          <template v-if="dwc.informationWithheld">
            <dt class="opacity-50 whitespace-nowrap">Information withheld</dt>
            <dd>{{ dwc.informationWithheld }}</dd>
          </template>
          <template v-if="dwc.dataGeneralizations">
            <dt class="opacity-50 whitespace-nowrap">Data generalizations</dt>
            <dd>{{ dwc.dataGeneralizations }}</dd>
          </template>
        </template>

        <!-- ── Specimen (least interesting, shown last) ── -->
        <template v-if="hasAny('sex','lifeStage','reproductiveCondition','behavior','preparations','individualCount','organismQuantity','occurrenceStatus','occurrenceRemarks')">
          <div class="col-span-2 mt-3 mb-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide opacity-40">Specimen</h4>
          </div>
          <template v-if="dwc.sex">
            <dt class="opacity-50 whitespace-nowrap">Sex</dt>
            <dd>{{ dwc.sex }}</dd>
          </template>
          <template v-if="dwc.lifeStage">
            <dt class="opacity-50 whitespace-nowrap">Life stage</dt>
            <dd>{{ dwc.lifeStage }}</dd>
          </template>
          <template v-if="dwc.reproductiveCondition">
            <dt class="opacity-50 whitespace-nowrap">Reproductive condition</dt>
            <dd>{{ dwc.reproductiveCondition }}</dd>
          </template>
          <template v-if="dwc.behavior">
            <dt class="opacity-50 whitespace-nowrap">Behavior</dt>
            <dd>{{ dwc.behavior }}</dd>
          </template>
          <template v-if="dwc.preparations">
            <dt class="opacity-50 whitespace-nowrap">Preparations</dt>
            <dd>{{ dwc.preparations }}</dd>
          </template>
          <template v-if="dwc.individualCount">
            <dt class="opacity-50 whitespace-nowrap">Individual count</dt>
            <dd>{{ dwc.individualCount }}</dd>
          </template>
          <template v-if="dwc.organismQuantity">
            <dt class="opacity-50 whitespace-nowrap">Quantity</dt>
            <dd>{{ dwc.organismQuantity }}{{ dwc.organismQuantityType ? ' ' + dwc.organismQuantityType : '' }}</dd>
          </template>
          <template v-if="dwc.occurrenceStatus">
            <dt class="opacity-50 whitespace-nowrap">Occurrence status</dt>
            <dd>{{ dwc.occurrenceStatus }}</dd>
          </template>
          <template v-if="dwc.occurrenceRemarks">
            <dt class="opacity-50 whitespace-nowrap">Remarks</dt>
            <dd>{{ dwc.occurrenceRemarks }}</dd>
          </template>
        </template>
      </dl>

      <p
        v-else-if="!isLoading"
        class="opacity-50"
      >No details available.</p>

      <RouterLink
        v-if="otuId"
        :to="{ name: 'otus-id', params: { id: otuId } }"
        class="text-secondary-color hover:underline block px-4 pb-4 text-sm"
        @click="isModalVisible = false"
      >→ View taxon page</RouterLink>
    </div>
  </VModal>
</template>

<script setup>
import { ref, computed } from 'vue'
import { makeAPIRequest } from '@/utils'
import { FIELD_OCCURRENCE, COLLECTION_OBJECT } from '@/constants/objectTypes'

const isLoading = ref(false)
const isModalVisible = ref(false)
const dwc = ref(null)
const itemType = ref(null)
const otuId = ref(null)

const ENDPOINTS = {
  [COLLECTION_OBJECT]: (id) => `/collection_objects/${id}/dwc`,
  [FIELD_OCCURRENCE]: (id) => `/field_occurrences/${id}/dwc`
}

const TYPE_LABELS = {
  [COLLECTION_OBJECT]: 'Collection Object',
  [FIELD_OCCURRENCE]: 'Field Occurrence'
}

const typeLabel = computed(() => TYPE_LABELS[itemType.value] ?? itemType.value)

const subtitle = computed(() => {
  if (!dwc.value) return null
  const parts = [dwc.value.institutionCode, dwc.value.catalogNumber].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
})

function hasAny(...keys) {
  return dwc.value && keys.some((k) => dwc.value[k])
}

function show({ id, type, otuId: oid = null }) {
  isModalVisible.value = true
  isLoading.value = true
  dwc.value = null
  itemType.value = type
  otuId.value = oid

  makeAPIRequest(ENDPOINTS[type](id))
    .then(({ data }) => {
      dwc.value = data
    })
    .catch(() => {})
    .finally(() => {
      isLoading.value = false
    })
}

defineExpose({ show })
</script>
