<template>
  <span
    class="relative inline-flex"
    @mouseleave="hovered = false"
  >
    <button
      ref="trigger"
      type="button"
      class="cursor-pointer text-xs font-normal opacity-50 hover:opacity-100 focus:opacity-100"
      aria-label="Show anatomical parts in the current view"
      :aria-expanded="visible"
      :aria-describedby="visible ? helpId : undefined"
      @mouseenter="hovered = true"
      @focus="hovered = true"
      @blur="hovered = false"
      @click.stop="open ? close() : (open = true)"
      @keydown.escape.stop="close"
    >ⓘ</button>

    <Teleport to="body">
    <span
      v-if="visible"
      ref="overlay"
      :id="helpId"
      role="tooltip"
      :style="position"
      class="fixed z-30 box-border w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border border-base-border bg-base-foreground p-2 text-base-content text-left text-xs font-normal normal-case leading-snug shadow-lg"
    >
      <span class="font-medium">Terms in the currently displayed rows:</span>
      {{ parts.join(', ') || 'None' }}
      <span
        v-for="note in notes"
        :key="note"
        class="mt-1 block text-base-soft"
      >{{ note }}</span>
    </span>
    </Teleport>
  </span>
</template>

<script setup>
import { computed, ref, useId } from 'vue'
import { plantPartDisplay } from './plantPartIcons.js'
import { useAnchoredPopover } from './useAnchoredPopover.js'

const props = defineProps({
  parts: { type: Array, required: true }
})

const open = ref(false)
const hovered = ref(false)
const visible = computed(() => open.value || hovered.value)
const helpId = `plant-part-info-${useId()}`
const notes = computed(() => plantPartDisplay(props.parts).notes)
const { trigger, overlay, position } = useAnchoredPopover(visible, close)

function close() {
  open.value = false
  hovered.value = false
}

</script>
