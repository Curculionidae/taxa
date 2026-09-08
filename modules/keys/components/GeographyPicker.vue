<template>
  <div class="relative inline-flex items-stretch text-xs">
    <button
      type="button"
      class="relative z-50 border border-base-muted px-2 py-0.5 text-base-soft hover:text-base-content transition-colors"
      :class="hasSelection ? 'rounded-l' : 'rounded'"
      @click="toggle"
    >
      <span aria-hidden="true">◍ </span>{{ summaryLabel }}
      <span aria-hidden="true">▾</span>
    </button>
    <button
      v-if="hasSelection"
      type="button"
      class="relative z-50 -ml-px rounded-r border border-base-muted px-1.5 py-0.5 text-base-soft hover:text-danger transition-colors"
      aria-label="Clear geography filter"
      title="Clear geography filter"
      @click="clear"
    >&times;</button>

    <template v-if="open">
      <button
        type="button"
        class="fixed inset-0 z-40 cursor-default"
        aria-label="Close geography filter"
        @click="open = false"
      />
      <div
        class="absolute right-0 z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded border border-base-muted bg-base-foreground p-2 text-base-content shadow-lg"
      >
        <p
          v-if="loading"
          class="px-1 py-0.5 text-base-soft"
        >
          Loading distributions…
        </p>

        <template v-if="groupings.length">
          <label
            v-for="g in groupings"
            :key="g.id"
            class="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-base-muted/40"
          >
            <input
              type="checkbox"
              :checked="modelValue.groupings.includes(g.id)"
              @change="toggleGrouping(g.id)"
            />
            <span>{{ g.label }}</span>
          </label>
          <div class="my-1 border-t border-base-muted" />
        </template>

        <input
          ref="filterInputEl"
          v-model="territoryFilter"
          type="text"
          placeholder="Filter countries…"
          aria-label="Filter countries"
          role="combobox"
          aria-expanded="true"
          aria-controls="geo-picker-list"
          autocomplete="off"
          :aria-activedescendant="activeIndex >= 0 ? rowId(activeIndex) : undefined"
          class="mb-1 w-full rounded border border-base-muted bg-base-foreground px-1.5 py-0.5 text-base-content placeholder:text-base-soft"
          @keydown="onFilterKeydown"
        />
        <p
          v-if="!filteredTerritories.length"
          class="px-1 py-0.5 text-base-soft"
        >
          No match.
        </p>

        <div
          id="geo-picker-list"
          ref="listEl"
          role="listbox"
          aria-label="Countries"
        >
          <label
            v-for="(t, idx) in filteredTerritories"
            :id="rowId(idx)"
            :key="t.key"
            role="option"
            :aria-selected="modelValue.territories.includes(t.key)"
            :data-active="idx === activeIndex"
            :class="[
              'flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-base-muted/40',
              { 'bg-base-muted': idx === activeIndex }
            ]"
          >
            <input
              type="checkbox"
              :checked="modelValue.territories.includes(t.key)"
              @change="toggleTerritory(t.key)"
            />
            <span class="flex-1">{{ t.label }}</span>
          </label>
        </div>

        <div
          v-if="hasSelection"
          class="mt-1 border-t border-base-muted pt-1"
        >
          <button
            type="button"
            class="rounded px-1 py-0.5 text-secondary hover:underline"
            @click="clear"
          >
            Clear
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { territoryLabel } from '../lib/geoNormalize.js'

const props = defineProps({
  // { groupings: string[], territories: string[] }
  modelValue: {
    type: Object,
    default: () => ({ groupings: [], territories: [] })
  },
  // [{ id, label, members }]
  groupings: { type: Array, default: () => [] },
  // [{ key, label }]
  territories: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
})
// `open` fires the first time the menu is opened, so the parent can lazily start
// fetching the distribution data.
const emit = defineEmits(['update:modelValue', 'open'])

const open = ref(false)
function toggle() {
  open.value = !open.value
  if (open.value) emit('open')
}

// I7: case-insensitive substring filter over the (long, ~190 entry) country list.
const territoryFilter = ref('')
const filteredTerritories = computed(() => {
  const q = territoryFilter.value.trim().toLowerCase()
  if (!q) return props.territories
  return props.territories.filter((t) =>
    String(t.label || '').toLowerCase().includes(q)
  )
})

// Keyboard navigation of the filtered country list (arrow keys + Enter),
// modelled on CollectionDatabase's custom-dropdown pattern. activeIndex -1 means
// nothing is highlighted yet.
const filterInputEl = ref(null)
const listEl = ref(null)
const activeIndex = ref(-1)
function rowId(i) {
  return `geo-picker-opt-${i}`
}

// Focus the filter box when the menu opens so the arrow keys work right away;
// drop the highlight when it closes.
watch(open, (isOpen) => {
  if (isOpen) nextTick(() => filterInputEl.value?.focus())
  else activeIndex.value = -1
})
// Any change to the filter text invalidates the highlighted row.
watch(territoryFilter, () => {
  activeIndex.value = -1
})
// Keep the highlighted row visible inside the scrolling menu.
watch(activeIndex, (i) => {
  if (i < 0) return
  nextTick(() => {
    listEl.value
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  })
})

function moveActive(delta) {
  const n = filteredTerritories.value.length
  if (!n) {
    activeIndex.value = -1
    return
  }
  const cur = activeIndex.value
  activeIndex.value =
    cur < 0 ? (delta > 0 ? 0 : n - 1) : (cur + delta + n) % n
}

function onFilterKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveActive(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveActive(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const list = filteredTerritories.value
    const t =
      activeIndex.value >= 0
        ? list[activeIndex.value]
        : list.length === 1
          ? list[0]
          : null
    if (t) toggleTerritory(t.key)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    open.value = false
  }
}

const hasSelection = computed(
  () =>
    props.modelValue.groupings.length > 0 ||
    props.modelValue.territories.length > 0
)

const summaryLabel = computed(() => {
  const gLabels = props.modelValue.groupings
    .map((id) => props.groupings.find((g) => g.id === id)?.label)
    .filter(Boolean)
  const tLabels = props.modelValue.territories
    .map((k) => props.territories.find((t) => t.key === k)?.label || territoryLabel(k))
  const all = [...gLabels, ...tLabels]
  if (!all.length) return 'Areas'
  if (all.length <= 2) return all.join(', ')
  return `${all[0]} + ${all.length - 1}`
})

function emitNext(next) {
  emit('update:modelValue', next)
}

function toggleGrouping(id) {
  const set = new Set(props.modelValue.groupings)
  set.has(id) ? set.delete(id) : set.add(id)
  emitNext({ ...props.modelValue, groupings: [...set] })
}

function toggleTerritory(key) {
  const set = new Set(props.modelValue.territories)
  set.has(key) ? set.delete(key) : set.add(key)
  emitNext({ ...props.modelValue, territories: [...set] })
}

function clear() {
  emitNext({ groupings: [], territories: [] })
}
</script>
