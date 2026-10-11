<template>
  <div ref="tableRoot">
    <VTable
      class="standard-association-table"
      :style="{ '--standard-count-digits': maxCountDigits }"
    >
      <VTableHeader class="normal-case">
        <VTableHeaderRow>
          <VTableHeaderCell class="standard-col-parts">
            <span class="inline-flex items-center gap-1">
              Anatomical parts
              <PlantPartInfo :parts="visibleParts" data-copy-ignore />
            </span>
          </VTableHeaderCell>
          <VTableHeaderCell class="standard-col-taxon">Associated taxon</VTableHeaderCell>
          <VTableHeaderCell class="standard-col-records">
            <span class="inline-flex items-center gap-1">
              Records
              <EvidenceLegendInfo data-copy-ignore />
            </span>
          </VTableHeaderCell>
        </VTableHeaderRow>
      </VTableHeader>
      <VTableBody>
        <template v-for="section in visibleSections" :key="section.heading">
          <VTableBodyRow v-if="section.heading" class="standard-direction-heading">
            <VTableBodyCell colspan="3">{{ section.heading }}</VTableBodyCell>
          </VTableBodyRow>
          <template v-for="family in section.families" :key="`${section.heading}-${family.name}`">
            <VTableBodyRow class="standard-family-heading font-semibold">
              <VTableBodyCell class="standard-col-parts" aria-hidden="true" />
              <VTableBodyCell class="standard-col-taxon">
                {{ family.name || 'Family not specified' }}
              </VTableBodyCell>
              <VTableBodyCell class="standard-col-records" aria-hidden="true" />
            </VTableBodyRow>
          <VTableBodyRow v-for="row in family.rows" :key="row.key">
          <VTableBodyCell class="standard-col-parts">
            <PlantPartIcons :parts="row.parts" />
          </VTableBodyCell>
          <VTableBodyCell class="standard-col-taxon">
            <RouterLink
              v-if="row.otuId && row.families.length"
              :to="{ name: 'otus-id', params: { id: row.otuId } }"
              class="hover:underline"
            >
              <span :class="{ italic: row.italic }">{{ row.name }}</span>
            </RouterLink>
            <span v-else>
              <span :class="{ italic: row.italic }">{{ row.name }}</span>
            </span>
          </VTableBodyCell>
          <VTableBodyCell class="standard-col-records">
            <span class="standard-records-cell">
              <VButton
                class="standard-records-count"
                size="xs"
                variant="secondary"
                ghost
                :aria-label="'Show ' + row.count + ' records for ' + row.name + ' in Raw data'"
                @click="$emit('show-records', row)"
              >{{ row.count }}</VButton>
              <!-- One dot, the best a row earns: in the field the question is
                   how good the strongest evidence for this plant is, not how
                   the record pile splits. The dot carries no text, so table
                   copying stays untouched.

                   It is still a control, not decoration: a native title only
                   ever showed on hover, so on a phone the breakdown was
                   unreachable, and an 8px dot is far under the 24px a finger
                   needs. The button's accessible name carries the whole
                   breakdown, so the dot itself is decorative. -->
              <button
                type="button"
                class="standard-marks"
                :aria-label="marksLabel(row)"
                :aria-expanded="activeRowKey === row.key"
                @click.stop="toggleMarks(row, $event)"
                @mouseenter="hoverMarks(row, $event)"
                @mouseleave="clearHoverMarks"
                @focus="hoverMarks(row, $event)"
                @blur="clearHoverMarks"
                @keydown.escape.stop="closeMarks"
              >
                <span
                  v-if="bestMark(row)"
                  class="evidence-dot"
                  :class="bestMark(row).class"
                  aria-hidden="true"
                />
              </button>
            </span>
          </VTableBodyCell>
            </VTableBodyRow>
          </template>
        </template>
      </VTableBody>
    </VTable>

    <!-- One popover for the table, not one per row: the composable installs
         four global listeners and a ResizeObserver, and the trigger moves to
         whichever row is active. aria-hidden, because the button's accessible
         name already says the same thing -- and nothing in here is focusable. -->
    <Teleport to="body">
      <div
        v-if="activeRow"
        :key="activeRow.key"
        ref="marksOverlay"
        aria-hidden="true"
        :style="marksPosition"
        class="fixed z-30 box-border w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border border-base-border bg-base-foreground p-2 text-base-content text-left text-xs font-normal normal-case leading-snug shadow-lg"
      >
        <span class="font-medium">{{ activeRow.name }} — {{ activeRow.count }} records</span>
        <span
          v-for="mark in rowMarkLines(activeRow)"
          :key="mark.key"
          class="mt-1 flex items-start gap-2"
        >
          <span class="evidence-dot mt-1 shrink-0" :class="mark.class" />
          <span><span class="font-medium">{{ mark.count }}</span> {{ mark.count === 1 ? 'record' : 'records' }}: {{ mark.reason }}</span>
        </span>
        <span
          v-if="!rowMarkLines(activeRow).length"
          class="mt-1 block text-base-soft"
        >No records classified.</span>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EvidenceLegendInfo from './EvidenceLegendInfo.vue'
import PlantPartIcons from './PlantPartIcons.vue'
import PlantPartInfo from './PlantPartInfo.vue'
import { uniquePlantParts } from './plantPartIcons.js'
import {
  standardBestMark,
  standardMarksLabel,
  standardRowMarkLines
} from './standardEvidence.js'
import { copyTableSelection } from './tableClipboard.js'
import { useAnchoredPopover } from './useAnchoredPopover.js'

const props = defineProps({
  sections: { type: Array, required: true }
})
defineEmits(['show-records'])

const tableRoot = ref(null)
const copySelection = event => copyTableSelection(event, tableRoot.value)
onMounted(() => document.addEventListener('copy', copySelection))
onBeforeUnmount(() => document.removeEventListener('copy', copySelection))
// The dot says how much a record is worth in the field, not which rule let it
// in. Which record earns which colour is the table in evidenceRules.js; the
// wording and the green-orange-red order live in standardEvidence.js, shared
// with the column heading's legend.
function bestMark(row) {
  return standardBestMark(row)
}

function rowMarkLines(row) {
  return standardRowMarkLines(row)
}

function marksLabel(row) {
  return standardMarksLabel(row)
}

// Hover keeps the desktop behaviour the native title used to give; the click
// toggle is what a touch device has. Two flags, because close() must clear both
// -- a tap fires mouseenter as well, and a stuck hover flag would stop the next
// tap from closing.
const openRowKey = ref(null)
const hoverRowKey = ref(null)
const activeRowKey = computed(() => openRowKey.value ?? hoverRowKey.value)

/** Read matchMedia inside the handler: dev:ssr renders without a window. */
function canHover() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(hover: hover)')?.matches === true
}

function toggleMarks(row, event) {
  if (openRowKey.value === row.key) return closeMarks()
  marksTrigger.value = event?.currentTarget || null
  openRowKey.value = row.key
}

function hoverMarks(row, event) {
  if (!canHover()) return
  marksTrigger.value = event?.currentTarget || null
  hoverRowKey.value = row.key
}

function clearHoverMarks() {
  hoverRowKey.value = null
}

function closeMarks() {
  openRowKey.value = null
  hoverRowKey.value = null
}

const allRows = computed(() => props.sections.flatMap(section => section.rows))
const visibleRows = computed(() => allRows.value)
const visibleParts = computed(() => uniquePlantParts(visibleRows.value))
// Resolve through the current rows, so a row that leaves the table (a new page,
// a new taxon) takes its popover with it instead of leaving it hanging off a
// row that is no longer there.
const rowsByKey = computed(() => new Map(visibleRows.value.map(row => [row.key, row])))
const activeRow = computed(() => activeRowKey.value == null
  ? null
  : rowsByKey.value.get(activeRowKey.value) || null)
// Declared after activeRow on purpose: useAnchoredPopover's watch() reads its
// visible source once during setup, which would hit activeRow's temporal dead
// zone if this ran earlier. Records is the rightmost column, hence align 'end'.
const {
  trigger: marksTrigger,
  overlay: marksOverlay,
  position: marksPosition
} = useAnchoredPopover(computed(() => !!activeRow.value), closeMarks, 'end')

/** The dot keeps its column because every row's count reserves the same width.
 *  Reserve only what the widest count in the table actually needs -- a fixed
 *  three digits throws away two digit widths on every row. */
const maxCountDigits = computed(() =>
  Math.max(1, ...visibleRows.value.map(row => String(Number(row.count) || 0).length)))
const visibleSections = computed(() => props.sections.map(section => {
  const rows = visibleRows.value.filter(row => section.rows.includes(row))
  const families = [...new Set(rows.flatMap(row => row.families.length ? row.families : ['']))]
    .sort((a, b) => {
      if (!a && b) return 1
      if (a && !b) return -1
      return a.localeCompare(b)
    })
    .map(name => ({ name, rows: rows.filter(row => name ? row.families.includes(name) : !row.families.length) }))
  return { ...section, rows, families }
}).filter(section => section.rows.length))
</script>

<style scoped>
.standard-association-table {
  width: fit-content;
  max-width: 100%;
  margin-inline: auto;
  overflow-x: auto;
}

.standard-association-table :deep(table) {
  width: auto;
}

.standard-association-table :deep(th),
.standard-association-table :deep(td) {
  padding: 0.45rem 0.75rem;
  vertical-align: middle;
}

.standard-association-table :deep(.standard-direction-heading td) {
  padding-top: 1.25rem;
  padding-bottom: 0.5rem;
  font-weight: 600;
  border: 0;
}

/* A family heading reads at the size of its rows and separates itself by
   weight, spacing and the missing rule -- the same way the direction heading
   above it does. */
.standard-association-table :deep(.standard-family-heading td) {
  padding-top: 0.9rem;
  padding-bottom: 0.35rem;
  text-align: center;
  border: 0;
}

.standard-association-table :deep(.standard-col-taxon) {
  min-width: 1rem;
  max-width: 24rem;
  text-align: center;
}

.standard-association-table :deep(.standard-col-parts) {
  min-width: 1rem;
  max-width: 13rem;
  text-align: right;
}

.standard-association-table :deep(.standard-col-parts > span) {
  justify-content: flex-end;
}

.standard-association-table :deep(.standard-col-records) {
  width: 1%;
  white-space: nowrap;
}

/* 0.75rem, not 0.5rem: the dot is its own tap target now and must not sit a
   thumb-width from the count button, which drills into Raw data. */
.standard-records-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}

/* The visible disc stays 8px; the button is 24px on both axes so the tap target
   meets WCAG 2.5.8 (24x24 CSS px). The count button beside it is 26px tall, so
   the row never grows for this. */
.standard-marks {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}

.standard-marks:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
  border-radius: 0.25rem;
}

/* The count reserves as many digits as the widest count in the table needs
   (--standard-count-digits, set by the component), so the dot column still does
   not move between rows counting 1, 10 or 100 records -- without every row
   holding three digits free. .tp-button is content-box, so this min-width is
   the digit area alone; VButton size="xs" adds px-1.5 and a 1px border around
   it. tabular-nums makes every digit the same width; the 2px cover 1ch (the
   proportional zero) being a hair narrower than a tabular digit. Left aligned,
   so the count and the dot read as one block flush with the column edge. */
.standard-association-table :deep(.standard-records-count) {
  min-width: calc(var(--standard-count-digits, 3) * 1ch + 2px);
  text-align: left;
  font-variant-numeric: tabular-nums;
}

/* Colour comes from a theme token class (text-success/-warning/-danger), so the
   dot and its glow re-tint with the theme in both light and dark mode. The row
   paints only its best category; the popover behind it holds the rest. */
.evidence-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  background: currentColor;
  box-shadow: 0 0 0.3rem currentColor;
}

</style>
