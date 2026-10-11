<template>
  <div :aria-busy="loading" class="min-w-0">
    <Teleport v-if="toolbar && active" :to="toolbar">
      <VToggle size="sm" :model-value="settings.showAuthorship"
        @update:model-value="toggleAuthorship">Show author / year</VToggle>
      <AssociationSelectionMenu label="Columns" required-selection :options="columnOptions" :model-value="selectedColumns"
        @update:model-value="setColumns" @reset="setColumns(DEFAULT_COLUMNS)" />
    </Teleport>
    <Teleport v-if="rowsToolbar && active" :to="rowsToolbar">
        <SelectInput :model-value="settings.per" aria-label="Rows per page"
          @update:model-value="updateSettings({ per: Number($event) })">
          <option v-for="size in [50, 100]" :key="size" :value="size">{{ size }}</option>
        </SelectInput>
    </Teleport>
    <p v-if="loading" class="mb-3 text-sm" role="status">Loading {{ loadingLabel }}…</p>
    <p v-if="error" data-testid="advanced-metadata-error" role="alert" class="mb-3 text-sm">
      {{ error }} <VButton size="xs" variant="secondary" outline @click="retry">Retry</VButton>
    </p>
    <div class="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <span data-testid="advanced-record-count">{{ countLabel }}</span>
      <VButton size="xs" variant="secondary" outline @click="resetFilters">Reset filters and sorting</VButton>
      <span v-if="hiddenFilterCount" class="opacity-70">{{ hiddenFilterCount }} hidden column filter(s) active</span>
    </div>
    <VPagination v-model="page" :total="filteredRows.length" :per="settings.per" class="mb-4" />
    <div ref="tableRoot" class="max-h-[70vh] overflow-auto">
      <VTable class="advanced-associations mx-auto">
        <VTableHeader class="advanced-header normal-case">
          <VTableHeaderRow>
            <VTableHeaderCell v-for="group in groups" :key="group.side" :colspan="group.count" class="border-l-2 first:border-l-0">
              <div class="flex flex-wrap items-center justify-center gap-2">
                {{ group.label }}
                <VButton v-if="['subject', 'object'].includes(group.side)" size="xs" variant="secondary"
                  outline class="advanced-outline" :data-active="settings.original[group.side]"
                  data-copy-ignore :aria-label="`${group.side} names: showing ${settings.original[group.side] ? 'original' : 'current'} names, activate to switch`"
                  :aria-pressed="settings.original[group.side]" @click="toggleOriginal(group.side)">
                  {{ settings.original[group.side] ? 'Show current names' : 'Show original names' }}
                </VButton>
                <NameDisplayInfo v-if="['subject', 'object'].includes(group.side)" :side="group.side" />
              </div>
            </VTableHeaderCell>
          </VTableHeaderRow>
          <VTableHeaderRow>
            <VTableHeaderCell v-for="column in columns" :key="column.key"
              :aria-sort="settings.sort?.key === column.key ? (settings.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'"
              :class="{ 'border-l-2': column.separator }">
              <div class="flex flex-col items-start gap-1">
                <VButton size="xs" variant="secondary" ghost
                  :data-active="settings.sort?.key === column.key" class="advanced-sort text-left"
                  :aria-label="`Sort ${column.side} ${column.label}`" @click="sortBy(column.key)">
                  {{ column.label }}<span data-copy-ignore> {{ settings.sort?.key === column.key ? (settings.sort.direction === 'asc' ? '↑' : '↓') : '↕' }}</span>
                </VButton>
                <span data-copy-ignore>
                  <AssociationSelectionMenu compact :label="`Filter ${column.side} ${column.label}`"
                    :options="optionsFor(column.key)" :model-value="selectedColumnValues(displayRows, settings, column.key)"
                    :active="column.key in settings.filters" :searchable="column.key !== 'depictions'"
                    :disabled="loading"
                    @update:model-value="setFilter(column.key, $event)" @reset="resetFilter(column.key)" />
                </span>
              </div>
            </VTableHeaderCell>
          </VTableHeaderRow>
        </VTableHeader>
        <VTableBody>
          <VTableBodyRow v-for="row in visibleRows" :key="row.id">
            <VTableBodyCell v-for="column in columns" :key="column.key" class="align-middle"
              :class="{ 'border-l-2': column.separator }">
              <template v-if="['family', 'genus', 'species'].includes(column.field)">
                <span :data-copy-text="nameCopyText(row, column)">
                  <template v-for="(name, index) in row[column.side][`${column.field}Names`]" :key="index">
                      <span v-if="index"> now </span>
                      <RouterLink v-if="name.otuId" class="hover:underline" :class="{ italic: column.field !== 'family' }"
                        target="_blank" rel="noopener noreferrer"
                        :to="{ name: 'otus-id', params: { id: name.otuId } }">{{ name.name }}</RouterLink>
                      <span v-else :class="{ italic: column.field !== 'family' && row[column.side].italic }">{{ name.name }}</span>
                      <span v-if="name.authorship">{{ ' ' + name.authorship }}</span>
                  </template>
                  <button v-if="column.field === 'species' && row[column.side].specimen" type="button"
                    class="ml-1 cursor-pointer rounded text-xs" title="Show details"
                    :aria-label="`Show ${row[column.side].specimen.type} details`"
                    @click="emit('show-specimen', row[column.side].specimen)">ⓘ</button>
                </span>
              </template>
              <template v-else-if="column.key === 'depictions'">
                <span v-if="!metadata.depictions">…</span>
                <span v-else :data-copy-text="row.depictions === 'Present' ? 'Present' : ''">
                  <button v-if="images.get(String(row.id))?.length" type="button" class="cursor-pointer"
                    aria-label="Show association depictions" @click="emit('show-images', images.get(String(row.id)))">
                    <img :src="images.get(String(row.id))[0].thumb" alt="Association depiction" loading="lazy" class="h-12 w-12 rounded object-cover" />
                  </button>
                  <span v-else-if="row.depictions === 'Present'">Present</span>
                </span>
              </template>
              <template v-else-if="column.key === 'attribute' || column.key === 'value'">
                <div :data-copy-text="columnValues(row, column.key).join('; ')">
                  <div v-for="(attribute, index) in row.attributes" :key="attribute.id" class="text-sm">
                    <span v-if="row.attributes.length > 1">{{ index + 1 }}. </span>{{ column.key === 'attribute' ? attribute.name : attribute.value }}
                  </div>
                </div>
              </template>
              <template v-else-if="column.key === 'citations'">
                <div v-for="citation in row.citationList" :key="citation.id" class="text-sm leading-snug">
                  <button type="button" class="text-left hover:underline cursor-pointer text-secondary"
                    @click="emit('show-citations', { associationId: row.id, citationId: citation.id, full: citation.full })"
                    v-html="sanitizeAndLinkifyHtml(citation.short)" />
                </div>
                <!-- Collector and determiner names share this column in the
                     /basic index, and a photo credit is filed as a source too.
                     Neither opens a reference, so neither may look like one. -->
                <div v-for="note in row.citationNotes" :key="note" class="text-sm leading-snug opacity-70">{{ note }}</div>
              </template>
              <span v-else>{{ columnValues(row, column.key).join(', ') }}</span>
            </VTableBodyCell>
          </VTableBodyRow>
        </VTableBody>
      </VTable>
    </div>
    <p v-if="!loading && !error && !visibleRows.length && displayRows.length && !filteredRows.length"
      data-testid="advanced-filtered-empty" role="status" class="my-8 text-center">
      All records on this page are hidden by active filters. Use “Reset filters and sorting” to show them.
    </p>
    <p v-else-if="!loading && !error && !visibleRows.length" data-testid="advanced-no-records" role="status" class="my-8 text-center">
      No records found.
    </p>
    <VPagination v-model="page" :total="filteredRows.length" :per="settings.per" class="mt-4" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { makeAPIRequest, sanitizeAndLinkifyHtml } from '@/utils'
import AssociationSelectionMenu from './AssociationSelectionMenu.vue'
import NameDisplayInfo from './NameDisplayInfo.vue'
import { alphabetical } from './groupStandardAssociations.js'
import { ADVANCED_COLUMNS, DEFAULT_COLUMNS, columnValues, defaultAdvancedSettings, filterAdvancedRows, filterValues,
  makeAdvancedRows, nextAdvancedSort, normalizeAdvancedSettings, selectedColumnValues, sortAdvancedRows, translateNameFilters } from './advancedAssociations.js'
import { loadAdvancedMetadata } from './loadAdvancedAssociations.js'
import { readBrowserSession, writeBrowserSession } from './browserSessionStorage.js'
import { copyTableSelection } from './tableClipboard.js'

const props = defineProps({
  rows: { type: Array, required: true }, taxa: { type: Object, required: true },
  // Names and classification arrive complete from the panel: the table shows
  // every record of the taxon and does all filtering, sorting and paging on
  // them, so nothing here depends on a server page any more.
  classification: { type: Map, default: () => new Map() },
  scope: { type: String, required: true }, toolbar: { default: null }, rowsToolbar: { default: null }, active: Boolean,
  loadImages: { type: Function, required: true },
  sourceCache: { type: Map, default: () => new Map() }
})
const emit = defineEmits(['show-specimen', 'show-images', 'show-citations', 'count'])
const settings = ref(normalizeAdvancedSettings(readBrowserSession(`taxonpages:advanced:${props.scope}`)))
const page = ref(1)
const metadata = shallowRef({})
const images = shallowRef(new Map())
const loading = ref(false)
const loadingLabel = ref('association metadata')
const error = ref('')
const tableRoot = ref(null)
let disposed = false
let metadataRequest = null
let imageRequest = 0
let metadataGeneration = 0

const columnOptions = ADVANCED_COLUMNS.filter(column => column.key !== 'value').map(column => ({ value: column.key,
  label: `${['subject', 'object'].includes(column.side) ? column.side === 'subject' ? 'Subject: ' : 'Object: ' : ''}${column.label}` }))
const columns = computed(() => ADVANCED_COLUMNS.filter(column => settings.value.columns.includes(column.key))
  .map((column, index, visible) => ({
    ...column,
    separator: index > 0 && column.side !== visible[index - 1].side
  })))
const selectedColumns = computed(() => settings.value.columns.filter(key => key !== 'value'))
const groups = computed(() => ['subject', 'biological', 'object', 'metadata'].map(side => ({
  side, label: { subject: 'Subject', biological: 'Relationship', object: 'Object', metadata: 'Metadata' }[side],
  count: columns.value.filter(column => column.side === side).length
})).filter(group => group.count))
const originalSubject = computed(() => settings.value.original.subject)
const originalObject = computed(() => settings.value.original.object)
const showAuthorship = computed(() => settings.value.showAuthorship)
const displayRows = computed(() => makeAdvancedRows(props.rows, props.taxa,
  { original: { subject: originalSubject.value, object: originalObject.value }, showAuthorship: showAuthorship.value }, metadata.value, props.classification, true))
const valuesByColumn = computed(() => new Map(ADVANCED_COLUMNS.map(column => [column.key,
  [...new Set(displayRows.value.flatMap(row => filterValues(row, column.key)))].sort(alphabetical)
])))
const filteredRows = computed(() => sortAdvancedRows(filterAdvancedRows(displayRows.value, settings.value), settings.value.sort))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / settings.value.per)))
// One string, so the line the reader sees is the line a test can assert.
const countLabel = computed(() => `${filteredRows.value.length} of ${displayRows.value.length} records`
  + (filteredRows.value.length ? ` · page ${page.value} of ${pageCount.value}` : ''))
const visibleRows = computed(() =>
  filteredRows.value.slice((page.value - 1) * settings.value.per, page.value * settings.value.per))
const hiddenFilterCount = computed(() => Object.keys(settings.value.filters).filter(key => !settings.value.columns.includes(key)).length)
const needed = computed(() => {
  const keys = new Set([...settings.value.columns, ...Object.keys(settings.value.filters), settings.value.sort?.key])
  // One batched request per metadata kind, for every record of the taxon --
  // filters have to offer the values of records that are not on screen.
  // Citations belong here: the /basic index only carries a single pre-rendered
  // summary string, which cannot be split into the individual, clickable
  // references the column renders.
  return [...new Set([...keys].map(key =>
    ({ depictions: 'depictions', area: 'distributions', citations: 'citations',
      tags: 'tags', attribute: 'attributes', value: 'attributes' })[key]).filter(Boolean))]
})

function updateSettings(change) {
  const before = settings.value
  settings.value = normalizeAdvancedSettings({ ...before, ...change })
  // Every setting acts on rows already in hand, so none of this costs a
  // request -- but they do not all mean the same thing for the reader's place
  // in the table. A different result set starts at its own beginning; a
  // different page size keeps the first visible record in view; showing
  // another column must not move the reader at all. Renaming (author / year,
  // original names) carries name filters translated to select the same
  // records, so it keeps the page like a column switch does.
  const renamed = 'showAuthorship' in change || 'original' in change
  if (!renamed && ('filters' in change || 'sort' in change)) page.value = 1
  else if ('per' in change) page.value = movePage(before.per, settings.value.per)
  writeBrowserSession(`taxonpages:advanced:${props.scope}`, settings.value)
}

/** Keep the first record of the current page in view across a size change. */
function movePage(fromPer, toPer) {
  const firstIndex = (page.value - 1) * fromPer
  const pages = Math.max(1, Math.ceil(filteredRows.value.length / toPer))
  return Math.min(Math.floor(firstIndex / toPer) + 1, pages)
}

function reportMetadataError(error, phase, route) {
  if (typeof __APP_ENV__ !== 'undefined' && __APP_ENV__.debug && typeof console !== 'undefined') {
    console.warn('[biological-associations]', {
      view: 'advanced', phase, route,
      status: error?.response?.status || error?.status || null,
      message: error?.message || String(error)
    })
  }
}
function setColumns(columns) { if (columns.length) updateSettings({ columns }) }

function setFilter(key, values) {
  const availableValues = valuesByColumn.value.get(key) || []
  const selected = new Set(values)

  const filters = { ...settings.value.filters }

  if (availableValues.length && availableValues.every(value => selected.has(value))) {
    delete filters[key]
  } else {
    filters[key] = [...values]
  }

  updateSettings({ filters })
}

function resetFilter(key) {
  const filters = { ...settings.value.filters }
  delete filters[key]
  updateSettings({ filters })
}
function resetFilters() { updateSettings({ filters: {}, sort: defaultAdvancedSettings().sort }) }
function toggleOriginal(side) {
  const original = { ...settings.value.original, [side]: !settings.value.original[side] }
  const after = makeAdvancedRows(props.rows, props.taxa, { ...settings.value, original }, metadata.value, props.classification, true)
  const filters = translateNameFilters(displayRows.value, after, settings.value.filters, side)
  updateSettings({ original, filters })
}
function toggleAuthorship() {
  const showAuthorship = !settings.value.showAuthorship
  const after = makeAdvancedRows(props.rows, props.taxa, { ...settings.value, showAuthorship }, metadata.value, props.classification, true)
  let filters = settings.value.filters
  for (const side of ['subject', 'object']) filters = translateNameFilters(displayRows.value, after, filters, side)
  updateSettings({ showAuthorship, filters })
}
function sortBy(key) {
  updateSettings({ sort: nextAdvancedSort(settings.value.sort, key) })
}
function optionsFor(key) {
  if (key === 'depictions') return ['Present', 'Absent'].map(value => ({ value, label: value }))
  // Keep selected terms available even when another column currently excludes
  // them; selections persist meaningfully across species in the same scope.
  const values = new Set([...(valuesByColumn.value.get(key) || []), ...(settings.value.filters[key] || [])])
  return [...values].sort(alphabetical).map(value => ({ value, label: value || '(Blank)' }))
}
function nameCopyText(row, column) {
  const participant = row[column.side]
  const value = participant[column.field]
  return column.field === 'species' ? value + (participant.specimen ? ` (${participant.specimen.type})` : '') : undefined
}

async function ensureMetadata(generation = metadataGeneration) {
  if (disposed || !props.active) return
  if (generation !== metadataGeneration) return
  if (metadataRequest) return metadataRequest
  // Claim the slot before the first `await`. The guard used to be checked here
  // but only set after awaiting `loadTaxa`, so the synchronous rows watcher and
  // the `needed` watcher both slipped through in the same tick and every kind
  // was fetched twice on every page change.
  metadataRequest = loadMetadataOnce(generation)
  let fetched = false
  try {
    fetched = await metadataRequest
  } finally {
    if (generation === metadataGeneration) {
      metadataRequest = null
      if (!disposed) loading.value = false
    }
  }
  // A completed batch can widen `needed` -- a resolved family adds
  // classification. Only loop when something was actually fetched, otherwise
  // an empty `pending` would call this forever.
  if (fetched && !error.value && !disposed && generation === metadataGeneration) await ensureMetadata(generation)
}

/** One batch per missing annotation kind, over every record of the taxon.
 * Returns whether a metadata batch ran. */
async function loadMetadataOnce(generation) {
  const pending = needed.value.filter(kind => !metadata.value[kind])
  if (!pending.length) return false
  loading.value = true
  loadingLabel.value = pending.join(', ')
  error.value = ''
  const results = await Promise.allSettled(pending.map(async kind => {
    const result = await loadAdvancedMetadata(props.rows.map(row => row.id), kind, makeAPIRequest,
      () => !disposed && generation === metadataGeneration, props.sourceCache)
    if (result && !disposed && generation === metadataGeneration) {
      metadata.value = { ...metadata.value, [kind]: result }
    }
  }))
  if (!disposed && generation === metadataGeneration && results.some(result => result.status === 'rejected')) {
    error.value = 'Some advanced metadata could not be loaded. Please retry.'
  }
  return true
}

async function ensureImages() {
  const requestId = ++imageRequest
  if (!props.active || !settings.value.columns.includes('depictions')) return
  const ids = visibleRows.value.filter(row => row.depictions === 'Present' && !images.value.has(String(row.id))).map(row => row.id)
  if (!ids.length) return
  try {
    const result = await props.loadImages(ids)
    if (disposed || requestId !== imageRequest) return
    images.value = new Map([...images.value, ...ids.map(id => [String(id), result.get(id) || result.get(String(id)) || []])])
  } catch (loadError) {
    if (!disposed) {
      error.value = 'Association images could not be loaded. Please retry.'
      reportMetadataError(loadError, 'images', '/depictions/gallery')
    }
  }
}
async function retry() { error.value = ''; await ensureMetadata(); await ensureImages() }
function copySelection(event) { copyTableSelection(event, tableRoot.value) }
watch(() => props.rows, () => {
  // A new row set is a new taxon. Metadata is keyed by association id, so
  // keeping any of it would let filters and thumbnails refer to records that
  // are no longer in the table.
  metadataGeneration++
  metadataRequest = null
  metadata.value = {}
  images.value = new Map()
  ++imageRequest
  error.value = ''
  page.value = 1
  void ensureMetadata(metadataGeneration)
}, { flush: 'sync' })
// Call with no argument on purpose: a watch callback is invoked with
// (newValue, oldValue, onCleanup), so passing `ensureMetadata` directly would
// bind its `generation` parameter to the value array and fail the generation
// check on every run.
watch([needed, () => props.active], () => ensureMetadata(), { immediate: true })
watch([visibleRows, () => props.active, () => settings.value.columns.includes('depictions')], ensureImages)
watch(filteredRows, rows => emit('count', rows.length), { immediate: true })
onMounted(() => { document.addEventListener('copy', copySelection) })
onBeforeUnmount(() => { disposed = true; ++imageRequest; document.removeEventListener('copy', copySelection) })
</script>

<style scoped>
:deep(.advanced-associations) { width: max-content; min-width: 100%; }
:deep(.advanced-header) {
  position: sticky;
  top: 0;
  z-index: 10;
  /* Match VTableHeader's muted/30 overlay, with an opaque base for sticky scrolling. */
  background-color: var(--color-base-foreground);
  background-image: linear-gradient(
    color-mix(in oklab, var(--color-base-muted) 30%, transparent),
    color-mix(in oklab, var(--color-base-muted) 30%, transparent)
  );
}
:deep(th), :deep(td) { vertical-align: middle; }
:deep(.advanced-outline) {
  background-color: transparent;
  color: var(--color-base-soft);
  border: 1px solid var(--color-base-soft);
}
:deep(.advanced-outline[data-active="true"]) {
  border-color: var(--color-secondary);
}
:deep(.advanced-filter[data-active="true"]) {
  color: var(--color-secondary);
}
:deep(.advanced-sort) { background-color: transparent; color: inherit; border: 0; }
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
