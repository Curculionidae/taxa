<template>
  <VButton ref="trigger" :size="compact ? 'xs' : 'sm'" variant="secondary" outline
    :class="{ 'advanced-outline advanced-filter': compact }"
    :data-active="active" :aria-pressed="compact ? active : undefined"
    :aria-label="label" :aria-expanded="open" :aria-controls="menuId" aria-haspopup="true" :disabled="disabled"
    @click="open = !open" @keydown.escape="close">
    {{ compact ? 'Filter' : label }}
  </VButton>
  <Teleport to="body">
    <div v-if="open" ref="overlay" :id="menuId" role="group" :aria-label="label"
      :style="position"
      class="fixed z-30 box-border w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border border-base-border bg-base-foreground p-2 text-base-content text-sm font-normal normal-case shadow-lg">
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="font-medium">{{ label }}</span>
        <VButton size="xs" variant="secondary" outline @click="reset">Reset to default</VButton>
      </div>
      <InputText v-if="searchable" v-model="search" class="mb-2 w-full"
        :aria-label="`Search ${label}`" placeholder="Search terms…" />
      <label class="mb-1 flex cursor-pointer items-center gap-2 border-b border-base-border py-1.5">
        <input type="checkbox" :checked="allSelected" :indeterminate="someSelected" @change="toggleAll" />
        {{ search ? 'All matching terms' : 'Select all' }}
      </label>
      <div class="max-h-64 overflow-y-auto">
        <label v-for="option in displayed" :key="option.value"
          class="flex cursor-pointer items-start gap-2 rounded px-1 py-1.5 hover:bg-base-muted">
          <input type="checkbox" class="mt-0.5 shrink-0" :checked="draft.includes(option.value)"
            @change="toggle(option.value)" />
          <span>{{ option.label || '(Blank)' }}</span>
        </label>
        <p v-if="!displayed.length" class="py-2 opacity-60">No matching terms.</p>
      </div>
      <div class="mt-2 flex justify-end gap-2 border-t border-base-border pt-2">
        <VButton size="xs" variant="secondary" ghost @click="close">Cancel</VButton>
        <VButton size="xs" variant="secondary" :disabled="requiredSelection && !draft.length" @click="apply">Apply</VButton>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, useId, watch } from 'vue'
import { useAnchoredPopover } from './useAnchoredPopover.js'

const props = defineProps({
  label: { type: String, required: true },
  options: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
  compact: Boolean, active: Boolean, disabled: Boolean, requiredSelection: Boolean,
  searchable: { type: Boolean, default: true }
})
const emit = defineEmits(['update:modelValue', 'reset'])
const open = ref(false)
const search = ref('')
const draft = ref([])
watch(open, value => {
  if (value) {
    draft.value = [...props.modelValue]
    search.value = ''
  }
})
const menuId = `association-selection-${useId()}`
// A draft selection must survive a wheel tick: keep the menu anchored while
// the table scrolls instead of dismissing it (Apply/Cancel/Escape/outside click).
const { trigger, overlay, position } = useAnchoredPopover(open, close, 'end', false)
const displayed = computed(() => props.options.filter(option =>
  (option.label || '(Blank)').toLowerCase().includes(search.value.trim().toLowerCase())))
const allSelected = computed(() => displayed.value.length > 0
  && displayed.value.every(option => draft.value.includes(option.value)))
const someSelected = computed(() => !allSelected.value
  && displayed.value.some(option => draft.value.includes(option.value)))
function toggle(value) {
  draft.value = draft.value.includes(value)
    ? draft.value.filter(item => item !== value) : [...draft.value, value]
}
function toggleAll() {
  const matching = new Set(displayed.value.map(option => option.value))
  draft.value = allSelected.value ? draft.value.filter(value => !matching.has(value))
    : [...new Set([...draft.value, ...matching])]
}
function apply() { emit('update:modelValue', [...draft.value]); close() }
function reset() { emit('reset'); close() }
function close() { open.value = false; search.value = '' }
</script>
