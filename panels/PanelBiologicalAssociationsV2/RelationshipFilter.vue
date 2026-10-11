<template>
  <div class="flex max-w-full items-center gap-2">
    <VButton
      ref="trigger"
      size="sm"
      variant="secondary"
      outline
      aria-haspopup="true"
      :aria-expanded="open"
      @click="open ? close() : (open = true)"
      @keydown.escape="close"
    >
      Relationships ({{ modelValue.length }}/{{ options.length }})
    </VButton>

    <button
      ref="helpTrigger"
      type="button"
      class="cursor-pointer text-xs font-normal opacity-50 hover:opacity-100 focus:opacity-100"
      aria-label="About relationship types"
      :aria-expanded="showHelp"
      :aria-controls="helpId"
      @click="showHelp = !showHelp"
      @keydown.escape.stop="closeHelp"
    >ⓘ</button>

    <Teleport to="body">
    <div
      v-if="showHelp"
      ref="helpOverlay"
      :id="helpId"
      role="region"
      aria-label="About relationship types"
      :style="helpPosition"
      class="fixed z-30 box-border w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border border-base-border bg-base-foreground p-2 text-base-content text-xs font-normal normal-case leading-snug shadow-lg"
    >
      {{ helpText }}
      <p class="mt-2">
        Further information:
        <a
          href="https://curculionidae.github.io/docs/BiologicalRelationships/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-secondary underline"
        >Biological relationships</a>.
      </p>
    </div>

    <div
      v-if="open"
      ref="overlay"
      role="group"
      aria-label="Displayed relationships"
      :style="position"
      class="fixed z-30 box-border w-[min(28rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border border-base-border bg-base-foreground p-1 text-base-content shadow-lg"
      @keydown.escape.stop="close"
    >
      <div class="flex justify-end px-2 py-1">
        <VButton
          size="xs"
          variant="secondary"
          outline
          @click="emit('update:modelValue', selectedRelationshipsForOptions(options))"
        >Reset to default</VButton>
      </div>
      <label
        class="flex cursor-pointer items-center gap-2 rounded border-b border-base-border/60 px-2 py-1.5 text-sm font-medium hover:bg-base-muted"
      >
        <input
          type="checkbox"
          :checked="allSelected"
          :indeterminate="someSelected"
          @change="toggleAll"
        />
        All relationships
      </label>
      <div class="max-h-64 overflow-y-auto">
        <label
          v-for="option in options"
          :key="option"
          class="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-muted"
        >
          <input
            type="checkbox"
            class="mt-0.5 shrink-0"
            :checked="modelValue.includes(option)"
            @change="toggleOption(option)"
          />
          <span>{{ option }}</span>
        </label>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, ref, useId } from 'vue'
import { useAnchoredPopover } from './useAnchoredPopover.js'
import { selectedRelationshipsForOptions } from './relationshipPreferences.js'

const props = defineProps({
  options: {
    type: Array,
    default: () => []
  },
  modelValue: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue'])
const open = ref(false)
const showHelp = ref(false)
const helpId = `relationship-filter-help-${useId()}`
const { trigger, overlay, position } = useAnchoredPopover(open, close, 'end')
const { trigger: helpTrigger, overlay: helpOverlay, position: helpPosition } =
  useAnchoredPopover(showHelp, closeHelp, 'end')
const helpText = 'Choose which relationship types to include. Specific relationships usually provide stronger evidence: "reared from" is strongest, while "collected from" or "undefined relationship with" provide weakest evidence.'

const allSelected = computed(() =>
  props.options.length > 0 && props.modelValue.length === props.options.length
)
const someSelected = computed(() =>
  props.modelValue.length > 0 && !allSelected.value
)

function toggleAll() {
  emit('update:modelValue', allSelected.value ? [] : [...props.options])
}

function toggleOption(option) {
  const selected = props.modelValue.includes(option)
    ? props.modelValue.filter(value => value !== option)
    : [...props.modelValue, option]
  emit('update:modelValue', selected)
}

function close() {
  open.value = false
}

function closeHelp() {
  showHelp.value = false
}
</script>
