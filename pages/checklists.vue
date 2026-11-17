<template>
  <main class="min-h-screen bg-base-background text-base-content">
    <header class="border-b border-base-border/40 bg-base-foreground">
      <div class="container mx-auto box-border flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
        <h1 class="text-2xl font-bold">
          Country checklists
        </h1>
        <p class="text-sm text-base-content/70">
          Weevil species reported in each country. Counts are distinct species in the occurrence records.
          <template v-if="checklistUpdated">Checklists are compiled from cached data, last updated {{ checklistUpdated }}.</template>
        </p>
      </div>
    </header>

    <div class="container mx-auto box-border min-w-0 px-4 pt-4">
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-[14rem] flex-1 sm:max-w-sm">
          <label class="block text-sm font-semibold" for="distribution-country">
            Country or area
          </label>
          <select
            id="distribution-country"
            class="mt-1 box-border block w-full min-w-0 max-w-full rounded-md border border-base-border bg-base-foreground px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :value="selectedCountryOption"
            @change="selectCountry($event.target.value)"
          >
            <option value="">Select a country</option>
            <option
              v-for="country in countries"
              :key="country.key"
              :value="country.name"
            >
              {{ countryDisplayName(country.name) }} ({{ country.count }})
            </option>
          </select>
        </div>

        <p
          class="box-border flex items-center gap-2 rounded-md border border-warning bg-base-foreground px-3 py-2 text-sm text-base-content"
          role="note"
        >
          <svg
            class="h-5 w-5 shrink-0 text-warning"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          Distribution data is generally incomplete
        </p>

        <div v-if="subdivisionOptions.length" class="min-w-[14rem] flex-1 sm:max-w-sm">
          <label class="block text-sm font-semibold" for="distribution-region">
            {{ regionLabel }}
          </label>
          <select
            id="distribution-region"
            class="mt-1 box-border block w-full min-w-0 max-w-full rounded-md border border-base-border bg-base-foreground px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :value="selectedSubdivision"
            @change="selectRegion($event.target.value)"
          >
            <option value="">
              {{ isAssociatedAreaSelection ? `Choose a ${regionLabel.toLocaleLowerCase()}` : `All of ${countryDisplayName(selectedCountry)}` }}
            </option>
            <option
              v-for="region in subdivisionOptions"
              :key="region.key"
              :value="region.name"
            >
              {{ countryDisplayName(region.name) }}<template v-if="region.count !== null"> ({{ region.count }})</template>
            </option>
          </select>
        </div>

        <div v-if="associatedAreaOptions.length" class="min-w-[14rem] flex-1 sm:max-w-sm">
          <label class="block text-sm font-semibold" for="distribution-associated-area">
            Territory or associated area
          </label>
          <select
            id="distribution-associated-area"
            class="mt-1 box-border block w-full min-w-0 max-w-full rounded-md border border-base-border bg-base-foreground px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :value="selectedAssociatedArea"
            @change="selectRegion($event.target.value)"
          >
            <option value="">
              {{ selectedRegion && !isAssociatedAreaSelection ? 'Choose a territory or associated area' : 'No territory or associated area selected' }}
            </option>
            <option
              v-for="area in associatedAreaOptions"
              :key="area.key"
              :value="area.name"
            >
              {{ countryDisplayName(area.name) }} ({{ area.count }})
            </option>
          </select>
        </div>

        <p
          v-if="countsLoading"
          class="pb-2 text-xs text-base-content/60"
          role="status"
        >
          Loading country species counts…
        </p>
        <p
          v-else-if="countsError"
          class="pb-2 text-sm text-danger"
          role="alert"
        >
          {{ countsError }}
          <button
            class="ml-1 font-semibold underline"
            type="button"
            @click="loadCountryCounts"
          >Retry</button>
        </p>
      </div>
    </div>

    <section class="container mx-auto box-border grid min-w-0 gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(21rem,0.85fr)]">
      <section aria-label="Weevil species world map" class="min-w-0">
        <div class="relative overflow-hidden rounded-lg bg-base-foreground ring-1 ring-base-border/50">
          <ClientOnly>
            <ChecklistMap
              ref="countryMapRef"
              v-if="countryGeoJson"
              class="country-checklist-map h-[26rem] max-h-[26rem] sm:h-[30rem] sm:max-h-[30rem] xl:h-[max(24rem,calc(100vh-17rem))] xl:max-h-none"
              dragging
              :zoom="2"
              :center="[15, 0]"
              :geojson="countryGeoJson"
              :geojson-options="geojsonOptions"
              @geojson:ready="onCountryMapReady"
            />
            <VSpinner
              v-if="countsLoading"
              class="absolute left-1/2 top-4 z-[500] -translate-x-1/2"
            />
          </ClientOnly>
          <p
            v-if="mapError"
            class="px-4 py-3 text-sm text-danger"
            role="alert"
          >
            {{ mapError }}
          </p>
        </div>

        <div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Map view">
          <button
            class="rounded-md border border-base-border bg-base-foreground px-3 py-2 text-sm font-medium hover:bg-base-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            :disabled="!mapReady"
            @click="showWorldView"
          >World view</button>
          <button
            class="rounded-md border border-base-border bg-base-foreground px-3 py-2 text-sm font-medium hover:bg-base-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            :disabled="!mapReady || !selectedCountry"
            :title="selectedCountry ? `Return to ${selectionLabel}` : 'Select a country or area first'"
            @click="syncMapSelection"
          >Return to selection</button>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-base-content/70">
          <span class="font-semibold">Reported species</span>
          <span
            v-for="step in legend"
            :key="step.label"
            class="inline-flex items-center gap-1.5"
          >
            <span
              class="h-3 w-3 rounded-sm ring-1 ring-black/10"
              :style="{ backgroundColor: `var(${step.token})`, opacity: 'var(--tp-map-shape-opacity, 0.5)' }"
            />
            {{ step.label }}
          </span>
          <span class="text-base-content/55">Click a country to view its checklist. For the United States, Canada, Australia, China, Russia and the United Kingdom, click a state, province or constituent country to narrow it.</span>
        </div>
        <p class="mt-3 text-xs text-base-soft">
          This feature was adapted from the country checklists of
          <a
            href="https://jrpletch.github.io/fleasoftheworld/"
            target="_blank"
            rel="noopener"
            class="text-secondary hover:underline"
          >Fleas of the World Online</a>.
        </p>
      </section>

      <aside class="min-w-0">
        <div
          v-if="selectedCountry"
          class="border-t border-base-border/50 pt-3 xl:border-t-0 xl:pt-0"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex min-w-0 items-baseline gap-3">
              <h2 class="flex items-center gap-2 text-xl font-semibold">
                <img
                  v-if="countryCode(mapSelectionName)"
                  class="h-4 w-6 shrink-0 rounded-sm object-cover"
                  :src="`https://flagcdn.com/w40/${countryCode(mapSelectionName)}.png`"
                  alt=""
                  aria-hidden="true"
                />
                <span>{{ pageTitle }}</span>
              </h2>
              <span class="shrink-0 text-sm tabular-nums text-base-content/65">
                {{ displayedSpeciesCount }} species
              </span>
            </div>
            <button
              v-if="selectedRegion"
              class="text-xs font-medium text-primary-color hover:underline dark:text-secondary-color"
              type="button"
              @click="selectRegion('')"
            >{{ isAssociatedAreaSelection ? `← ${countryDisplayName(selectedCountry)}` : `← All of ${countryDisplayName(selectedCountry)}` }}</button>
            <div
              v-if="!countryLoading && !countryError && species.length"
              class="flex flex-wrap items-center gap-2"
            >
              <span class="text-xs text-base-content/55">Download</span>
              <button
                class="rounded-md border border-base-border px-2.5 py-1.5 text-xs font-medium hover:bg-base-muted/40"
                type="button"
                title="Export the full country checklist as CSV, including taxa, evidence, and citations."
                @click="downloadCountryCSV"
              >CSV</button>
              <button
                class="rounded-md border border-base-border px-2.5 py-1.5 text-xs font-medium hover:bg-base-muted/40"
                type="button"
                title="Export the full country checklist as plain text."
                @click="downloadCountryText"
              >Plain text</button>
              <button
                class="rounded-md border border-base-border px-2.5 py-1.5 text-xs font-medium hover:bg-base-muted/40"
                type="button"
                title="Export a formatted country checklist for Word and other word processors."
                @click="downloadCountryRtf"
              >RTF</button>
            </div>
          </div>

          <div
            class="mt-4 flex border-b border-base-border/60"
            role="tablist"
            aria-label="Country checklist views"
          >
            <button
              id="country-tab-species"
              class="border-b-2 px-3 py-2 text-sm font-medium"
              :class="activeCountryTab === 'species' ? 'border-primary-color text-base-content dark:border-secondary-color' : 'border-transparent text-base-content/60 hover:text-base-content'"
              type="button"
              role="tab"
              :aria-selected="activeCountryTab === 'species'"
              aria-controls="country-panel-species"
              @click="activeCountryTab = 'species'"
            >Species checklist</button>
            <button
              id="country-tab-references"
              class="border-b-2 px-3 py-2 text-sm font-medium"
              :class="activeCountryTab === 'references' ? 'border-primary-color text-base-content dark:border-secondary-color' : 'border-transparent text-base-content/60 hover:text-base-content'"
              type="button"
              role="tab"
              :aria-selected="activeCountryTab === 'references'"
              aria-controls="country-panel-references"
              @click="activeCountryTab = 'references'"
            >References</button>
          </div>

          <p
            v-if="countryLoading"
            class="mt-4 text-sm text-base-content/65"
            role="status"
          >
            Loading checklist and references…
          </p>
          <p
            v-else-if="countryError"
            class="mt-3 text-sm text-danger"
            role="alert"
          >
            {{ countryError }}
          </p>
              <section
                v-else-if="activeCountryTab === 'species'"
                id="country-panel-species"
                class="pt-3"
                role="tabpanel"
                aria-labelledby="country-tab-species"
              >
                <template v-if="species.length">
                  <label class="block text-sm font-medium" for="species-filter">
                    Species and subspecies checklist
                  </label>
                  <input
                    id="species-filter"
                    v-model="speciesFilter"
                    class="mt-1.5 box-border block w-full min-w-0 max-w-full rounded-md border border-base-border bg-base-foreground px-3 py-2 text-sm placeholder:text-base-content/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    type="search"
                    placeholder="Filter by species name"
                  />
                  <p class="mt-2 text-xs text-base-content/55">
                    {{ filteredSpecies.length }} of {{ species.length }} listed taxa
                  </p>
                  <ul class="mt-2 max-h-[28rem] divide-y divide-base-border/50 overflow-y-auto border-y border-base-border/50 xl:max-h-[calc(100vh-27rem)] xl:min-h-[12rem]">
                    <template
                      v-for="group in filteredSpeciesGroups"
                      :key="group.family"
                    >
                    <li class="sticky top-0 z-10 bg-base-muted px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-base-content/75">
                      {{ group.family }}
                      <span class="ml-1 font-normal normal-case text-base-content/55">({{ group.taxa.length }})</span>
                    </li>
                    <li
                      v-for="taxon in group.taxa"
                      :key="taxon.key"
                      class="py-2.5 pr-2 text-sm"
                    >
                      <RouterLink
                        v-if="taxon.otuId"
                        :to="{ name: 'otus-id-overview', params: { id: taxon.otuId } }"
                        class="font-medium italic text-primary-color hover:underline dark:text-secondary-color"
                      >{{ taxon.name }}</RouterLink>
                      <span v-else class="font-medium italic">{{ taxon.name }}</span>
                      <span v-if="taxon.authorship" class="ml-1 text-base-content/75">{{ taxon.authorship }}</span>
                      <button
                        :id="`record-count-${taxon.key}`"
                        class="ml-1 text-xs text-primary-color hover:underline dark:text-secondary-color"
                        type="button"
                        :aria-expanded="expandedTaxonKey === taxon.key"
                        :aria-controls="`record-sources-${taxon.key}`"
                        @click="expandedTaxonKey = expandedTaxonKey === taxon.key ? '' : taxon.key"
                      >{{ recordEvidenceByTaxon.get(taxon.key)?.total ?? 0 }} {{ recordEvidenceByTaxon.get(taxon.key)?.total === 1 ? 'record' : 'records' }}</button>
                      <div
                        v-if="expandedTaxonKey === taxon.key"
                        :id="`record-sources-${taxon.key}`"
                        class="mt-2 border-l-2 border-primary-color/50 pl-3 text-xs text-base-content/75 dark:border-secondary-color/50"
                      >
                        <p
                          v-if="recordEvidenceByTaxon.get(taxon.key)"
                          class="mb-1 font-medium"
                        >
                          <span v-if="recordEvidenceByTaxon.get(taxon.key).citations">
                            {{ recordEvidenceByTaxon.get(taxon.key).citations }} {{ recordEvidenceByTaxon.get(taxon.key).citations === 1 ? 'citation' : 'citations' }}
                          </span>
                          <span
                            v-if="recordEvidenceByTaxon.get(taxon.key).citations && recordEvidenceByTaxon.get(taxon.key).specimens"
                            aria-hidden="true"
                          > · </span>
                          <span v-if="recordEvidenceByTaxon.get(taxon.key).specimens">
                            {{ recordEvidenceByTaxon.get(taxon.key).specimens }} {{ recordEvidenceByTaxon.get(taxon.key).specimens === 1 ? 'specimen' : 'specimens' }}
                          </span>
                        </p>
                        <ul
                          v-if="sourcesByTaxon.get(taxon.key)?.length"
                          class="space-y-1.5"
                        >
                          <li
                            v-for="source in sourcesByTaxon.get(taxon.key)"
                            :key="source.key"
                          >
                            <template v-if="source.type === 'reference'">
                              <template v-if="source.place">
                                <span class="font-medium">{{ source.place }}</span>
                                <span aria-hidden="true"> · </span>
                              </template>
                              <template v-if="source.citations.length">
                                <template
                                  v-for="(citation, index) in source.citations"
                                  :key="citation.key"
                                >
                                  <button
                                    class="text-primary-color hover:underline dark:text-secondary-color"
                                    type="button"
                                    :aria-label="`${source.place ? `${source.place}: ` : ''}${citation.short}; show full citation`"
                                    @click="openCitation(citation, source.place)"
                                  >{{ citation.short }}</button>
                                  <span v-if="index < source.citations.length - 1" aria-hidden="true">; </span>
                                </template>
                              </template>
                              <span v-else class="text-base-content/55">No citation recorded</span>
                            </template>
                            <template v-else>
                              <span class="font-medium">Specimen:</span>
                              {{ source.label }}
                            </template>
                          </li>
                        </ul>
                        <p v-else>No citation or specimen details are available for these records.</p>
                      </div>
                    </li>
                    </template>
                  </ul>
                </template>
                <p v-else class="text-sm text-base-content/65">
                  No weevil species occurrence records are currently indexed for {{ selectionLabel }}.
                </p>
              </section>

              <section
                v-else
                id="country-panel-references"
                class="pt-3"
                role="tabpanel"
                aria-labelledby="country-tab-references"
              >
                <p
                  v-if="topReferences.length"
                  class="text-xs text-base-content/55"
                >
                  Top cited references, ranked by distinct taxa.
                </p>
                <ol v-if="topReferences.length" class="mt-2 max-h-[28rem] space-y-3 overflow-y-auto pr-2 xl:max-h-[calc(100vh-27rem)] xl:min-h-[12rem]">
                  <li
                    v-for="reference in topReferences"
                    :key="reference.full"
                    class="border-l-2 border-primary-color/60 pl-3 text-sm dark:border-secondary-color/60"
                  >
                    <p class="leading-relaxed">{{ reference.full }}</p>
                    <button
                      :id="`${reference.key}-count`"
                      class="mt-1 text-xs text-primary-color hover:underline dark:text-secondary-color"
                      type="button"
                      :aria-expanded="expandedReferenceKey === reference.key"
                      :aria-controls="`${reference.key}-taxa`"
                      @click="expandedReferenceKey = expandedReferenceKey === reference.key ? '' : reference.key"
                    >{{ reference.taxa.length }} taxa</button>
                    <ul
                      v-if="expandedReferenceKey === reference.key"
                      :id="`${reference.key}-taxa`"
                      class="mt-2 space-y-1 border-l-2 border-base-border/70 pl-3"
                    >
                      <li
                        v-for="taxon in reference.taxa"
                        :key="taxon.key"
                        class="text-sm"
                      >
                        <RouterLink
                          v-if="taxon.otuId"
                          :to="{ name: 'otus-id-overview', params: { id: taxon.otuId } }"
                          class="italic text-primary-color hover:underline dark:text-secondary-color"
                        >{{ taxon.name }}</RouterLink>
                        <span v-else class="italic">{{ taxon.name }}</span>
                        <span v-if="taxon.authorship" class="ml-1 text-base-content/65">{{ taxon.authorship }}</span>
                        <span class="ml-2 text-xs text-base-content/55">{{ taxon.evidenceLabel }}</span>
                      </li>
                    </ul>
                  </li>
                </ol>
                <p v-else class="text-sm text-base-content/65">
                  No cited references are currently indexed for {{ selectionLabel }}.
                </p>
              </section>
        </div>
        <p
          v-else
          class="mt-5 border-t border-base-border/50 pt-4 text-sm text-base-content/65"
        >
          Select a country on the map or from the list to see its checklist and references.
        </p>
      </aside>
    </section>
    <Teleport to="body">
      <VModal
        v-if="activeCitation"
        @close="activeCitation = null"
      >
        <template #header>
          <span class="italic">{{ activeCitation.short }}</span>
          <span v-if="activeCitation.place" class="ml-2 text-sm font-normal text-base-content/60">{{ activeCitation.place }}</span>
        </template>
        <div class="px-4 pb-4 text-sm leading-relaxed">
          <p
            v-for="fullReference in activeCitation.fullReferences"
            :key="fullReference"
            class="mb-3 last:mb-0"
          >{{ fullReference }}</p>
        </div>
      </VModal>
    </Teleport>
  </main>
</template>

<script setup>
// Ported from Fleas of the World (https://github.com/jrpletch/fleasoftheworld,
// pages/checklists.vue at 2afe35c), used with permission. Changes: weevil
// wording, project-name exports, legend bins for larger counts, map colours
// as --pp-checklist-* tokens in the aggregate-map green (pages/data/checklist-tokens.css).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildSubdivisionIndex, resolveSubdivision } from './data/subdivisions.js'
import { prepareCountryMapData, prepareSubdivisionMapData, wrappedCountryBounds } from './data/mapWrapping.js'
import ChecklistMap from './components/ChecklistMap.vue'
import './data/checklist-tokens.css'

const {
  base_url = '/',
  project_name: projectName = 'Curculionidae of the World Online',
  project_authors: projectAuthors = ''
} = __APP_ENV__

const exportPrefix = projectName.replace(/[^A-Za-z0-9]+/g, '')

// Map colours are --pp-checklist-* tokens (pages/data/checklist-tokens.css).
// Leaflet needs literal colour strings, so resolve them when styling.
function cssVar(name) {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Same see-through fill as the taxon pages' map (--tp-map-shape-opacity), so
// the tiles show through the countries the way they do there.
function shapeOpacity() {
  const value = Number.parseFloat(cssVar('--tp-map-shape-opacity'))
  return Number.isFinite(value) ? value : 0.5
}

const legend = [
  { label: '0', max: 0, token: '--pp-checklist-0' },
  { label: '1–19', max: 19, token: '--pp-checklist-1' },
  { label: '20–99', max: 99, token: '--pp-checklist-2' },
  { label: '100–499', max: 499, token: '--pp-checklist-3' },
  { label: '500+', max: Infinity, token: '--pp-checklist-4' }
]

const countryGeoJson = ref(null)
const countryMapRef = ref(null)
const mapReady = ref(false)
const mapLayers = new Map()
const countriesByKey = ref(new Map())
const checklistIdByKey = ref(new Map())
const checklistUpdated = ref('')
const checklistCountries = ref([])
// Resolves once index.json is in, so a country opened from the URL on load
// can look up its file.
let resolveIndexReady
const indexReady = new Promise((resolve) => { resolveIndexReady = resolve })
const countryCounts = ref(new Map())
const countsLoading = ref(true)
const countsError = ref('')
const mapError = ref('')
const selectedCountry = ref('')
const selectedRegion = ref('')
const subdivisionGeoJson = ref(null)
let subdivisionLayer = null
let subdivisionLayerCountryKey = ''
const subdivisionsShown = ref(false)
let subdivisionLayerRequestId = 0
let mapSelectionRequestId = 0
let loadedCountry = null
const REGION_LABELS = {
  'united states': 'State',
  canada: 'Province or territory',
  australia: 'State or territory',
  china: 'Province or region',
  russia: 'Administrative area',
  'united kingdom': 'Constituent country'
}
const countryLoading = ref(false)
const countryError = ref('')
const countryRows = ref([])
const citationsByOccurrence = ref(new Map())
const distributionPlacesByOccurrence = ref(new Map())
const speciesFilter = ref('')
const expandedTaxonKey = ref('')
const activeCountryTab = ref('species')
const expandedReferenceKey = ref('')
const activeCitation = ref(null)
const checklistCitationUrl = ref('')
const citationAccessDate = ref('')
let countryRequestId = 0
let pendingCountryScrollY = null

const countryAliases = {
  serbia: 'republic of serbia',
  'faeroe is.': 'faroe islands',
  macedonia: 'north macedonia',
  'french southern territories': 'french southern and antarctic lands',
  'réunion': 'reunion',
  'saint barthélemy': 'saint barthelemy',
  'åland islands': 'aland',
  'timor-leste': 'east timor',
  'vatican city': 'vatican',
  curacao: 'curaçao',
  'hong kong sar': 'hong kong s.a.r.',
  'macao sar': 'macao s.a.r',
  'macao s.a.r.': 'macao s.a.r',
  swaziland: 'eswatini',
  korea: 'south korea',
  'dem. rep. korea': 'north korea',
  'w. sahara': 'western sahara',
  'bosnia and herz.': 'bosnia and herzegovina',
  'côte d\'ivoire': 'ivory coast',
  'eq. guinea': 'equatorial guinea',
  'hong kong': 'hong kong s.a.r.',
  'christmas island': 'indian ocean territories',
  'svalbard and jan mayen': 'svalbard and jan mayen',
  'south georgia and the south sandwich islands': 'south georgia and the islands',
  'cape verde': 'cabo verde',
  'united states of america': 'united states',
  usa: 'united states',
  'russian federation': 'russia',
  'czech republic': 'czechia',
  'korea, republic of': 'south korea',
  'republic of korea': 'south korea',
  'democratic people\'s republic of korea': 'north korea',
  'viet nam': 'vietnam',
  'iran, islamic republic of': 'iran',
  'tanzania, united republic of': 'tanzania',
  'united republic of tanzania': 'tanzania',
  'venezuela, bolivarian republic of': 'venezuela',
  'bolivia, plurinational state of': 'bolivia',
  'moldova, republic of': 'moldova',
  'lao people\'s democratic republic': 'laos',
  'syrian arab republic': 'syria',
  'taiwan, province of china': 'taiwan'
}

function countryKey(name) {
  const normalized = String(name || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  return countryAliases[normalized] || normalized
}

const COUNTRY_DISPLAY_NAMES = {
  'united states': 'United States',
  tanzania: 'Tanzania',
  'republic of serbia': 'Serbia',
  reunion: 'Réunion',
  'saint barthelemy': 'Saint Barthélemy',
  aland: 'Åland Islands',
  'south georgia and the islands': 'South Georgia and the South Sandwich Islands',
  'hong kong s.a.r.': 'Hong Kong',
  'macao s.a.r': 'Macao',
  vatican: 'Vatican City',
  'east timor': 'Timor-Leste',
  eswatini: 'Eswatini'
}

function countryDisplayName(name) {
  return COUNTRY_DISPLAY_NAMES[countryKey(name)] || name
}

const ASSOCIATED_AREAS_BY_SOVEREIGN = {
  'united states': {
    country: 'United States of America',
    areas: [
      'American Samoa', 'Guam', 'Northern Mariana Islands', 'Puerto Rico',
      'United States Minor Outlying Islands', 'United States Virgin Islands'
    ]
  },
  'united kingdom': {
    country: 'United Kingdom',
    areas: [
      'Anguilla', 'Bermuda', 'British Indian Ocean Territory', 'British Virgin Islands',
      'Cayman Islands', 'Falkland Islands', 'Gibraltar', 'Guernsey', 'Isle of Man',
      'Jersey', 'Montserrat', 'Pitcairn Islands', 'Saint Helena',
      'South Georgia and the Islands', 'Turks and Caicos Islands'
    ]
  },
  france: {
    country: 'France',
    areas: [
      'Clipperton Island', 'French Guiana', 'French Polynesia', 'French Southern and Antarctic Lands',
      'Guadeloupe', 'Martinique', 'Mayotte', 'New Caledonia', 'Reunion',
      'Saint Barthelemy', 'Saint Martin', 'Saint Pierre and Miquelon', 'Wallis and Futuna'
    ]
  },
  netherlands: {
    country: 'Netherlands',
    areas: ['Aruba', 'Bonaire', 'Curaçao', 'Saba', 'Sint Eustatius', 'Sint Maarten']
  },
  denmark: {
    country: 'Denmark',
    areas: ['Faroe Islands', 'Greenland']
  },
  australia: {
    country: 'Australia',
    areas: [
      'Ashmore and Cartier Islands', 'Coral Sea Islands', 'Heard Island and McDonald Islands',
      'Indian Ocean Territories', 'Norfolk Island'
    ]
  },
  'new zealand': {
    country: 'New Zealand',
    areas: ['Cook Islands', 'Niue']
  },
  china: {
    country: 'China',
    areas: ['Hong Kong S.A.R.', 'Macao S.A.R']
  },
  norway: {
    country: 'Norway',
    areas: ['Bouvet Island', 'Svalbard and Jan Mayen']
  },
  finland: {
    country: 'Finland',
    areas: ['Aland']
  }
}

// Disputed or uninhabited features shown for context only.
const NON_SELECTABLE_AREAS = new Set([
  'siachen glacier', 'bir tawil', 'spratly islands', 'scarborough reef', 'bajo nuevo bank (petrel is.)',
  'serranilla bank', 'brazilian island', 'southern patagonian ice field'
])

const ASSOCIATED_AREA_PARENT_BY_KEY = new Map(
  Object.entries(ASSOCIATED_AREAS_BY_SOVEREIGN).flatMap(([sovereignKey, group]) => (
    group.areas.map((area) => [countryKey(area), sovereignKey])
  ))
)

function countryCode(name) {
  const feature = countryGeoJson.value?.features.find(
    (item) => countryKey(item.properties?.name) === countryKey(name)
  )
  const code = feature?.properties?.['ISO3166-1-Alpha-2']
  return /^[a-z]{2}$/i.test(code || '') ? code.toLowerCase() : ''
}

// Host plants recorded as field occurrences (nomenclaturalCode "icn") are not
// weevils and stay off the checklist.
function isSpeciesRecord(record) {
  return /species/i.test(String(record.taxonRank || ''))
    && Boolean(record.scientificName)
    && String(record.nomenclaturalCode || '').toLowerCase() !== 'icn'
}

function speciesKey(record) {
  if (record.otu_id != null && record.otu_id !== '') return String(record.otu_id)
  return `${String(record.scientificName || '').trim()} ${String(record.scientificNameAuthorship || '').trim()}`.trim().toLocaleLowerCase()
}

// Country outlines are the TaxonWorks areas themselves, from the species map's
// shape cache (public/map-shapes/, one file per area). index.json names the
// cached area of each country; a country no record uses directly (Spain: only
// its provinces) is not in that cache and comes from fallback-shapes.geojson.
async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

// Drops the parts of a country's outline that lie in one of its `exclude`
// boxes (overseas parts with a checklist of their own, e.g. French Guiana).
function withoutExcludedParts(geometry, boxes) {
  if (!boxes?.length || geometry?.type !== 'MultiPolygon') return geometry
  const inBox = (polygon) => {
    const ring = polygon[0]
    const lngs = ring.map(([lng]) => lng)
    const lats = ring.map(([, lat]) => lat)
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2
    return boxes.some(([west, south, east, north]) => lng >= west && lng <= east && lat >= south && lat <= north)
  }
  return { ...geometry, coordinates: geometry.coordinates.filter((polygon) => !inBox(polygon)) }
}

async function loadCountryShapes() {
  try {
    await indexReady
    const features = []
    const queue = [...checklistCountries.value]
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (queue.length) {
        const country = queue.shift()
        if (!country.shape) continue
        try {
          const geometry = await fetchJson(`${base_url}map-shapes/${country.shape}.json`)
          if (geometry) {
            features.push({
              type: 'Feature',
              properties: { name: country.name, 'ISO3166-1-Alpha-2': country.iso2 },
              geometry: withoutExcludedParts(geometry, country.exclude)
            })
          }
        } catch {
          // One missing outline leaves that country off the map, not the map.
        }
      }
    }))
    const fallback = await fetchJson(`${base_url}checklists/fallback-shapes.geojson`)
    const isoByName = new Map(checklistCountries.value.map((country) => [country.name, country.iso2]))
    for (const feature of fallback.features) {
      if (!isoByName.has(feature.properties.name)) continue
      features.push({ ...feature, properties: { name: feature.properties.name, 'ISO3166-1-Alpha-2': isoByName.get(feature.properties.name) } })
    }
    if (!features.length) throw new Error('No country outlines.')
    countryGeoJson.value = prepareCountryMapData({ type: 'FeatureCollection', features })
  } catch {
    mapError.value = 'The world map could not be loaded. Use the country list to browse records.'
  }
}

// The checklist data is built ahead of time by scripts/build-checklists.mjs
// (public/checklists/): index.json lists every country with its taxon count,
// countries/<id>.json holds one country's records.
async function loadCountryCounts() {
  countsLoading.value = true
  countsError.value = ''
  try {
    const response = await fetch(`${base_url}checklists/index.json`)
    if (!response.ok) throw new Error('Could not load the checklist index.')
    const index = await response.json()
    checklistUpdated.value = index.updated || ''
    checklistCountries.value = index.countries
    countriesByKey.value = new Map(index.countries.map((country) => [countryKey(country.name), [country.name]]))
    checklistIdByKey.value = new Map(index.countries.map((country) => [countryKey(country.name), country.id]))
    countryCounts.value = new Map(index.countries.map((country) => [countryKey(country.name), country.taxa]))
    refreshMapStyles()
  } catch {
    countsError.value = 'Could not load the checklists. Please try again.'
  } finally {
    countsLoading.value = false
    resolveIndexReady()
  }
}

const countries = computed(() => {
  const options = new Map()
  for (const feature of countryGeoJson.value?.features || []) {
    const name = feature.properties?.name
    if (!name) continue
    const key = countryKey(name)
    const count = countryCounts.value.get(key) || 0
    if (!count && key !== countryKey(selectedCountry.value)) continue
    options.set(key, { key, name, count })
  }
  for (const [key, aliases] of countriesByKey.value) {
    if (!options.has(key)) {
      const name = [...aliases].sort((a, b) => a.localeCompare(b))[0]
      options.set(key, { key, name, count: countryCounts.value.get(key) || 0 })
    }
  }
  if (selectedCountry.value && !options.has(countryKey(selectedCountry.value))) {
    options.set(countryKey(selectedCountry.value), {
      key: countryKey(selectedCountry.value),
      name: selectedCountry.value,
      count: selectedCountryCount.value
    })
  }
  return [...options.values()].sort((a, b) => (
    countryDisplayName(a.name).localeCompare(countryDisplayName(b.name))
  ))
})

const selectedCountryOption = computed(() => (
  countries.value.find((country) => country.key === countryKey(selectedCountry.value))?.name || ''
))

const associatedAreaParent = computed(() => selectedCountry.value)

const associatedAreaOptions = computed(() => {
  const parentKey = countryKey(associatedAreaParent.value)
  const group = ASSOCIATED_AREAS_BY_SOVEREIGN[parentKey]
  if (!group) return []
  return group.areas
    .map((name) => {
      const feature = countryGeoJson.value?.features.find(
        (item) => countryKey(item.properties?.name) === countryKey(name)
      )
      if (!feature?.properties?.name) return null
      const areaName = feature.properties.name
      const key = countryKey(areaName)
      return { key, name: areaName, count: countryCounts.value.get(key) || 0 }
    })
    .filter(Boolean)
    .sort((a, b) => countryDisplayName(a.name).localeCompare(countryDisplayName(b.name)))
})

const isAssociatedAreaSelection = computed(() => (
  ASSOCIATED_AREA_PARENT_BY_KEY.get(countryKey(selectedRegion.value)) === countryKey(selectedCountry.value)
))

const selectedAssociatedArea = computed(() => (
  isAssociatedAreaSelection.value
    ? associatedAreaOptions.value.find((area) => area.key === countryKey(selectedRegion.value))?.name || ''
    : ''
))

const mapSelectionName = computed(() => (
  isAssociatedAreaSelection.value ? selectedRegion.value : selectedCountry.value
))

const selectedCountryCount = computed(() => countryCounts.value.get(countryKey(selectedCountry.value)) || 0)

function colorForCount(count) {
  return cssVar((legend.find((step) => count <= step.max) || legend[legend.length - 1]).token)
}

function countryStyle(feature) {
  const name = feature.properties?.name || ''
  if (NON_SELECTABLE_AREAS.has(countryKey(name))) {
    return { fill: true, fillColor: cssVar('--tp-base-muted'), fillOpacity: 0.35, color: cssVar('--tp-base-foreground'), weight: 0.6, opacity: 1, interactive: false }
  }
  const count = countryCounts.value.get(countryKey(name)) || 0
  const selected = countryKey(name) === countryKey(mapSelectionName.value)
  if (selected && subdivisionsShown.value) {
    if (selectedRegion.value && !isAssociatedAreaSelection.value) return { weight: 0, opacity: 0, fill: false }
    return { color: cssVar('--tp-base-content'), weight: 3.5, opacity: 1, fill: false }
  }
  return {
    fill: true,
    opacity: 1,
    color: selected ? cssVar('--tp-base-content') : cssVar('--tp-base-foreground'),
    weight: selected ? 3.5 : 0.6,
    fillColor: colorForCount(count),
    fillOpacity: count ? shapeOpacity() : 0.12
  }
}

function refreshMapStyles() {
  const selectedKey = countryKey(selectedCountry.value)
  for (const [name, layer] of mapLayers) {
    layer.setStyle(countryStyle({ properties: { name } }))
    const element = layer.getElement?.()
    if (element) {
      // Only the selected country's outline ignores clicks, and only while its subdivisions are shown.
      element.style.pointerEvents = subdivisionsShown.value
        && !isAssociatedAreaSelection.value
        && countryKey(name) === selectedKey ? 'none' : ''
    }
  }
}

// Bounds of the main landmasses only, so far-flung islands and antimeridian
// crossings (Alaska's Aleutians, Chukotka, Chatham Islands) don't zoom out to the whole world.
function mainlandBounds(geometry) {
  if (!geometry) return null
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  const boxes = polygons.map((polygon) => {
    let south = 90, north = -90, west = 180, east = -180
    for (const [lng, lat] of polygon[0]) {
      south = Math.min(south, lat)
      north = Math.max(north, lat)
      west = Math.min(west, lng)
      east = Math.max(east, lng)
    }
    return { south, north, west, east, area: (north - south) * (east - west) }
  })
  if (!boxes.length) return null
  const largest = Math.max(...boxes.map((box) => box.area))
  const main = boxes.filter((box) => box.area >= largest * 0.05)
  const south = Math.min(...main.map((box) => box.south))
  const north = Math.max(...main.map((box) => box.north))
  const west = Math.min(...main.map((box) => box.west))
  const east = Math.max(...main.map((box) => box.east))
  return [[south, west], [north, east]]
}

// Canada's mainland extent would otherwise include the Arctic archipelago.
const COUNTRY_VIEW_OVERRIDES = {
  canada: [[41.5, -141.5], [70, -52]],
  // Trims the Arctic islands and far-eastern Chukotka so the mainland fills the map.
  russia: [[43, 28], [76, 170]]
}

function focusMapBounds(map, bounds, maxZoom) {
  const options = { padding: [24, 24], maxZoom }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    map.fitBounds(bounds, { ...options, animate: false })
    return
  }
  map.flyToBounds(bounds, { ...options, duration: 0.55 })
}

function focusMapOnCountry() {
  const map = countryMapRef.value?.getMapObject()
  if (!map) return
  if (!selectedCountry.value) {
    const zoom = countryMapRef.value?.getWorldZoom?.() ?? 2
    map.setView([15, 0], zoom, { animate: false })
    return
  }

  const targetName = mapSelectionName.value
  const layer = [...mapLayers.entries()]
    .find(([name]) => countryKey(name) === countryKey(targetName))?.[1]
  const focusGeometry = layer?.feature?.checklistFocusGeometry || layer?.feature?.geometry
  const defaultBounds = COUNTRY_VIEW_OVERRIDES[countryKey(targetName)]
    || mainlandBounds(focusGeometry) || layer?.getBounds?.()
  const bounds = wrappedCountryBounds(layer?.feature, map.getCenter().lng, defaultBounds) || defaultBounds
  if (bounds && (Array.isArray(bounds) || bounds.isValid())) {
    layer.bringToFront()
    focusMapBounds(map, bounds, 8)
  }
}

function onCountryMapReady() {
  mapReady.value = true
  syncMapSelection()
}

function countryTooltip(name) {
  const label = countryDisplayName(name)
  if (countsLoading.value) return `${label}: Loading species counts…`
  if (countsError.value) return `${label}: Counts unavailable`
  return `${label}: ${countryCounts.value.get(countryKey(name)) || 0} reported species`
}

function refreshCountryTooltips() {
  for (const layer of mapLayers.values()) {
    if (layer.isTooltipOpen()) layer.getTooltip().update()
  }
}

const geojsonOptions = () => ({
  style: countryStyle,
  onEachFeature: (feature, layer) => {
    const name = feature.properties?.name
    if (!name || NON_SELECTABLE_AREAS.has(countryKey(name))) return
    mapLayers.set(name, layer)
    layer.bindTooltip(() => countryTooltip(name), { sticky: true })
    layer.on('click', () => {
      const option = countries.value.find((country) => country.key === countryKey(name))
      selectCountry(option?.name || name)
    })
    layer.on('mouseover', (event) => event.target.setStyle({
      weight: countryKey(name) === countryKey(mapSelectionName.value) ? 3.5 : 1.5,
      fillOpacity: shapeOpacity() + 0.25
    }))
    layer.on('mouseout', () => layer.setStyle(countryStyle(feature)))
  }
})

function selectCountry(name, region = '') {
  const areaParentKey = ASSOCIATED_AREA_PARENT_BY_KEY.get(countryKey(name))
  if (areaParentKey && !region) {
    region = name
    name = ASSOCIATED_AREAS_BY_SOVEREIGN[areaParentKey].country
  }
  const params = new URLSearchParams()
  if (name) params.set('country', name)
  if (name && region) params.set('region', region)
  const query = params.toString() ? `?${params.toString().replace(/\+/g, '%20')}` : ''
  pendingCountryScrollY = window.scrollY
  window.location.hash = `/checklists${query}`
}

function selectRegion(region) {
  selectCountry(selectedCountry.value, region)
}

function syncCountryFromHash() {
  const [path, query = ''] = window.location.hash.slice(1).split('?')
  if (path !== '/checklists') return
  const params = new URLSearchParams(query)
  let country = params.get('country') || ''
  let region = country ? params.get('region') || '' : ''
  const areaParentKey = ASSOCIATED_AREA_PARENT_BY_KEY.get(countryKey(country))
  if (areaParentKey) {
    region = country
    country = ASSOCIATED_AREAS_BY_SOVEREIGN[areaParentKey].country
  }
  selectedCountry.value = country
  selectedRegion.value = region
  speciesFilter.value = ''
  expandedTaxonKey.value = ''
  expandedReferenceKey.value = ''
  checklistCitationUrl.value = window.location.href
  citationAccessDate.value = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  const activeCountry = isAssociatedAreaSelection.value ? selectedRegion.value : country
  if (activeCountry !== loadedCountry) {
    loadedCountry = activeCountry
    loadCountry(activeCountry)
  }
  if (pendingCountryScrollY !== null) {
    const scrollY = pendingCountryScrollY
    pendingCountryScrollY = null
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'auto' })))
  }
}

const selectionLabel = computed(() => {
  const country = countryDisplayName(selectedCountry.value)
  if (isAssociatedAreaSelection.value) return countryDisplayName(selectedRegion.value)
  return selectedRegion.value ? `${countryDisplayName(selectedRegion.value)}, ${country}` : country
})

const pageTitle = computed(() => selectionLabel.value)

// Not shown on the page (the site footer carries the citation), only
// written into the CSV / text / RTF exports, which leave the page.
const recommendedCitation = computed(() => {
  if (!selectedCountry.value || !checklistCitationUrl.value || !citationAccessDate.value) return ''
  const authors = projectAuthors || projectName
  return `${authors} (${new Date().getFullYear()}). ${projectName}: ${selectionLabel.value} checklist. Accessed ${citationAccessDate.value}. ${checklistCitationUrl.value}`
})

const regionLabel = computed(() => REGION_LABELS[countryKey(selectedCountry.value)] || 'Region')

const countrySubdivisions = computed(() => {
  const key = countryKey(selectedCountry.value)
  if (!REGION_LABELS[key] || !subdivisionGeoJson.value) return []
  return subdivisionGeoJson.value.features.filter((feature) => countryKey(feature.properties.country) === key)
})

const subdivisionIndex = computed(() => (
  countrySubdivisions.value.length ? buildSubdivisionIndex(countrySubdivisions.value) : null
))

function recordRegion(record) {
  if (!subdivisionIndex.value) return ''
  const shapeName = distributionPlacesByOccurrence.value.get(String(record.dwc_occurrence_object_id || ''))
  return resolveSubdivision(subdivisionIndex.value, record.stateProvince, shapeName, record.county)
}

const scopedRows = computed(() => (
  isAssociatedAreaSelection.value
    ? countryRows.value
    : selectedRegion.value
      ? countryRows.value.filter((record) => recordRegion(record) === selectedRegion.value)
      : countryRows.value
))

const regionCounts = computed(() => {
  const speciesByRegion = new Map()
  for (const record of countryRows.value) {
    if (!isSpeciesRecord(record)) continue
    const region = recordRegion(record)
    if (!region) continue
    if (!speciesByRegion.has(region)) speciesByRegion.set(region, new Set())
    speciesByRegion.get(region).add(speciesKey(record))
  }
  return new Map([...speciesByRegion.entries()].map(([region, set]) => [region, set.size]))
})

const subdivisionOptions = computed(() => countrySubdivisions.value
  .map((feature) => ({
    key: `subdivision-${feature.properties.name}`,
    name: feature.properties.name,
    count: isAssociatedAreaSelection.value ? null : regionCounts.value.get(feature.properties.name) || 0
  }))
  .filter((region) => isAssociatedAreaSelection.value || region.count || region.name === selectedRegion.value))

const selectedSubdivision = computed(() => (
  !isAssociatedAreaSelection.value
    ? subdivisionOptions.value.find((region) => region.name === selectedRegion.value)?.name || ''
    : ''
))

const displayedSpeciesCount = computed(() => {
  if (!selectedRegion.value) return selectedCountryCount.value
  if (isAssociatedAreaSelection.value) return countryCounts.value.get(countryKey(selectedRegion.value)) || 0
  return regionCounts.value.get(selectedRegion.value) || 0
})

async function loadSubdivisions() {
  if (subdivisionGeoJson.value) return
  try {
    const response = await fetch(`${base_url}data/subdivisions.geojson`)
    if (!response.ok) throw new Error('Could not load subdivision boundaries.')
    subdivisionGeoJson.value = prepareSubdivisionMapData(await response.json())
  } catch {
    mapError.value = 'State and province boundaries could not be loaded.'
  }
}

function subdivisionStyle(feature) {
  const name = feature.properties.name
  const count = regionCounts.value.get(name) || 0
  const selected = name === selectedRegion.value
  return {
    color: selected ? cssVar('--tp-base-content') : cssVar('--tp-base-foreground'),
    weight: selected ? 3.5 : 0.8,
    fillColor: colorForCount(count),
    fillOpacity: count ? shapeOpacity() : 0.12
  }
}

async function updateSubdivisionLayer() {
  const requestId = ++subdivisionLayerRequestId
  const country = countryKey(selectedCountry.value)
  if (subdivisionLayer && subdivisionLayerCountryKey === country && !isAssociatedAreaSelection.value) {
    subdivisionsShown.value = true
    return
  }

  subdivisionsShown.value = false
  subdivisionLayer?.remove()
  subdivisionLayer = null
  subdivisionLayerCountryKey = ''
  if (!REGION_LABELS[country]) return

  await loadSubdivisions()
  if (requestId !== subdivisionLayerRequestId) return
  if (isAssociatedAreaSelection.value) return
  const map = countryMapRef.value?.getMapObject?.()
  if (!map) return
  const { default: L } = await import('leaflet')
  if (requestId !== subdivisionLayerRequestId || !countrySubdivisions.value.length) return

  subdivisionLayer = L.geoJSON(
    { type: 'FeatureCollection', features: countrySubdivisions.value },
    {
      style: subdivisionStyle,
      onEachFeature: (feature, layer) => {
        const name = feature.properties.name
        layer.bindTooltip(() => `${name}: ${regionCounts.value.get(name) || 0} reported species`, { sticky: true })
        layer.on('click', (event) => {
          L.DomEvent.stopPropagation(event)
          selectRegion(name === selectedRegion.value ? '' : name)
        })
        layer.on('mouseover', (event) => event.target.setStyle({
          weight: name === selectedRegion.value ? 3.5 : 1.8,
          fillOpacity: shapeOpacity() + 0.25
        }))
        layer.on('mouseout', () => layer.setStyle(subdivisionStyle(feature)))
      }
    }
  ).addTo(map)
  subdivisionLayerCountryKey = country
  subdivisionsShown.value = true
}

async function updateMapView(view) {
  const requestId = ++mapSelectionRequestId
  const map = countryMapRef.value?.getMapObject?.()
  if (!map) return
  map.stop()
  await updateSubdivisionLayer()
  if (requestId !== mapSelectionRequestId) return
  refreshMapStyles()
  restyleSubdivisions()
  if (view === 'world') {
    const zoom = countryMapRef.value?.getWorldZoom?.() ?? 2
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      map.setView([15, 0], zoom, { animate: false })
    } else {
      map.flyTo([15, 0], zoom, { duration: 0.55 })
    }
  } else {
    focusMapOnSelection()
  }
}

function syncMapSelection() {
  return updateMapView('selection')
}

function showWorldView() {
  return updateMapView('world')
}

// Keep the gold country outline above the subdivisions without intercepting their clicks.
function raiseCountryOutline() {
  if (!subdivisionsShown.value) return
  const layer = [...mapLayers.entries()]
    .find(([name]) => countryKey(name) === countryKey(selectedCountry.value))?.[1]
  if (!layer) return
  layer.bringToFront()
  const element = layer.getElement?.()
  if (element) element.style.pointerEvents = isAssociatedAreaSelection.value ? '' : 'none'
}

function restyleSubdivisions() {
  subdivisionLayer?.setStyle(subdivisionStyle)
}

function focusMapOnSelection() {
  if (selectedRegion.value && !isAssociatedAreaSelection.value && subdivisionLayer) {
    const map = countryMapRef.value?.getMapObject?.()
    const layer = subdivisionLayer.getLayers().find((item) => item.feature.properties.name === selectedRegion.value)
    const focusGeometry = layer?.feature?.checklistFocusGeometry || layer?.feature?.geometry
    const defaultBounds = mainlandBounds(focusGeometry) || layer?.getBounds?.()
    const bounds = wrappedCountryBounds(layer?.feature, map.getCenter().lng, defaultBounds) || defaultBounds
    if (map && bounds && (Array.isArray(bounds) || bounds.isValid())) {
      subdivisionLayer.bringToFront()
      layer.bringToFront()
      focusMapBounds(map, bounds, 6)
      raiseCountryOutline()
      return
    }
  }
  focusMapOnCountry()
  subdivisionLayer?.bringToFront()
  raiseCountryOutline()
}

function bareName(record) {
  const name = String(record.scientificName || '').trim()
  const authorship = String(record.scientificNameAuthorship || '').trim()
  return authorship && name.endsWith(authorship)
    ? name.slice(0, -authorship.length).trim()
    : name
}

const species = computed(() => {
  const byTaxon = new Map()
  for (const record of scopedRows.value) {
    if (!isSpeciesRecord(record)) continue
    const key = speciesKey(record)
    if (!key) continue
    if (!byTaxon.has(key)) {
      byTaxon.set(key, {
        key,
        name: bareName(record),
        authorship: String(record.scientificNameAuthorship || '').trim(),
        rank: String(record.taxonRank || '').trim(),
        family: String(record.family || '').trim(),
        otuId: Number(record.otu_id) || null
      })
    } else if (!byTaxon.get(key).family && record.family) {
      // A FieldOccurrence row comes without family; any other row of the taxon has it.
      byTaxon.get(key).family = String(record.family).trim()
    }
  }
  // Grouped by family (unplaced taxa last), alphabetical within each family.
  return [...byTaxon.values()].sort((a, b) => (
    (a.family ? 0 : 1) - (b.family ? 0 : 1)
    || a.family.localeCompare(b.family)
    || a.name.localeCompare(b.name)
  ))
})

const filteredSpecies = computed(() => {
  const query = speciesFilter.value.trim().toLocaleLowerCase()
  if (!query) return species.value
  return species.value.filter((taxon) => `${taxon.name} ${taxon.authorship}`.toLocaleLowerCase().includes(query))
})

const filteredSpeciesGroups = computed(() => {
  const groups = []
  for (const taxon of filteredSpecies.value) {
    const label = taxon.family || 'Family not recorded'
    if (groups.at(-1)?.family !== label) groups.push({ family: label, taxa: [] })
    groups.at(-1).taxa.push(taxon)
  }
  return groups
})


function splitReferences(value) {
  return String(value || '').split(/\s*\|\s*/).map((reference) => reference.trim()).filter(Boolean)
}

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

function compactAuthorList(value) {
  const authors = String(value || '')
    .split(/\s*&\s*|\s+and\s+/i)
    .map((author) => author.split(',')[0].trim())
    .filter(Boolean)
  if (authors.length > 2) return `${authors[0]} et al.`
  return authors.join(' & ')
}

function compactCitation(citationBody, fullReference) {
  const body = plainText(citationBody)
  const shortMatch = body.match(/^(.*?),\s*(\d{4}[a-z]?)(?::\s*(.*))?$/i)
  if (shortMatch) {
    const authors = compactAuthorList(shortMatch[1])
    const pages = shortMatch[3]?.trim()
    return `${authors}, ${shortMatch[2]}${pages ? `:${pages}` : ''}`
  }

  const full = plainText(fullReference || citationBody)
  const fullMatch = full.match(/^(.+?)\s*\((\d{4}[a-z]?)\)/)
  if (!fullMatch) return full
  return `${compactAuthorList(fullMatch[1])}, ${fullMatch[2]}`
}

function distributionPlace(record) {
  const country = String(record.country || mapSelectionName.value).trim()
  const assertedDistributionId = String(record.dwc_occurrence_object_id || '')
  const shapeName = plainText(distributionPlacesByOccurrence.value.get(assertedDistributionId) || '')
  if (shapeName && countryKey(shapeName) !== countryKey(country)) return shapeName

  const details = [...new Set(
    [record.stateProvince, record.county, record.municipality, record.verbatimLocality]
      .map((place) => plainText(place))
      .filter((place) => place && countryKey(place) !== countryKey(country))
  )]
  return details.join(', ')
}

function specimenSourceLabel(record) {
  const selectedCountryKey = countryKey(mapSelectionName.value)
  const locality = [record.verbatimLocality, record.county, record.stateProvince, record.country]
    .map((value) => plainText(value))
    .filter((value) => value && countryKey(value) !== selectedCountryKey)
    .join(', ')
  return [
    record.institutionCode ? `Repository ${record.institutionCode}` : '',
    record.catalogNumber ? `Catalog ${record.catalogNumber}` : '',
    locality
  ].filter(Boolean).join(' · ') || 'Specimen record'
}

function openCitation(citation, place) {
  activeCitation.value = {
    ...citation,
    place
  }
}

function citationsForRecord(record) {
  if (record.dwc_occurrence_object_type !== 'AssertedDistribution') return []
  const occurrenceId = String(record.dwc_occurrence_object_id || record.id || '')
  const linkedCitations = citationsByOccurrence.value.get(occurrenceId)
  if (linkedCitations?.length) return linkedCitations
  return splitReferences(record.associatedReferences).map((full) => ({
    short: compactCitation('', full),
    full: plainText(full)
  }))
}

function countryExportRows() {
  const rows = []
  for (const record of scopedRows.value) {
    if (!isSpeciesRecord(record)) continue
    const isDistribution = record.dwc_occurrence_object_type === 'AssertedDistribution'
    const isSpecimen = record.dwc_occurrence_object_type === 'CollectionObject' || record.basisOfRecord === 'PreservedSpecimen'
    if (!isDistribution && !isSpecimen) continue

    const citations = citationsForRecord(record)
    const citationRows = isDistribution && citations.length ? citations : [{ short: '', full: '' }]
    for (const citation of citationRows) {
      rows.push({
        family: String(record.family || '').trim(),
        scientificName: bareName(record),
        scientificNameAuthorship: String(record.scientificNameAuthorship || '').trim(),
        taxonRank: record.taxonRank || '',
        country: record.country || mapSelectionName.value,
        stateProvince: record.stateProvince || '',
        county: record.county || '',
        municipality: record.municipality || '',
        verbatimLocality: record.verbatimLocality || '',
        evidenceType: isDistribution ? 'Asserted distribution' : 'Specimen',
        institutionCode: record.institutionCode || '',
        catalogNumber: record.catalogNumber || '',
        recordedBy: record.recordedBy || '',
        eventDate: record.eventDate || record.verbatimEventDate || '',
        citation: citation.short || '',
        fullReference: citation.full || '',
        otuId: record.otu_id || '',
        occurrenceId: record.occurrenceID || record.dwc_occurrence_object_id || '',
        recommendedCitation: recommendedCitation.value
      })
    }
  }
  return rows
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function exportSlug(value) {
  return String(value || 'country').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function downloadCountryCSV() {
  const columns = [
    'family', 'scientificName', 'scientificNameAuthorship', 'taxonRank', 'country', 'stateProvince',
    'county', 'municipality', 'verbatimLocality', 'evidenceType', 'institutionCode',
    'catalogNumber', 'recordedBy', 'eventDate', 'citation', 'fullReference', 'otuId', 'occurrenceId', 'recommendedCitation'
  ]
  const rows = countryExportRows()
  const csv = [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n')
  const date = new Date().toISOString().slice(0, 10)
  downloadFile(`${exportPrefix}_${exportSlug(selectionLabel.value)}_checklist_${date}.csv`, `\ufeff${csv}`, 'text/csv;charset=utf-8')
}

function checklistExportContent() {
  const taxa = []
  const references = new Set()
  for (const taxon of species.value) {
    const distributions = []
    const specimens = []
    for (const source of sourcesByTaxon.value.get(taxon.key) || []) {
      if (source.type === 'reference') {
        const citations = source.citations.map((citation) => citation.short).filter(Boolean)
        distributions.push({ place: source.place || mapSelectionName.value, citations })
        source.citations.forEach((citation) => citation.fullReferences.forEach((reference) => references.add(reference)))
      } else {
        specimens.push(source.label)
      }
    }
    taxa.push({ taxon, distributions, specimens })
  }
  return { taxa, references: [...references].sort((a, b) => a.localeCompare(b)) }
}

function downloadCountryText() {
  const { taxa, references } = checklistExportContent()
  const lines = [
    `${projectName}: ${selectionLabel.value} checklist`,
    `Generated ${new Date().toISOString().slice(0, 10)}.`,
    `Recommended citation: ${recommendedCitation.value}`,
    `${taxa.length} species and subspecies with indexed records.`,
    '',
    'CHECKLIST',
    ''
  ]
  let currentFamily = null

  for (const entry of taxa) {
    const { taxon } = entry
    if (taxon.family !== currentFamily) {
      currentFamily = taxon.family
      lines.push(`${currentFamily || 'Family not recorded'}`.toUpperCase(), '')
    }
    lines.push(`${taxon.name}${taxon.authorship ? ` ${taxon.authorship}` : ''}`)
    for (const distribution of entry.distributions) {
      lines.push(`  Distribution: ${distribution.place}${distribution.citations.length ? ` (${distribution.citations.join('; ')})` : ''}`)
    }
    entry.specimens.forEach((specimen) => lines.push(`  Specimen: ${specimen}`))
    lines.push('')
  }

  lines.push('REFERENCES', '', ...references)
  const date = new Date().toISOString().slice(0, 10)
  downloadFile(`${exportPrefix}_${exportSlug(selectionLabel.value)}_checklist_${date}.txt`, lines.join('\r\n'), 'text/plain;charset=utf-8')
}

function escapeRtf(value) {
  let output = ''
  const appendUnicode = (unit) => {
    output += `\\u${unit > 32767 ? unit - 65536 : unit}?`
  }
  for (const character of String(value ?? '')) {
    const codePoint = character.codePointAt(0)
    if (character === '\\' || character === '{' || character === '}') {
      output += `\\${character}`
    } else if (codePoint >= 32 && codePoint <= 126) {
      output += character
    } else if (codePoint <= 0xffff) {
      appendUnicode(codePoint)
    } else {
      const adjusted = codePoint - 0x10000
      appendUnicode(0xd800 + (adjusted >> 10))
      appendUnicode(0xdc00 + (adjusted & 0x3ff))
    }
  }
  return output
}

function downloadCountryRtf() {
  const { taxa, references } = checklistExportContent()
  const date = new Date().toISOString().slice(0, 10)
  const lines = [
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}\\viewkind4\\uc1',
    `\\pard\\qc\\sa240\\fs32\\b ${escapeRtf(`${projectName}: ${selectionLabel.value} checklist`)}\\b0\\fs24\\par`,
    `\\pard\\qc\\sa200\\fs20         Generated ${date}. ${taxa.length} species and subspecies with indexed records.\\fs24\\par`,
        `\\pard\\qc\\sa120\\fs18 Recommended citation: ${escapeRtf(recommendedCitation.value)}\\fs20\\par`,
        '\\pard\\sb240\\sa100\\b CHECKLIST\\b0\\par'
      ]

      let currentFamily = null
      for (const entry of taxa) {
        const { taxon } = entry
    if (taxon.family !== currentFamily) {
      currentFamily = taxon.family
      lines.push(`\\pard\\sb160\\sa80\\b ${escapeRtf(currentFamily || 'Family not recorded')}\\b0\\par`)
    }
    lines.push(`\\pard\\sa60\\i ${escapeRtf(taxon.name)}\\i0${taxon.authorship ? `\\~${escapeRtf(taxon.authorship)}` : ''}\\par`)
    for (const distribution of entry.distributions) {
      const citations = distribution.citations.length ? ` (${distribution.citations.join('; ')})` : ''
      lines.push(`\\pard\\li360\\sa40 Distribution: ${escapeRtf(distribution.place + citations)}\\par`)
    }
    for (const specimen of entry.specimens) {
      lines.push(`\\pard\\li360\\sa40 Specimen: ${escapeRtf(specimen)}\\par`)
    }
    lines.push('\\pard\\sa80\\par')
  }

  lines.push('\\pard\\sb240\\sa100\\b REFERENCES\\b0\\par')
  references.forEach((reference) => lines.push(`\\pard\\sa80 ${escapeRtf(reference)}\\par`))
  lines.push('}')

  downloadFile(
    `${exportPrefix}_${exportSlug(selectionLabel.value)}_checklist_${date}.rtf`,
    lines.join('\r\n'),
    'application/rtf'
  )
}

const sourcesByTaxon = computed(() => {
  const groups = new Map()
  for (const record of scopedRows.value) {
    if (!isSpeciesRecord(record)) continue
    const taxonKey = speciesKey(record)
    if (!groups.has(taxonKey)) groups.set(taxonKey, { references: new Map(), specimens: [] })
    const group = groups.get(taxonKey)

    if (record.dwc_occurrence_object_type === 'AssertedDistribution') {
      const occurrenceId = String(record.dwc_occurrence_object_id || record.id || '')
      const references = citationsForRecord(record)
      const place = distributionPlace(record)
      if (!group.references.has(place)) {
        group.references.set(place, { place, citations: new Map() })
      }
      const placeGroup = group.references.get(place)
      for (const reference of references) {
        const full = plainText(reference.full)
        const short = plainText(reference.short) || compactCitation('', full)
        if (!full && !short) continue
        const citationKey = short || full
        if (!placeGroup.citations.has(citationKey)) {
          placeGroup.citations.set(citationKey, {
            key: citationKey,
            short,
            fullReferences: new Set()
          })
        }
        const citation = placeGroup.citations.get(citationKey)
        if (full) citation.fullReferences.add(full)
      }
    } else if (record.dwc_occurrence_object_type === 'CollectionObject' || record.basisOfRecord === 'PreservedSpecimen') {
      group.specimens.push({
        type: 'specimen',
        key: `specimen-${record.dwc_occurrence_object_id || record.id || group.specimens.length}`,
        label: specimenSourceLabel(record)
      })
    }
  }

  return new Map([...groups.entries()].map(([taxonKey, group]) => [
    taxonKey,
    [
      ...[...group.references.entries()]
        .map(([key, reference]) => ({
          type: 'reference',
          key: `reference-${taxonKey}-${key}`,
          place: reference.place,
          citations: [...reference.citations.values()]
            .map((citation) => ({
              ...citation,
              fullReferences: [...citation.fullReferences]
            }))
            .sort((a, b) => a.short.localeCompare(b.short))
        }))
        .sort((a, b) => a.place.localeCompare(b.place) || a.short.localeCompare(b.short)),
      ...group.specimens
    ]
  ]))
})

const recordEvidenceByTaxon = computed(() => {
  const evidence = new Map()
  for (const record of scopedRows.value) {
    if (!isSpeciesRecord(record)) continue
    const taxonKey = speciesKey(record)
    if (!evidence.has(taxonKey)) evidence.set(taxonKey, { citations: new Set(), specimens: new Set() })
    const taxonEvidence = evidence.get(taxonKey)

    if (record.dwc_occurrence_object_type === 'AssertedDistribution') {
      const occurrenceId = String(record.dwc_occurrence_object_id || record.id || '')
      const linkedCitations = citationsByOccurrence.value.get(occurrenceId)
      if (linkedCitations?.length) {
        for (const citation of linkedCitations) {
          const citationId = citation.id || citation.short || citation.full
          if (citationId) taxonEvidence.citations.add(`${occurrenceId}:${citationId}`)
        }
      } else {
        for (const reference of splitReferences(record.associatedReferences)) {
          const citation = compactCitation('', plainText(reference))
          if (citation) taxonEvidence.citations.add(`${occurrenceId}:${citation.toLocaleLowerCase()}`)
        }
      }
    } else if (record.dwc_occurrence_object_type === 'CollectionObject' || record.basisOfRecord === 'PreservedSpecimen') {
      const recordId = `${record.dwc_occurrence_object_type || record.basisOfRecord}:${record.dwc_occurrence_object_id || record.id || taxonKey}`
      taxonEvidence.specimens.add(recordId)
    }
  }
  return new Map([...evidence.entries()].map(([taxonKey, counts]) => [taxonKey, {
    citations: counts.citations.size,
    specimens: counts.specimens.size,
    total: counts.citations.size + counts.specimens.size
  }]))
})

const topReferences = computed(() => {
  const references = new Map()
  for (const record of scopedRows.value) {
    const isDistribution = record.dwc_occurrence_object_type === 'AssertedDistribution'
    const isSpecimen = record.dwc_occurrence_object_type === 'CollectionObject' || record.basisOfRecord === 'PreservedSpecimen'
    if (!isDistribution && !isSpecimen) continue

    const citationRefs = isDistribution
      ? citationsByOccurrence.value.get(String(record.dwc_occurrence_object_id))
      : null
    const fullReferences = citationRefs?.length
      ? citationRefs.map((citation) => citation.full)
      : splitReferences(record.associatedReferences)
    for (const rawReference of fullReferences) {
      const full = plainText(rawReference)
      if (!full) continue
      if (!references.has(full)) references.set(full, { full, taxa: new Map() })
      const entry = references.get(full)
      const taxonKey = speciesKey(record)
      if (!entry.taxa.has(taxonKey)) {
        entry.taxa.set(taxonKey, {
          key: taxonKey,
          name: bareName(record),
          authorship: String(record.scientificNameAuthorship || '').trim(),
          otuId: Number(record.otu_id) || null
        })
      }
    }
  }
  return [...references.values()]
    .map((reference, index) => {
      const taxa = [...reference.taxa.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
      return { ...reference, key: `reference-${index}`, taxa }
    })
    .sort((a, b) => b.taxa.length - a.taxa.length || a.full.localeCompare(b.full))
    .slice(0, 10)
})

async function loadCountry(name) {
  const requestId = ++countryRequestId
  countryLoading.value = Boolean(name)
  countryError.value = ''
  countryRows.value = []
  citationsByOccurrence.value = new Map()
  distributionPlacesByOccurrence.value = new Map()
  speciesFilter.value = ''
  expandedTaxonKey.value = ''
  expandedReferenceKey.value = ''
  activeCountryTab.value = 'species'
  if (!name) return

  try {
    await indexReady
    if (requestId !== countryRequestId) return
    const id = checklistIdByKey.value.get(countryKey(name))
    if (!id) throw new Error('No checklist for this country.')
    const response = await fetch(`${base_url}checklists/countries/${id}.json`)
    if (!response.ok) throw new Error('Could not load the country checklist.')
    const records = await response.json()
    if (requestId !== countryRequestId) return
    const places = new Map()
    const citations = new Map()
    for (const record of records) {
      if (record.dwc_occurrence_object_type !== 'AssertedDistribution') continue
      const id = String(record.dwc_occurrence_object_id)
      if (record.place) places.set(id, record.place)
      if (record.citations?.length) {
        citations.set(id, record.citations.map((citation) => {
          const short = compactCitation('', citation.full)
          return { id: citation.id, full: citation.full, short: citation.pages ? `${short}:${citation.pages}` : short }
        }))
      }
    }
    countryRows.value = records
    distributionPlacesByOccurrence.value = places
    citationsByOccurrence.value = citations
  } catch {
    countryError.value = 'Could not load this country’s records. Please try again.'
  } finally {
    if (requestId === countryRequestId) countryLoading.value = false
  }
}

// Leaflet holds literal colours, so restyle when the dark-mode class flips.
let themeObserver = null

onMounted(() => {
  themeObserver = new MutationObserver(() => {
    refreshMapStyles()
    restyleSubdivisions()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('hashchange', syncCountryFromHash)
  syncCountryFromHash()
  loadCountryShapes()
  loadCountryCounts()
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  window.removeEventListener('hashchange', syncCountryFromHash)
  mapSelectionRequestId += 1
  subdivisionLayerRequestId += 1
  countryMapRef.value?.getMapObject?.()?.stop()
})

watch([selectedCountry, selectedRegion], syncMapSelection, { flush: 'post' })

watch([countryCounts, countsLoading, countsError], refreshCountryTooltips)
watch(regionCounts, restyleSubdivisions)
</script>
