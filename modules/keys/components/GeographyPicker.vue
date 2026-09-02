<template>
  <div
    v-if="loading || territories.length"
    class="relative inline-block text-xs"
  >
    <button
      type="button"
      class="border border-base-muted rounded px-2 py-0.5 text-base-soft hover:text-base-content transition-colors"
      :disabled="loading && !territories.length"
      @click="open = !open"
    >
      <span aria-hidden="true">◍ </span>{{ summaryLabel }}
      <span
        v-if="!loading"
        aria-hidden="true"
      >▾</span>
    </button>

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

        <label
          v-for="t in territories"
          :key="t.key"
          class="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-base-muted/40"
        >
          <input
            type="checkbox"
            :checked="modelValue.territories.includes(t.key)"
            @change="toggleTerritory(t.key)"
          />
          <span class="flex-1">{{ t.label }}</span>
          <span class="text-base-soft">{{ t.otuCount }}</span>
        </label>

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
import { ref, computed } from 'vue'

const props = defineProps({
  // { groupings: string[], territories: string[] }
  modelValue: {
    type: Object,
    default: () => ({ groupings: [], territories: [] })
  },
  // [{ id, label, members }]
  groupings: { type: Array, default: () => [] },
  // [{ key, label, otuCount }]
  territories: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)

const hasSelection = computed(
  () =>
    props.modelValue.groupings.length > 0 ||
    props.modelValue.territories.length > 0
)

const summaryLabel = computed(() => {
  if (props.loading && !props.territories.length) return 'distributions…'
  const gLabels = props.modelValue.groupings
    .map((id) => props.groupings.find((g) => g.id === id)?.label)
    .filter(Boolean)
  const tLabels = props.modelValue.territories
    .map((k) => props.territories.find((t) => t.key === k)?.label || k)
  const all = [...gLabels, ...tLabels]
  if (!all.length) return 'All areas'
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
