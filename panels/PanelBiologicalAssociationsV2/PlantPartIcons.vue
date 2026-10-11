<template>
  <span
    v-if="display.originals.length"
    class="flex flex-wrap items-center justify-center gap-1"
    :aria-label="accessibleLabel"
    :data-copy-text="parts.join(', ')"
  >
    <img
      v-for="icon in display.icons"
      :key="icon.key"
      :src="icon.src"
      alt=""
      aria-hidden="true"
      :title="icon.title"
      width="24"
      height="24"
      class="h-6 w-6 object-contain"
    />
    <span
      v-for="term in display.fallback"
      :key="term"
      class="text-sm"
    >{{ term }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { plantPartDisplay } from './plantPartIcons.js'

const props = defineProps({
  parts: { type: Array, required: true }
})

const display = computed(() => plantPartDisplay(props.parts))
const accessibleLabel = computed(() => {
  const groups = display.value.icons.map(icon => icon.label)
  const visible = [...groups, ...display.value.fallback]
  return `Anatomical parts: ${visible.join(', ')}`
})
</script>
