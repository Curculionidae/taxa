<template>
  <VCard>
    <ClientOnly>
      <VSpinner v-if="isLoading" />
    </ClientOnly>
    <VCardHeader>
      Biological associations ({{ headerCount }})
    </VCardHeader>
    <VCardContent
      class="min-h-[6rem] overflow-x-auto"
      :aria-busy="isLoading || advancedLoadState === 'loading'"
      :data-load-state="viewMode === 'standard' ? standardLoadState : viewMode === 'advanced' ? advancedLoadState : rawLoadState"
    >

      <div class="mb-4 items-center gap-3"
        :class="viewMode === 'advanced' ? 'grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr]' : 'flex flex-wrap'">
        <div
          role="group"
          aria-label="Association view"
          class="inline-flex items-center gap-1"
        >
          <VButton
            v-for="mode in VIEW_MODES"
            :key="mode"
            size="sm"
            variant="secondary"
            :ghost="viewMode !== mode"
            :aria-pressed="viewMode === mode"
            @click="setViewMode(mode)"
          >{{ VIEW_MODE_LABELS[mode] }}</VButton>
        </div>
        <div v-show="viewMode === 'advanced'" ref="advancedRowsToolbar" class="flex justify-center" />
        <div
          ref="advancedToolbar"
          class="flex w-full flex-wrap items-center justify-start gap-3 sm:ml-auto sm:w-auto sm:justify-end"
        >
          <RelationshipFilter
            v-if="viewMode === 'expert' && relationshipOptions.length"
            :model-value="selectedRelationships"
            :options="relationshipOptions"
            @update:model-value="setSelectedRelationships"
          />
        </div>
      </div>

      <div v-if="loadError" data-testid="biological-associations-error" role="alert" class="mb-4 text-sm">
        {{ loadError }}
        <button type="button" class="text-secondary hover:underline cursor-pointer" @click="loadCurrentView">
          Retry
        </button>
      </div>

      <AdvancedAssociationsTable
        v-if="advancedReady"
        v-show="viewMode === 'advanced'"
        :active="viewMode === 'advanced'"
        :rows="advancedRows"
        :taxa="advancedTaxa"
        :classification="advancedClassification"
        :scope="advancedScope(taxon, taxonId)"
        :toolbar="advancedToolbar"
        :rows-toolbar="advancedRowsToolbar"
        :load-images="loadAdvancedImages"
        :source-cache="advancedSourceCache"
        @count="advancedCount = $event"
        @show-specimen="dwcTableRef.show($event)"
        @show-images="viewer.images = $event; viewer.index = 0"
        @show-citations="showAdvancedCitations"
      />
      <div
        v-if="viewMode === 'advanced' && advancedLoadState === 'loading'"
        data-testid="biological-associations-advanced-loading"
        role="status"
        class="mb-4 text-sm"
      >Loading the association records…</div>
      <div
        v-if="viewMode === 'advanced' && advancedMetadataError"
        data-testid="biological-associations-advanced-metadata-warning"
        role="alert"
        class="mb-4 text-sm text-warning"
      >
        {{ advancedMetadataError }}
        <button type="button" class="ml-2 text-secondary hover:underline cursor-pointer" @click="retryAdvancedMetadata">
          Retry
        </button>
      </div>

      <template v-if="viewMode === 'standard'">
        <div
          v-if="standardLoadState === 'loading'"
          data-testid="biological-associations-standard-loading"
          role="status"
          class="mb-4 text-sm"
        >Loading the complete association summary…</div>
        <StandardAssociationsTable
          v-if="standardReady && (standardAsSubject.length || standardAsObject.length)"
          class="mb-6"
          :sections="[
            { heading: standardAsObject.length ? 'As subject — associated objects' : '', rows: standardAsSubject },
            { heading: standardAsSubject.length ? 'As object — associated subjects' : '', rows: standardAsObject }
          ]"
          @show-records="showStandardRecords"
        />
        <div
          v-if="standardReady && standardIndexError"
          data-testid="biological-associations-standard-warning"
          role="status"
          class="mb-4 text-sm text-warning"
        >
          {{ standardIndexError }}
          <button type="button" class="ml-2 text-secondary hover:underline cursor-pointer" @click="retryStandardView">
            Retry
          </button>
        </div>
        <div
          v-if="standardLoadState === 'ready' && !loadError && !standardAsSubject.length && !standardAsObject.length"
          class="text-xl text-center my-8 w-full"
        >No records found.</div>
      </template>

      <!-- Summary: higher-rank pages (genus and above), before drilling into a group.
           Two directions, since this taxon can appear as subject or object of an
           association (or both) — grouping always by "object" would be degenerate
           on a page whose taxon is itself the object side (e.g. a host plant page). -->
      <template v-else-if="viewMode === 'advanced'" />
      <template v-else-if="showSummary">
        <div class="mb-4 flex items-center gap-2 text-sm">
          <span class="opacity-60">Group by:</span>
          <button
            class="px-2 py-1 rounded cursor-pointer"
            :class="groupBy === 'family' ? 'bg-secondary text-secondary-content' : 'hover:underline'"
            @click="groupBy = 'family'"
          >Family</button>
          <button
            class="px-2 py-1 rounded cursor-pointer"
            :class="groupBy === 'genus' ? 'bg-secondary text-secondary-content' : 'hover:underline'"
            @click="groupBy = 'genus'"
          >Genus</button>
        </div>

        <template v-if="summaryAsSubjectGroups.length">
          <h3 class="text-sm font-semibold opacity-70 mb-2">As subject — objects by {{ groupBy }}</h3>
          <VTable class="mb-6">
            <VTableHeader class="normal-case">
              <VTableHeaderRow>
                <VTableHeaderCell>{{ groupBy === 'family' ? 'Family' : 'Genus' }}</VTableHeaderCell>
                <VTableHeaderCell>Associations</VTableHeaderCell>
              </VTableHeaderRow>
            </VTableHeader>
            <VTableBody>
              <VTableBodyRow
                v-for="group in summaryAsSubjectGroups"
                :key="group.key"
                class="cursor-pointer hover:bg-base-foreground"
                @click="selectGroup(group)"
              >
                <VTableBodyCell>{{ group.key }}</VTableBodyCell>
                <VTableBodyCell>{{ group.count }}</VTableBodyCell>
              </VTableBodyRow>
            </VTableBody>
          </VTable>
        </template>

        <template v-if="summaryAsObjectGroups.length">
          <h3 class="text-sm font-semibold opacity-70 mb-2">As object — subjects by {{ groupBy }}</h3>
          <VTable>
            <VTableHeader class="normal-case">
              <VTableHeaderRow>
                <VTableHeaderCell>{{ groupBy === 'family' ? 'Family' : 'Genus' }}</VTableHeaderCell>
                <VTableHeaderCell>Associations</VTableHeaderCell>
              </VTableHeaderRow>
            </VTableHeader>
            <VTableBody>
              <VTableBodyRow
                v-for="group in summaryAsObjectGroups"
                :key="group.key"
                class="cursor-pointer hover:bg-base-foreground"
                @click="selectGroup(group)"
              >
                <VTableBodyCell>{{ group.key }}</VTableBodyCell>
                <VTableBodyCell>{{ group.count }}</VTableBodyCell>
              </VTableBodyRow>
            </VTableBody>
          </VTable>
        </template>

        <div
          v-if="rawLoadState === 'ready' && !isLoading && !loadError && !summaryAsSubjectGroups.length && !summaryAsObjectGroups.length"
          class="text-xl text-center my-8 w-full"
        >
          No records found.
        </div>
      </template>

      <template v-else>
      <div
        v-if="viewMode === 'expert' && rawLoadState === 'loading'"
        data-testid="biological-associations-raw-loading"
        role="status"
        class="mb-4 text-sm"
      >Loading association records…</div>
      <button
        v-if="selectedGroup"
        class="mb-4 text-sm text-secondary hover:underline cursor-pointer"
        @click="clearGroupSelection"
      >&larr; {{ selectedGroup.fromStandard ? 'Back to Field Assistant' : 'Back to summary' }} ({{ selectedGroup.key }})</button>

      <VPagination
        v-if="biologicalAssociations.length"
        class="mb-4"
        v-model="pagination.page"
        :total="pagination.total"
        :per="pagination.per"
        @select="(value) => { loadBiologicalAssociations(value) }"
      />
      <VTable v-if="biologicalAssociations.length" ref="rawTableRoot">
        <VTableHeader class="normal-case">
          <VTableHeaderRow>
            <VTableHeaderCell colspan="2">Subject</VTableHeaderCell>
            <VTableHeaderCell class="border-l-2 border-r-2">Relationship</VTableHeaderCell>
            <VTableHeaderCell colspan="2">Object</VTableHeaderCell>
            <VTableHeaderCell class="border-l-2" colspan="3">Metadata</VTableHeaderCell>
          </VTableHeaderRow>
          <VTableHeaderRow>
            <VTableHeaderCell>Family</VTableHeaderCell>
            <VTableHeaderCell>Label</VTableHeaderCell>
            <VTableHeaderCell class="border-l-2 border-r-2">Relationship</VTableHeaderCell>
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
              <div class="flex flex-col gap-0.5" :data-copy-text="rawParticipantCopyText(ba, 'subject')">
                <div
                  v-if="ba.subjectSpecimenType"
                  class="flex items-center gap-1"
                >
                  <span class="text-xs opacity-50">{{ ba.subjectSpecimenType === 'CollectionObject' ? 'Collection Object' : 'Field Occurrence' }}</span>
                  <button
                    class="shrink-0 opacity-40 hover:opacity-100 cursor-pointer leading-none text-xs"
                    title="Show details"
                    @click="dwcTableRef.show({ id: ba.subjectSpecimenId, type: ba.subjectSpecimenType })"
                  >ⓘ</button>
                </div>
                <span>
                  <span v-if="ba.subjectLabelPrefix">{{ ba.subjectLabelPrefix }}</span>
                  <RouterLink
                    v-if="ba.subjectOtuId && ba.subjectHasTaxonName && ba.subjectFamily"
                    :to="{ name: 'otus-id', params: { id: ba.subjectOtuId } }"
                    class="hover:underline"
                    v-html="ba.subjectSpeciesHtml"
                  />
                  <span v-else v-html="ba.subjectSpeciesHtml" />
                  <!-- The name in current use, when the record was entered under
                       an older one. `px-1` and not a space: Vue's whitespace
                       condensing drops text nodes between elements. -->
                  <template v-if="ba.subjectAcceptedNameHtml">
                    <em class="px-1">now</em>
                    <RouterLink
                      v-if="ba.subjectAcceptedOtuId && ba.subjectFamily"
                      :to="{ name: 'otus-id', params: { id: ba.subjectAcceptedOtuId } }"
                      class="hover:underline"
                      v-html="ba.subjectAcceptedNameHtml"
                    />
                    <span v-else v-html="ba.subjectAcceptedNameHtml" />
                  </template>
                </span>
              </div>
            </VTableBodyCell>

            <VTableBodyCell class="border-l-2 border-r-2">{{ ba.biologicalRelationship }}</VTableBodyCell>

            <VTableBodyCell>{{ ba.objectFamily }}</VTableBodyCell>

            <!-- Object label -->
            <VTableBodyCell>
              <div class="flex flex-col gap-0.5" :data-copy-text="rawParticipantCopyText(ba, 'object')">
                <div
                  v-if="ba.objectSpecimenType"
                  class="flex items-center gap-1"
                >
                  <span class="text-xs opacity-50">{{ ba.objectSpecimenType === 'CollectionObject' ? 'Collection Object' : 'Field Occurrence' }}</span>
                  <button
                    class="shrink-0 opacity-40 hover:opacity-100 cursor-pointer leading-none text-xs"
                    title="Show details"
                    @click="dwcTableRef.show({ id: ba.objectSpecimenId, type: ba.objectSpecimenType })"
                  >ⓘ</button>
                </div>
                <span>
                  <span v-if="ba.objectLabelPrefix">{{ ba.objectLabelPrefix }}</span>
                  <RouterLink
                    v-if="ba.objectOtuId && ba.objectHasTaxonName && ba.objectFamily"
                    :to="{ name: 'otus-id', params: { id: ba.objectOtuId } }"
                    class="hover:underline"
                    v-html="ba.objectSpeciesHtml"
                  />
                  <span v-else v-html="ba.objectSpeciesHtml" />
                  <!-- The name in current use, when the record was entered under
                       an older one. `px-1` and not a space: Vue's whitespace
                       condensing drops text nodes between elements. -->
                  <template v-if="ba.objectAcceptedNameHtml">
                    <em class="px-1">now</em>
                    <RouterLink
                      v-if="ba.objectAcceptedOtuId && ba.objectFamily"
                      :to="{ name: 'otus-id', params: { id: ba.objectAcceptedOtuId } }"
                      class="hover:underline"
                      v-html="ba.objectAcceptedNameHtml"
                    />
                    <span v-else v-html="ba.objectAcceptedNameHtml" />
                  </template>
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
                  :alt="ba.images[0].figure_label"
                  :title="ba.images[0].figure_label"
                  class="h-12 w-12 object-cover rounded"
                />
                <span
                  v-if="ba.images.length > 1"
                  class="absolute -top-1 -right-1 bg-secondary text-secondary-content text-xs rounded-full px-1"
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
                  class="text-sm leading-snug"
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
                  class="text-left hover:underline cursor-pointer text-secondary"
                  @click="activeCitation = citation"
                >{{ citation.short }}</button>
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

      <VPagination
        v-if="biologicalAssociations.length"
        class="mt-4"
        v-model="pagination.page"
        :total="pagination.total"
        :per="pagination.per"
        @select="(value) => { loadBiologicalAssociations(value) }"
      />
      <div
        v-if="rawLoadState === 'ready' && !isLoading && !loadError && !biologicalAssociations.length"
        class="text-xl text-center my-8 w-full"
      >
        No records found.
      </div>
      </template>

      <!-- Shared details for Advanced and Raw data. -->
      <Teleport to="body">
        <ReferenceModal
          :citation="activeCitation && { citation_source_body: activeCitation.full }"
          @close="activeCitation = null"
        />
      </Teleport>

      <DwcTable ref="dwcTableRef" />



      <!-- Shared lightbox -->
      <ImageLightbox
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

    </VCardContent>
  </VCard>
</template>

<script setup>
/**
 * Standard view aggregates the complete directional /basic indices by the
 * opposite TaxonName (or OTU when no nomenclatural identity exists).
 * Plant anatomical parts are combined per associated taxon. OTUs and specimen
 * inventories provide names and missing classification.
 *
 * Expert view retains the original rank/threshold summaries and paginated
 * details, including depictions, distributions, citations and specimen modals.
 * Full association requests intentionally never extend taxonomy: the basic
 * index supplies classification without recomputing ancestry per record.
 */

import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { makeAPIRequest, sanitizeAndLinkifyHtml } from '@/utils'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest.js'
import {
  HIGHER_CLASSIFICATION_GROUP,
  FAMILY_GROUP,
  GENUS_GROUP,
  SPECIES_GROUP,
  SPECIES_AND_INFRASPECIES_GROUP
} from '@/modules/otus/constants'
import StandardAssociationsTable from './StandardAssociationsTable.vue'
import { advancedScope } from './browserSessionStorage.js'
import { VIEW_MODES, VIEW_MODE_LABELS, readViewMode, writeViewMode } from './viewModePreference.js'
import { copyTableSelection } from './tableClipboard.js'
import RelationshipFilter from './RelationshipFilter.vue'
import {
  alphabetical,
  filterRowsByRelationships,
  groupStandardAssociations,
  relationshipValue
} from './groupStandardAssociations.js'
import {
  associationHasTaxonNames,
  enrichAssociationFamilies,
  fetchAllAssociationPages,
  fillAssociationFamilies,
  loadDirectionalStandardSummary,
  loadOtuScopeMembership,
  loadOtusByIds,
  loadStandardTaxa,
  loadSummaryIndexes,
  participantOtuId,
  resolveAcceptedNames,
  splitAssociationsByDirection,
  unresolvedDirectionRows,
  validateAssociationPage,
  STANDARD_SUMMARY_PAGE_SIZE
} from './loadStandardAssociations.js'
import { loadAdvancedClassification } from './loadAdvancedAssociations.js'
import {
  indexRelationshipIds,
  readSessionRelationshipPreferences,
  writeSessionRelationshipPreferences,
  relationshipIdsForSelection,
  selectedRelationshipsForOptions,
  updateRelationshipPreferences
} from './relationshipPreferences.js'
import DwcTable from '../_shared/DwcTable.vue'
import ImageLightbox from '../_shared/ImageLightbox.vue'
import ReferenceModal from '../_shared/ReferenceModal.vue'
import { areaLabel } from './areaLabel.js'
import { stripHtml, shortCitation } from '../_shared/citationText.js'
import {
  makeBiologicalAssociation,
  plainText,
  resolveSpecimenRef,
  specimenKey
} from './makeBiologicalAssociation.js'

const fullExtend = ['object', 'subject', 'biological_relationship']
// Advanced reads the whole taxon from the cheap, precomputed index in one go.
// Filtering and sorting are client-side over every record, which only works if
// every record is in hand -- and the index is the only endpoint light enough
// for that. The live collection remains the deliberate contract of Raw data.
const ADVANCED_MAX_ROWS = 10000
const legacyBasicExtend = [
  'object',
  'subject',
  'biological_relationship',
  'taxonomy',
  'biological_relationship_types'
]
const AdvancedAssociationsTable = defineAsyncComponent(() => import('./AdvancedAssociationsTable.vue'))

const props = defineProps({
  otuId: {
    type: Number,
    required: true
  },
  otu: {
    type: Object,
    default: () => ({})
  },
  taxonId: {
    type: [Number, String],
    required: true
  },
  taxon: {
    type: Object,
    default: () => ({})
  },
  per: {
    type: Number,
    default: 50
  },
  // Rank groups ordered broadest-to-narrowest. `collapseAboveRank` is a cutoff,
  // inclusive of the named rank: this rank and anything narrower is
  // flat-eligible (see collapseThreshold below); anything broader always
  // shows the grouped summary. Default 'SpeciesGroup' reproduces the panel's
  // original species-only-flat behavior. Configured via `bind:` in
  // taxa_page.yml, e.g. collapseAboveRank: 'GenusGroup'.
  collapseAboveRank: {
    type: String,
    default: SPECIES_GROUP
  },
  // A flat-rank page (per collapseAboveRank) still escalates to the grouped
  // summary if its record count exceeds this. Infinity by default — i.e. off
  // unless set via taxa_page.yml — so behavior is unchanged until configured.
  collapseThreshold: {
    type: Number,
    default: Infinity
  }
})

const RANK_ORDER = [
  HIGHER_CLASSIFICATION_GROUP,
  FAMILY_GROUP,
  GENUS_GROUP,
  SPECIES_GROUP,
  SPECIES_AND_INFRASPECIES_GROUP
]

// PageLayout.vue (package) only forwards taxon-rank into its own internal
// v-if for whether to render a panel at all — it does NOT pass it down as a
// prop. The full taxon object *is* passed down, and carries rank_string, so
// read rank off that instead. An unmatched/misconfigured rank falls back to
// "collapse" (false) rather than "flat" — the safer default.
// Inclusive of collapseAboveRank itself: 'GenusGroup' means genus and
// everything narrower (species, infraspecies) is flat-eligible; only
// FamilyGroup/HigherClassificationGroup collapse unconditionally.
const isFlatRank = computed(() => {
  const cutoffIndex = RANK_ORDER.indexOf(props.collapseAboveRank)
  const rankIndex = RANK_ORDER.findIndex((group) => props.taxon?.rank_string?.includes(group))
  if (cutoffIndex === -1 || rankIndex === -1) return false
  return rankIndex >= cutoffIndex
})

// Set once a flat-rank page's fetched total exceeds collapseThreshold — see
// loadCurrentView, which fetches the flat table first in Expert view and promotes to the summary
// view after the fact rather than probing the count up front, since flat-rank
// (usually species) pages are the overwhelming majority of traffic and are
// almost never over threshold.
const forcedSummary = ref(false)

// Higher-rank (above collapseAboveRank) summary state. TaxonWorks expands the
// current taxon to descendants and nomenclatural coordinates in one /basic
// request; the matching OTU scope then restores the two directions. Raw rows
// are kept so groupBy can be switched client-side with no re-fetch.
const summaryAsSubjectRows = ref([]) // this taxon (or descendants) is the subject
const summaryAsObjectRows  = ref([]) // this taxon (or descendants) is the object
const summaryLoaded = ref(false)
const hasExcludedAssociations = ref(false)
const viewMode = ref('standard')
const standardReady = ref(false)
const standardLoadState = ref('idle')
const standardIndexComplete = ref(false)
const standardIndexError = ref('')
const advancedReady = ref(false)
const advancedLoadState = ref('idle')
const advancedMetadataError = ref('')
const advancedRows = ref([])
const advancedTaxa = ref({ otuById: new Map(), dwcBySpecimen: new Map() })
// Family, subfamily, tribe and the genus OTU for every name Advanced shows.
// The panel owns this because it decides when the view is complete enough to
// appear, and the user asked to see a finished table rather than one that
// fills in its Family column afterwards.
const advancedClassification = ref(new Map())
const advancedToolbar = ref(null)
const advancedRowsToolbar = ref(null)
const advancedCount = ref(0)
const standardTaxa = ref({ otuById: new Map(), dwcBySpecimen: new Map() })
const loadError = ref('')
const selectedRelationships = ref([])
const relationshipPreferences = ref({})
const relationshipIdsByName = ref(new Map())
const relationshipIdsLoaded = ref(false)
const allAssociationRows = computed(() => [...new Map([
  ...summaryAsSubjectRows.value, ...summaryAsObjectRows.value
].map(row => [row.id, row])).values()])

const relationshipOptions = computed(() => [...new Set([
  ...summaryAsSubjectRows.value,
  ...summaryAsObjectRows.value
].map(relationshipValue))].sort(alphabetical))
const filteredStandardSubjectRows = computed(() =>
  filterRowsByRelationships(summaryAsSubjectRows.value, selectedRelationships.value)
)
const filteredStandardObjectRows = computed(() =>
  filterRowsByRelationships(summaryAsObjectRows.value, selectedRelationships.value)
)

// The Field Assistant follows neither the relationship dropdown -- that belongs
// to Raw data -- nor a filter of its own. It lists every associated taxon the
// index holds and grades each one instead: the evidence rule decides the colour
// of the row's dot, not whether the row is there at all.
const standardAsSubject = computed(() => standardReady.value
  ? groupStandardAssociations(summaryAsSubjectRows.value, 'subject', standardTaxa.value.otuById, standardTaxa.value.dwcBySpecimen)
  : [])
const standardAsObject = computed(() => standardReady.value
  ? groupStandardAssociations(summaryAsObjectRows.value, 'object', standardTaxa.value.otuById, standardTaxa.value.dwcBySpecimen)
  : [])
const groupBy = ref('family') // 'family' | 'genus'
const selectedGroup = ref(null) // { key, count, ids } while drilled into one group

const showSummary = computed(() => (!isFlatRank.value || forcedSummary.value) && !selectedGroup.value)

function groupRows(rows, side) {
  const groups = new Map()
  for (const row of rows) {
    const key = row[side]?.[groupBy.value] || 'Unclassified'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row.id)
  }
  return [...groups.entries()]
    .map(([key, ids]) => ({ key, count: ids.length, ids }))
    .sort((a, b) => alphabetical(a.key, b.key))
}

// This taxon is the subject → the interesting summary is the object side, and vice versa.
const summaryAsSubjectGroups = computed(() => groupRows(filteredStandardSubjectRows.value, 'object'))
const summaryAsObjectGroups  = computed(() => groupRows(filteredStandardObjectRows.value, 'subject'))

const headerCount = computed(() => {
  if (viewMode.value === 'advanced') return advancedCount.value
  if (viewMode.value === 'expert' && !showSummary.value) return pagination.value.total
  // The Field Assistant counts the whole index; the Raw data summary counts
  // what the relationship dropdown leaves.
  if (viewMode.value === 'standard') return allAssociationRows.value.length
  const rows = [...filteredStandardSubjectRows.value, ...filteredStandardObjectRows.value]
  return new Set(rows.map((r) => r.id)).size
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
const failedAdvancedCitation = ref(null)
const failedAdvancedMetadata = ref(null)
const dwcTableRef = ref(null)
const rawTableRoot = ref(null)
const rawLoadState = ref('idle')

function rawParticipantCopyText(row, side) {
  if (!row[side + 'SpecimenType']) return undefined
  return plainText((row[side + 'LabelPrefix'] || '') + row[side + 'SpeciesHtml'])
    + ` (${row[side + 'SpecimenType']})`
}
function copyRawSelection(event) { copyTableSelection(event, rawTableRoot.value?.$el) }

const dwcPromiseCache = {} // keyed by otuId — used for OTU search locality
// One membership answer per taxon and OTU, for the panel's lifetime: the same
// participants come back whenever a view reloads, and nomenclature does not
// change while a page is open.
const otuScopeMembership = new Map()
const expertOtuById = new Map()
const taxonomicFamilyCache = new Map()
const advancedClassificationCache = new Map()
const advancedSourceCache = new Map()
let advancedTaxaRequestId = 0
let groupSelectionToken = 0

function fetchDwcForOtu(otuId, errorSet = null) {
  if (!dwcPromiseCache[otuId]) {
    dwcPromiseCache[otuId] = makeAPIRequest
    .get(`/otus/${otuId}/inventory/dwc.json`)
    .then((r) => {
      if (!Array.isArray(r.data)) throw new Error('Expected a DwC record list')
      return r.data
    })
  }
  return dwcPromiseCache[otuId].catch((error) => {
      delete dwcPromiseCache[otuId]
      if (errorSet) {
        errorSet.add(String(otuId))
        reportLoadError(error, {
          view: 'standard', phase: 'optional DwC inventory', route: '/otus/:id/inventory/dwc.json'
        })
      }
      return []
    })
}

function reportLoadError(error, context) {
  if (typeof __APP_ENV__ !== 'undefined' && __APP_ENV__.debug && typeof console !== 'undefined') {
    console.warn('[biological-associations]', {
      view: context.view,
      phase: context.phase,
      route: context.route,
      status: error?.response?.status || error?.status || null,
      message: error?.message || String(error)
    })
  }
}

async function fetchOtuScopeMembership(otuIds, taxonNameId, isCurrent) {
  const key = id => `${taxonNameId}:${id}`
  const unknown = otuIds.filter(id => !otuScopeMembership.has(key(id)))
  if (unknown.length) {
    // This page's own OTU rides along as the anchor the coordinate expansion
    // needs; it is the same for every batch, so the cache key stays the taxon.
    const inScope = await loadOtuScopeMembership(unknown, taxonNameId, makeAPIRequest, isCurrent,
      props.otuId ? [props.otuId] : [])
    if (!inScope) return null
    unknown.forEach(id => otuScopeMembership.set(key(id), inScope.has(id)))
  }
  return new Set(otuIds.filter(id => otuScopeMembership.get(key(id))))
}

function openViewer(ba) {
  viewer.images = ba.images
  viewer.index = 0
}

onMounted(() => {
  document.addEventListener('copy', copyRawSelection)
  restoreViewMode()
  watch(() => [props.taxonId, props.otuId], () => {
    ++loadRequestId
    summaryLoaded.value = false
    hasExcludedAssociations.value = false
    standardReady.value = false
    standardLoadState.value = 'idle'
    standardIndexComplete.value = false
    standardIndexError.value = ''
    advancedReady.value = false
    advancedLoadState.value = 'idle'
    advancedMetadataError.value = ''
    failedAdvancedCitation.value = null
    failedAdvancedMetadata.value = null
    advancedTaxaRequestId++
    advancedRows.value = []
    advancedTaxa.value = { otuById: new Map(), dwcBySpecimen: new Map() }
    advancedClassification.value = new Map()
    advancedCount.value = 0
    rawLoadState.value = 'idle'
    summaryAsSubjectRows.value = []
    summaryAsObjectRows.value = []
    selectedRelationships.value = []
    relationshipPreferences.value = readSessionRelationshipPreferences()
    standardTaxa.value = { otuById: new Map(), dwcBySpecimen: new Map() }
    selectedGroup.value = null
    forcedSummary.value = false
    biologicalAssociations.value = []
    pagination.value = { page: 1, per: props.per, total: 0 }
    loadCurrentView()
  }, { immediate: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('copy', copyRawSelection)
  ++loadRequestId
})

function setSelectedRelationships(selected) {
  selectedRelationships.value = selected
  relationshipPreferences.value = updateRelationshipPreferences(
    relationshipOptions.value,
    selected,
    { ...relationshipPreferences.value, ...readSessionRelationshipPreferences() }
  )
  writeSessionRelationshipPreferences(relationshipPreferences.value)
  selectedGroup.value = null
  forcedSummary.value = false
  return refreshExpertRelationships()
}

function refreshExpertRelationships() {
  if (viewMode.value !== 'expert') return
  // A drilled-down group's ids were calculated for the previous selection.
  // Return to the complete taxon scope before applying the new server filter.
  selectedGroup.value = null
  forcedSummary.value = false
  biologicalAssociations.value = []
  pagination.value = { page: 1, per: props.per, total: 0 }
  return loadCurrentView()
}

/**
 * Restoring the saved view belongs on mount, not in the ref's initial value:
 * the server renders this panel too, and it has no browser storage to read.
 * Starting both renders in the Field Assistant keeps hydration in step, and
 * the mount below switches the view before the first request goes out, so a
 * restored Advanced does not load the Field Assistant's index first.
 */
function restoreViewMode() {
  viewMode.value = readViewMode()
}

function setViewMode(mode) {
  if (viewMode.value === mode) return
  viewMode.value = mode
  writeViewMode(mode)
  selectedGroup.value = null
  forcedSummary.value = false
  pagination.value = { page: 1, per: props.per, total: 0 }
  activeCitation.value = null
  advancedMetadataError.value = ''
  failedAdvancedCitation.value = null
  failedAdvancedMetadata.value = null
  viewer.images = []
  rawLoadState.value = 'idle'
  return loadCurrentView()
}

async function loadCurrentView() {
  ++loadRequestId
  isLoading.value = false
  loadError.value = ''
  if (viewMode.value === 'standard') {
    await loadStandardView()
    return
  }
  if (viewMode.value === 'advanced') {
    await loadAdvancedView()
    return
  }

  // The basic indices supply the complete relationship option list. Loading
  // them before Expert details also keeps its server-side pagination exact.
  if (!summaryLoaded.value) {
    const summaryRequestId = loadRequestId + 1
    await loadSummary()
    if (summaryRequestId !== loadRequestId || !summaryLoaded.value || viewMode.value !== 'expert') return
  }

  if (!showSummary.value) {
    const requestId = loadRequestId + 1
    await loadBiologicalAssociations(pagination.value.page)
    if (requestId !== loadRequestId) return
    // The user may have changed mode or opened a group while details loaded.
    if (viewMode.value === 'expert' && !selectedGroup.value && pagination.value.total > props.collapseThreshold) {
      forcedSummary.value = true
      await loadSummary()
    }
  }
}

/**
 * TaxonWorks' OTU query includes determinations, descendants and all
 * nomenclatural coordinates. Read all index pages before aggregating, so a
 * species or synonym cannot disappear at a page boundary. Standard and Expert
 * summaries share the same index data, and the two directional reads beside it
 * say which side of each association this taxon is on.
 */
async function ensureSummary(requestId) {
  if (summaryLoaded.value) {
    return {
      asSubject: summaryAsSubjectRows.value,
      asObject: summaryAsObjectRows.value,
      otuById: standardTaxa.value.otuById,
      hasExcluded: hasExcludedAssociations.value
    }
  }
  const taxonId = props.taxonId
  const isCurrent = () => requestId === loadRequestId
  const indexes = await loadSummaryIndexes(
    taxonId,
    makeAPIRequest,
    isCurrent,
    // The index is the summary's own data, so read it in as few requests as the
    // server allows: every extra page is a round trip before anything appears.
    STANDARD_SUMMARY_PAGE_SIZE,
    // Surface a degraded index instead of dropping the whole summary: the rows
    // that were read are still shown, with the warning line and its Retry.
    issue => { if (isCurrent()) standardIndexError.value = issue }
  )
  if (!indexes || !isCurrent()) return null
  const { rows, subjectIds, objectIds } = indexes
  const otuById = new Map(standardTaxa.value.otuById)
  const participantIds = list => [...new Set(list
    .flatMap(row => ['subject', 'object'].map(side => participantOtuId(row, side)))
    .filter(Boolean).map(String))]
  const ids = participantIds(rows)
  // Two questions about the same index, neither needing the other's answer:
  // which side the handful of rows the directional reads left over belong to,
  // and which participants carry a name. The leftovers follow from the index
  // alone, so they can be asked about before the names are in.
  const unresolved = unresolvedDirectionRows(rows, subjectIds, objectIds)
  const [otuScope, otus] = await Promise.all([
    fetchOtuScopeMembership(participantIds(unresolved), taxonId, isCurrent),
    loadOtusByIds(ids.filter(id => !otuById.has(id)), makeAPIRequest, isCurrent, 3)
  ])
  if (!otuScope || !otus || !isCurrent()) return null
  otus.forEach(otu => otuById.set(String(otu.id), otu))
  const namedRows = rows.filter(row => associationHasTaxonNames(row, otuById))
  const { asSubject, asObject } = splitAssociationsByDirection(namedRows, subjectIds, objectIds, otuScope)
  return { asSubject, asObject, otuById, hasExcluded: namedRows.length !== rows.length }
}

async function loadSummary() {
  const requestId = ++loadRequestId
  isLoading.value = true
  rawLoadState.value = 'loading'
  try {
    const result = await ensureSummary(requestId)
    if (!result || requestId !== loadRequestId) return
    summaryAsSubjectRows.value = result.asSubject
    summaryAsObjectRows.value = result.asObject
    standardTaxa.value = { ...standardTaxa.value, otuById: result.otuById }
    hasExcludedAssociations.value = result.hasExcluded
    selectedRelationships.value = selectedRelationshipsForOptions(
      relationshipOptions.value,
      relationshipPreferences.value
    )
    summaryLoaded.value = true
    rawLoadState.value = 'ready'
  } catch (error) {
    if (requestId !== loadRequestId) return
    summaryAsSubjectRows.value = []
    summaryAsObjectRows.value = []
    summaryLoaded.value = false
    rawLoadState.value = 'error'
    loadError.value = 'The association summary could not be loaded.'
    reportLoadError(error, { view: 'raw', phase: 'summary index', route: '/biological_associations/basic' })
  } finally {
    if (requestId === loadRequestId) isLoading.value = false
  }
}

async function loadStandardView() {
  const requestId = ++loadRequestId
  const isCurrent = () => requestId === loadRequestId && viewMode.value === 'standard'
  if (standardReady.value && standardLoadState.value === 'ready') return
  isLoading.value = true
  standardLoadState.value = 'loading'
  standardIndexComplete.value = false
  standardIndexError.value = ''
  standardReady.value = false
  // The two row refs are not cleared here. On a flat rank they are
  // ensureSummary's own cache, so emptying them first made it hand back two
  // empty lists: after a visit to Raw data, which is what fills them, the
  // Field Assistant then said "No records found." for a taxon the index does
  // hold. standardReady above already hides the table while this runs, and a
  // change of taxon clears both refs in its own watcher.
  try {
    let result = isFlatRank.value
      ? await ensureSummary(requestId)
      : await loadDirectionalStandardSummary(props.taxonId, makeAPIRequest, isCurrent, undefined,
        issue => { if (isCurrent()) standardIndexError.value = issue })
    if (!result || !isCurrent()) return

    const standardDwcErrors = new Set()
    const data = await loadStandardTaxa(
      result.asSubject,
      result.asObject,
      makeAPIRequest,
      otuId => fetchDwcForOtu(otuId, standardDwcErrors),
      isCurrent,
      result.otuById || standardTaxa.value.otuById
    )
    if (!data || !isCurrent()) return
    if (standardDwcErrors.size) {
      standardIndexError.value = 'Some specimen details could not be loaded.'
    }

    const allRows = [...new Map([
      ...result.asSubject,
      ...result.asObject
    ].map(row => [String(row.id), row])).values()]
    let preparedRows = allRows
    try {
      // Family completion is useful but not required for a valid Basic index.
      // Keep the complete index visible if an optional ancestry lookup fails.
      const filled = await enrichAssociationFamilies(
        allRows,
        makeAPIRequest,
        data.otuById,
        taxonomicFamilyCache,
        allRows,
        isCurrent
      )
      if (filled) preparedRows = filled
      else if (isCurrent()) standardIndexError.value = 'Some family details could not be loaded.'
    } catch (error) {
      if (isCurrent()) {
        standardIndexError.value = 'Some family details could not be loaded.'
        reportLoadError(error, { view: 'standard', phase: 'optional classification', route: '/taxon_names' })
      }
    }
    if (!isCurrent()) return

    const byId = new Map(preparedRows.map(row => [String(row.id), row]))
    const asSubject = result.asSubject.map(row => byId.get(String(row.id)) || row)
    const asObject = result.asObject.map(row => byId.get(String(row.id)) || row)
    summaryAsSubjectRows.value = asSubject
    summaryAsObjectRows.value = asObject
    standardTaxa.value = data
    hasExcludedAssociations.value = result.hasExcluded || false
    selectedRelationships.value = selectedRelationshipsForOptions(
      relationshipOptions.value,
      relationshipPreferences.value
    )
    standardIndexComplete.value = true
    standardReady.value = true
    standardLoadState.value = 'ready'
  } catch (error) {
    if (isCurrent()) {
      standardReady.value = false
      standardLoadState.value = 'error'
      standardTaxa.value = { otuById: new Map(), dwcBySpecimen: new Map() }
      loadError.value = 'The standard view could not be loaded completely.'
      reportLoadError(error, { view: 'standard', phase: 'primary index', route: '/biological_associations/basic' })
    }
  } finally {
    if (isCurrent()) {
      isLoading.value = false
      if (standardLoadState.value === 'loading') standardLoadState.value = 'error'
    }
  }
}

function retryStandardView() {
  standardReady.value = false
  standardLoadState.value = 'idle'
  standardIndexError.value = ''
  loadError.value = ''
  return loadStandardView()
}

async function loadAdvancedView() {
  if (advancedReady.value && advancedLoadState.value === 'ready') return
  await loadAdvancedRows()
}

/**
 * Load Advanced from the cheap, precomputed /basic index -- but the whole
 * taxon, not one page of it. Filtering and sorting are client-side and have to
 * see every record, so every record has to be here. Species pages keep the old
 * current-OTU scope; higher-rank pages use the same TaxonName descendant scope
 * as Standard, otherwise a tribe/family OTU has no rows of its own even though
 * its descendants do.
 *
 * Nothing is published until names and families are complete: the table
 * appears finished rather than rewriting its own cells while being read.
 */
async function loadAdvancedRows() {
  if (viewMode.value !== 'advanced') return
  const requestId = ++loadRequestId
  const isCurrent = () => requestId === loadRequestId && viewMode.value === 'advanced'
  // VSpinner is an opaque overlay across the whole card, so only raise it while
  // there is nothing to cover -- the first build of the view. Switching back to
  // a loaded Advanced view costs nothing and must not blank the card.
  if (!advancedReady.value) isLoading.value = true
  advancedLoadState.value = 'loading'
  advancedMetadataError.value = ''
  failedAdvancedCitation.value = null
  // Keep the table mounted and keep showing the previous rows while the next
  // taxon loads. Clearing `advancedReady` here unmounts AdvancedAssociationsTable
  // (v-if) and loses the settings the remounted instance would have to rebuild.
  // `advancedLoadState` is what signals loading; the taxon watcher still resets
  // rows on a real change.
  loadError.value = ''
  try {
    const scope = isFlatRank.value
      ? { 'otu_query[coordinatify]': true, 'otu_query[otu_id][]': props.otuId }
      : {
          'otu_query[coordinatify]': true,
          'otu_query[taxon_name_id][]': props.taxonId,
          'otu_query[descendants]': true
        }
    const data = await fetchAllAssociationPages(
      (page, per) => {
        const request = () => makeAPIRequest.get('/biological_associations/basic', {
          params: { ...scope, per, page, extend: legacyBasicExtend }
        })
        // The package's request store expects one axios response per panel and
        // uses it for the panel's own data map, so only the first page is
        // registered there.
        return page === 1
          ? useOtuPageRequest('panel:biological-associations-v2', request)
          : request()
      },
      isCurrent,
      row => row.id,
      STANDARD_SUMMARY_PAGE_SIZE,
      // Keep the first anomaly: it is the one that explains the rest.
      issue => { if (isCurrent() && !advancedMetadataError.value) advancedMetadataError.value = issue },
      ADVANCED_MAX_ROWS
    )
    if (!data || !isCurrent()) return
    if (advancedMetadataError.value) failedAdvancedMetadata.value = {}

    const otuIds = [...new Set(data.flatMap(row =>
      ['subject', 'object'].map(side => participantOtuId(row, side))
    ).filter(Boolean).map(String))]
    // Both enrichments are on the critical path on purpose. The OTUs carry the
    // accepted TaxonName the table shows as the name in current use, and the
    // classification supplies the Family the index leaves empty for most
    // plants -- a table without them would rewrite half its cells a moment
    // later.
    let rows = data
    if (otuIds.length) {
      try {
        const taxa = await loadAdvancedTaxa(otuIds)
        if (!taxa || !isCurrent()) return
        const classification = await loadAdvancedClassificationFor(data, taxa.otuById, isCurrent)
        if (!classification || !isCurrent()) return
        advancedClassification.value = classification
        // The index is not consistent about `family`: the same OTU can carry
        // one on one record and none on the next. Copy it across before
        // falling back to ancestry, which is the only thing an OTU without a
        // TaxonName has left. Pure, so it costs nothing.
        rows = fillAssociationFamilies(data, taxa.otuById, new Map(), data)
      } catch (metadataError) {
        if (isCurrent()) {
          advancedMetadataError.value = 'Some taxonomy could not be loaded.'
          failedAdvancedMetadata.value = {}
          reportLoadError(metadataError, { view: 'advanced', phase: 'taxonomy', route: '/otus' })
        }
      }
    }
    if (!isCurrent()) return
    advancedRows.value = rows
    advancedReady.value = true
    advancedLoadState.value = 'ready'
  } catch (error) {
    if (requestId === loadRequestId) {
      advancedReady.value = false
      advancedLoadState.value = 'error'
      loadError.value = 'The advanced view could not be loaded completely.'
      reportLoadError(error, { view: 'advanced', phase: 'primary index', route: '/biological_associations/basic' })
    }
  } finally {
    if (requestId === loadRequestId) isLoading.value = false
  }
}

/**
 * Resolve Family (and Subfamily/Tribe when those columns are in play) through
 * one batched walk up the parent chain, sharing ancestors between rows.
 * The per-name `/taxon_names/:id?extend[]=ancestor_ids` lookup that Standard
 * still uses costs one request per name -- measured 1061 names on the project
 * root -- which a complete Advanced view cannot afford.
 */
async function loadAdvancedClassificationFor(rows, otuById, isCurrent) {
  const wanted = new Map()
  for (const row of rows) {
    for (const side of ['subject', 'object']) {
      const otuId = participantOtuId(row, side)
      const otu = otuId && otuById.get(String(otuId))
      if (otu) wanted.set(String(otuId), otu)
    }
  }
  // The walk shares every ancestor between rows, so covering all names rather
  // than only the ones missing a family costs a handful of extra requests --
  // and it means switching the Subfamily or Tribe column on afterwards needs
  // no further loading at all.
  if (!wanted.size) return advancedClassification.value
  return loadAdvancedClassification(wanted, makeAPIRequest, advancedClassificationCache, isCurrent)
}

/** Load the OTUs the Advanced rows refer to, skipping the ones already held. */
async function loadAdvancedTaxa(ids) {
  if (viewMode.value !== 'advanced') return null
  const requestId = ++advancedTaxaRequestId
  const wanted = [...new Set(ids.map(String))]
  const missing = wanted.filter(id => !advancedTaxa.value.otuById.has(id))
  if (!missing.length) return advancedTaxa.value

  const isCurrent = () => requestId === advancedTaxaRequestId && viewMode.value === 'advanced'
  try {
    const otus = await loadOtusByIds(missing, makeAPIRequest, isCurrent, 3)
    if (!otus || !isCurrent()) return null
    const otuById = new Map(advancedTaxa.value.otuById)
    for (const otu of otus) otuById.set(String(otu.id), otu)
    // The same resolution every view runs, so an OTU filed under an older name
    // still shows the name in current use and links to the right OTU page.
    if (!await resolveAcceptedNames(otuById, wanted, makeAPIRequest, isCurrent)) return null
    if (!isCurrent()) return null
    advancedTaxa.value = { ...advancedTaxa.value, otuById }
    return advancedTaxa.value
  } catch (error) {
    reportLoadError(error, { view: 'advanced', phase: 'current-page taxonomy', route: '/otus' })
    throw error
  }
}

async function loadAdvancedImages(ids) {
  const requestId = loadRequestId
  const result = new Map()
  if (!ids.length) return result
  try {
    const { data } = await makeAPIRequest.get('/depictions/gallery', {
      params: {
        depiction_object_type: ['BiologicalAssociation'],
        depiction_object_id: ids,
        per: 200
      }
    })
    if (requestId !== loadRequestId) return result
    for (const depiction of data || []) {
      const image = makeGalleryImage(depiction)
      const id = String(depiction.depiction_object_id)
      if (!result.has(id)) result.set(id, [])
      result.get(id).push(image)
    }
  } catch (error) {
    reportLoadError(error, { view: 'advanced', phase: 'images', route: '/depictions/gallery' })
    throw error
  }
  return result
}

async function showAdvancedCitations({ associationId, citationId, full = '' }) {
  const requestId = loadRequestId
  advancedMetadataError.value = ''
  failedAdvancedCitation.value = { associationId, citationId, full }
  // The source lookup already carries the rendered reference, so the usual
  // case opens without a request at all.
  if (full) {
    activeCitation.value = { id: citationId, full }
    failedAdvancedCitation.value = null
    return
  }
  try {
    const citations = await fetchLegacyCitations(associationId, requestId)
    if (requestId !== loadRequestId || viewMode.value !== 'advanced') return
    const entries = citations.get(associationId) || []
    // The table's fallback button carries no citation id — it renders the
    // /basic summary string rather than an individual reference. Show the
    // record just fetched instead of letting a String(null) lookup miss and
    // falling through to the summary rows, which are empty when Advanced was
    // opened directly.
    const match = citationId == null
      ? null
      : entries.find(entry => String(entry.id) === String(citationId))
    activeCitation.value = match || entries[0]
      || { full: allAssociationRows.value.find(row => row.id === associationId)?.citations || '' }
  } catch (error) {
    if (requestId === loadRequestId) {
      advancedMetadataError.value = 'The references could not be loaded.'
      reportLoadError(error, { view: 'advanced', phase: 'citation', route: '/citations' })
    }
  }
}

function retryAdvancedMetadata() {
  if (failedAdvancedCitation.value) return showAdvancedCitations(failedAdvancedCitation.value)
  if (failedAdvancedMetadata.value) return loadAdvancedRows()
}

/** The old citation modal fetched one association lazily, with scalar object
 * parameters and both source/citation-topic extensions. */
async function fetchLegacyCitations(associationId, requestId) {
  const params = new URLSearchParams()
  params.set('citation_object_id', associationId)
  params.set('citation_object_type', 'BiologicalAssociation')
  params.append('extend[]', 'source')
  params.append('extend[]', 'citation_topics')
  const citations = await fetchMetadata(`/citations?${params.toString()}`, requestId)
  const result = new Map([[associationId, []]])
  for (const cit of citations) {
    result.get(associationId).push({
      id: cit.id,
      short: cit.citation_source_body || '',
      full: cit.source?.cached || cit.citation_source_body || ''
    })
  }
  return result
}

async function showStandardRecords(group) {
  // A drilldown is a round trip -- its back button returns to the Field
  // Assistant -- so it opens Raw data without saving it as the chosen view.
  viewMode.value = 'expert'
  return selectGroup({ ...group, key: group.name, detailKey: group.key, fromStandard: true })
}

async function selectGroup(group) {
  const selectionToken = ++groupSelectionToken
  loadError.value = ''
  // Vue wraps objects stored in a ref in a reactive proxy. Comparing the
  // stored object with the argument by identity therefore rejects a valid
  // selection before the Raw request starts. A scalar token is stable across
  // that proxy conversion and also lets a newer click supersede an older one.
  selectedGroup.value = { ...group, ids: [...(group.ids || [])] }
  pagination.value = { page: 1, per: props.per, total: group.count }
  if (selectionToken !== groupSelectionToken) return
  const refreshed = group.detailKey
    ? [...standardAsSubject.value, ...standardAsObject.value]
      .find(candidate => candidate.key === group.detailKey)
    : null
  if (refreshed) {
    selectedGroup.value = { ...group, ...refreshed, key: group.key }
    pagination.value = { page: 1, per: props.per, total: refreshed.count }
  }
  if (selectionToken !== groupSelectionToken) return
  return loadBiologicalAssociations(1)
}

function clearGroupSelection() {
  ++groupSelectionToken
  const fromStandard = selectedGroup.value?.fromStandard
  ++loadRequestId
  selectedGroup.value = null
  biologicalAssociations.value = []
  if (fromStandard) viewMode.value = 'standard'
  loadCurrentView()
}

function makeGalleryImage(depiction) {
  const image = depiction.image || {}
  const original = image.original || (image.original_png && typeof __APP_ENV__ !== 'undefined'
    ? `${__APP_ENV__.url}/${image.original_png.substring(8)}?project_token=${__APP_ENV__.project_token}`
    : image.original_png)
  return {
    id: image.id,
    thumb: image.thumb,
    original,
    medium: image.medium,
    attribution: { label: depiction.attribution?.label || '' },
    source: { label: '' },
    // A BA plate is not an Otu/CO/FO depiction — hand the label + caption to
    // ImageLightbox as real fields (it shows label bold, caption beneath).
    // The old shape faked depictions:[{label: figure_label}], which the shared
    // lightbox would have run through its taxon-name parser.
    figure_label: depiction.figure_label || '',
    caption: depiction.caption || '',
    depictions: [],
    _associationId: depiction.depiction_object_id
  }
}

async function fetchMetadata(url, requestId) {
  return await fetchAllAssociationPages(
    (page, per) => makeAPIRequest.get(url, { params: { page, per } }),
    () => requestId === loadRequestId,
    // Gallery responses can omit a top-level id. Keep distinct depictions
    // of the same image rather than collapsing them by image id.
    row => row.id ?? row.depiction_id ?? JSON.stringify(row)
  ) || []
}

async function fetchDepictions(associationIds, requestId) {
  if (!associationIds.length) return new Map()

  const depictionParams = new URLSearchParams()
  depictionParams.append('depiction_object_type', 'BiologicalAssociation')
  associationIds.forEach((id) => depictionParams.append('depiction_object_id[]', id))

  const depictions = await fetchMetadata(`/depictions?${depictionParams.toString()}`, requestId)
  if (!depictions.length) return new Map()

  const galleryParams = new URLSearchParams()
  depictions.forEach((d) => galleryParams.append('depiction_id[]', d.id))
  const galleryItems = await fetchMetadata(`/depictions/gallery?${galleryParams.toString()}`, requestId)

  const result = new Map()
  const allImages = []
  for (const item of galleryItems) {
    const image = makeGalleryImage(item)
    if (!result.has(image._associationId)) result.set(image._associationId, [])
    result.get(image._associationId).push(image)
    allImages.push(image)
  }

  if (allImages.length) {
    try {
      const imgParams = new URLSearchParams()
      allImages.forEach((img) => imgParams.append('image_id[]', img.id))
      imgParams.append('extend[]', 'source')
      const imgDataList = await fetchMetadata(`/images?${imgParams.toString()}`, requestId)
      const sourceByImageId = new Map(imgDataList.map((d) => [d.id, d.source]))
      for (const image of allImages) {
        const src = sourceByImageId.get(image.id)
        if (src?.label) {
          image.source = { label: sanitizeAndLinkifyHtml(src.label) }
        }
      }
    } catch { /* source unavailable */ }
  }
  return result
}

/** Entries share one shape with the Advanced producers -- { id, short, full }.
 * `full` is what the ReferenceModal binding reads; a second key name here left
 * the Raw data modal empty. */
async function fetchCitations(associationIds, requestId) {
  if (!associationIds.length) return new Map()

  const citParams = new URLSearchParams()
  citParams.append('citation_object_type', 'BiologicalAssociation')
  citParams.append('extend[]', 'source')
  associationIds.forEach((id) => citParams.append('citation_object_id[]', id))

  const citations = await fetchMetadata(`/citations?${citParams.toString()}`, requestId)

  const result = new Map()
  for (const cit of citations) {
    const entry = {
      id: cit.id,
      short: shortCitation(stripHtml(cit.citation_source_body || '')),
      full: cit.source?.cached || cit.citation_source_body || ''
    }
    if (!result.has(cit.citation_object_id)) result.set(cit.citation_object_id, [])
    result.get(cit.citation_object_id).push(entry)
  }
  return result
}

async function fetchDistributions(associationIds, requestId) {
  if (!associationIds.length) return new Map()

  const params = new URLSearchParams()
  associationIds.forEach((id) => params.append('biological_association_id[]', id))
  const data = await fetchMetadata(`/asserted_distributions?${params.toString()}`, requestId)

  const result = new Map()
  for (const dist of data) {
    const baId = dist.asserted_distribution_object_id
    const entry = {
      id: dist.id,
      area: areaLabel(dist.asserted_distribution_shape),
      isAbsent: !!dist.is_absent
    }
    if (!result.has(baId)) result.set(baId, [])
    result.get(baId).push(entry)
  }
  return result
}

/**
 * Query-string prefix scoping the request to either the taxon (default) or
 * a specific group's association ids (once drilled in from the summary).
 * Built as a literal query string, not an axios params object — id lists
 * need repeated `biological_association_id[]=` entries the same way every
 * other multi-id filter in this file does (see fetchDepictions etc.), which
 * an object passed to axios `params` isn't guaranteed to serialize as.
 */
function scopeQueryString(relationshipIds = null) {
  const params = new URLSearchParams()
  if (selectedGroup.value) {
    selectedGroup.value.ids.forEach((id) => params.append('biological_association_id[]', id))
  } else {
    params.append('otu_query[coordinatify]', 'true')
    params.append('otu_query[taxon_name_id][]', props.taxonId)
    params.append('otu_query[descendants]', 'true')
  }
  relationshipIds?.forEach((id) => params.append('biological_relationship_id[]', id))
  return params.toString()
}

async function ensureRelationshipIds(requestId) {
  if (relationshipIdsLoaded.value) return true
  const isCurrent = () => requestId === loadRequestId
  const relationships = await fetchAllAssociationPages(
    (page, per) => makeAPIRequest.get('/biological_relationships', {
      params: { page, per }
    }),
    isCurrent
  )
  if (!relationships || !isCurrent()) return false
  relationshipIdsByName.value = indexRelationshipIds(relationships)
  relationshipIdsLoaded.value = true
  return true
}

/**
 * Fetches the same page from /biological_associations/basic (same scope/
 * page/per params, so it lines up 1:1 with the full-endpoint page by id).
 * Reads from biological_association_indices — cheap even at large per,
 * unlike extend[]=taxonomy on the live model. Returns Map<associationId, basicRow>.
 */
async function fetchBasic(url, params) {
  const response = await makeAPIRequest.get(url, { params })
  const { data } = validateAssociationPage(response, params.page, row => row.id)
  return new Map(data.map((row) => [row.id, row]))
}

async function enrichExpertFamilies(basicMap, requestId) {
  const isCurrent = () => requestId === loadRequestId
  const familyRows = [
    ...summaryAsSubjectRows.value,
    ...summaryAsObjectRows.value
  ]
  const otuById = new Map([
    ...standardTaxa.value.otuById,
    ...expertOtuById
  ])
  if (props.otu?.id) {
    otuById.set(String(props.otu.id), {
      ...props.otu,
      taxon_name: props.otu.taxon_name || (props.otu.taxon_name_id ? props.taxon : null)
    })
  }

  let rows
  try {
    rows = await enrichAssociationFamilies(
      [...basicMap.values()], makeAPIRequest, otuById, taxonomicFamilyCache,
      familyRows, isCurrent
    )
  } catch (error) {
    // Raw data can still use the Basic rows when optional ancestry completion
    // is unavailable; only the Standard summary treats this as a warning at
    // its own transaction boundary.
    reportLoadError(error, { view: 'raw', phase: 'optional classification', route: '/taxon_names' })
    return basicMap
  }
  if (!rows || !isCurrent()) return null

  // Raw data shows the name as recorded, so this does not replace anything --
  // it supplies the accepted name the label cell prints after it, and the OTU
  // that link points at. Costs nothing on a page without synonyms.
  try {
    if (!await resolveAcceptedNames(otuById, [...otuById.keys()], makeAPIRequest, isCurrent)) return null
  } catch (error) {
    // Same boundary as the classification above: a record still reads correctly
    // under the name it was entered with, so Raw data renders without this.
    reportLoadError(error, { view: 'raw', phase: 'optional accepted names', route: '/otus' })
  }
  if (!isCurrent()) return null

  for (const [id, otu] of otuById) expertOtuById.set(id, otu)
  return new Map(rows.map(row => [row.id, row]))
}

// Guards against a slow request finishing after a newer one (e.g. switching
// summary groups faster than the previous group's fetch resolves) and
// overwriting fresher results with stale ones.
let loadRequestId = 0

async function loadBiologicalAssociations(page = 1) {
  const requestId = ++loadRequestId
  isLoading.value = true
  rawLoadState.value = 'loading'
  biologicalAssociations.value = []
  loadError.value = ''

  try {
    // The full endpoint filters by relationship id, while /basic exposes the
    // human-readable names used by the dropdown. Resolve that mapping once per
    // panel instance and let TaxonWorks filter before applying pagination.
    // A drilldown out of Standard already names its records by id, chosen by
    // the evidence rule rather than the dropdown. Applying the relationship
    // filter on top would show fewer records than the count that was clicked.
    const filterRelationships = !selectedGroup.value?.fromStandard
      && relationshipOptions.value.length > 0
      && selectedRelationships.value.length < relationshipOptions.value.length
    let relationshipIds = null
    if (filterRelationships) {
      if (!await ensureRelationshipIds(requestId)) return
      relationshipIds = relationshipIdsForSelection(
        selectedRelationships.value,
        relationshipIdsByName.value
      )
      if (!relationshipIds.length) {
        pagination.value = { page: 1, per: props.per, total: 0 }
        rawLoadState.value = 'ready'
        return
      }
    }

    let scope = scopeQueryString(relationshipIds)
    let visibleTotal = null
    let requestPage = page
    if (hasExcludedAssociations.value) {
      // Remove unnamed OTUs before slicing. Query only this page's IDs so the
      // full endpoint cannot bring excluded rows back or leave holes in pages.
      const groupIds = selectedGroup.value && new Set(selectedGroup.value.ids)
      const candidates = selectedGroup.value?.fromStandard
        ? allAssociationRows.value
        : filterRowsByRelationships(allAssociationRows.value, selectedRelationships.value)
      const eligible = candidates.filter(row => !groupIds || groupIds.has(row.id))
      visibleTotal = eligible.length
      if (!visibleTotal) {
        pagination.value = { page: 1, per: pagination.value.per, total: 0 }
        rawLoadState.value = 'ready'
        return
      }
      page = Math.min(page, Math.ceil(visibleTotal / pagination.value.per))
      const query = new URLSearchParams()
      eligible.slice((page - 1) * pagination.value.per, page * pagination.value.per)
        .forEach(row => query.append('biological_association_id[]', row.id))
      scope = query.toString()
      requestPage = 1
    }
    const params = { per: pagination.value.per, page: requestPage }
    const response = await useOtuPageRequest(
      'panel:biological-associations-v2',
      () => makeAPIRequest.get(`/biological_associations?${scope}`, {
        params: { ...params, extend: fullExtend }
      })
    )
    const validated = validateAssociationPage(response, requestPage, row => row.id)
    const { data } = validated

    if (requestId !== loadRequestId) return
    const associationIds = data.map((d) => d.id)

    const [depictionsMap, distributionsMap, citationsMap, rawBasicMap] = await Promise.all([
      fetchDepictions(associationIds, requestId),
      fetchDistributions(associationIds, requestId),
      fetchCitations(associationIds, requestId),
      fetchBasic(`/biological_associations/basic?${scope}`, params)
    ])

    if (requestId !== loadRequestId) return
    const basicMap = await enrichExpertFamilies(rawBasicMap, requestId)
    if (!basicMap || requestId !== loadRequestId) return

    // Pre-fetch DWC records for CO/FO subjects/objects (grouped by OTU to
    // avoid duplicate fetches). Supplies both the locality shown in the Area
    // column and the name (scientificName, authorship included) used for the
    // label cell. DWC gives the valid name; for a determination under a synonym
    // makeBiologicalAssociation shows the recorded name instead.
    const specimensByOtuId = new Map()
    for (const item of data) {
      const basic = basicMap.get(item.id)
      if (!basic) continue
      for (const [entity, otuId] of [
        [item.subject, basic.subject_otu_id],
        [item.object, basic.object_otu_id]
      ]) {
        const specimen = resolveSpecimenRef(entity)
        if (!specimen || !otuId) continue
        if (!specimensByOtuId.has(otuId)) specimensByOtuId.set(otuId, [])
        specimensByOtuId.get(otuId).push(specimen)
      }
    }
    const localityByCoId = new Map()
    await Promise.all(
      [...specimensByOtuId.entries()].map(async ([otuId, specimens]) => {
        const records = await fetchDwcForOtu(otuId)
        for (const specimen of specimens) {
          // dwc.json also carries AssertedDistribution rows and could hold a
          // CO and FO sharing a numeric id — match on both id and type.
          const record = records.find(
            (r) =>
              r.dwc_occurrence_object_id === specimen.id &&
              r.dwc_occurrence_object_type === specimen.type
          )
          if (!record) continue
          const parts = [record.country, record.stateProvince, record.county].filter(Boolean)
          const lat = record.decimalLatitude  ? Number(record.decimalLatitude)  : null
          const lon = record.decimalLongitude ? Number(record.decimalLongitude) : null
          const scientificName = record.scientificName || null
          if (parts.length || (lat && lon) || record.recordedBy || scientificName || record.family) {
            localityByCoId.set(specimenKey(specimen), {
              text: parts.join(': '),
              lat,
              lon,
              recordedBy: record.recordedBy || null,
              scientificName,
              family: record.family || null
            })
          }
        }
      })
    )

    const associations = data.map((item) =>
      makeBiologicalAssociation(
        item,
        depictionsMap.get(item.id)    || [],
        distributionsMap.get(item.id) || [],
        citationsMap.get(item.id)     || [],
        basicMap.get(item.id)         || null,
        localityByCoId,
        expertOtuById
      )
    )

    if (requestId !== loadRequestId) return // superseded by a newer request

    pagination.value = {
      page: visibleTotal === null ? validated.responsePage || requestPage : page,
      per: validated.responsePer || pagination.value.per,
      total: visibleTotal ?? validated.total ?? data.length
    }
    biologicalAssociations.value = associations
    rawLoadState.value = 'ready'

  } catch (e) {
    if (requestId === loadRequestId) {
      biologicalAssociations.value = []
      pagination.value = { ...pagination.value, total: 0 }
      loadError.value = 'The association records could not be loaded.'
      rawLoadState.value = 'error'
      reportLoadError(e, { view: 'raw', phase: 'association records', route: '/biological_associations' })
    }
  } finally {
    if (requestId === loadRequestId) {
      isLoading.value = false
      if (rawLoadState.value === 'loading') rawLoadState.value = 'error'
    }
  }
}
</script>

<style scoped>
/* TaxonPages sets its table text one step below the panels beside this one:
   `VTableBody` puts `text-xs` on the `tbody` it owns, while Descendants and
   synonyms, Nomenclature and Type all render their content at `text-sm`.
   Reading three panels in a row should not mean changing text size, so the
   rows of all three views follow their neighbours -- from the same Tailwind
   scale, and on the cells, which is where the size has to be set to beat the
   one the package put on the `tbody`.

   Column headings are deliberately left out: `VTableHeader` keeps them at
   `text-xs`, which is what the Stats panel's headings read at, and a heading
   set apart by size and letterspacing does not need to match its rows. */
:deep(table td) {
  font-size: var(--text-sm);
  line-height: var(--text-sm--line-height);
}

/* VPagination marks the current page with `bg-primary`. In the dark theme
   `--tp-primary` is rgb(23,23,23) on a rgb(38,38,38) card -- a contrast of
   1.2:1, so the selected page reads as unselected. `--color-secondary` is the
   accent both themes define for exactly this and stays legible in either. */
:deep(.tp-pagination button[aria-current='page']) {
  background-color: var(--color-secondary);
  color: var(--color-secondary-content);
  font-weight: 600;
}
:deep(.tp-pagination button) {
  border-color: color-mix(in oklab, var(--color-base-content) 20%, transparent);
}
</style>
