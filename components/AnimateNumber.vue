<template>
  <span>{{ display.toLocaleString() }}</span>
</template>

<script setup>
// Counts from wherever it currently sits toward `number`, re-running whenever
// `number` changes (a seeded estimate first, then the real figure). Only ever
// counts upward: a lower target settles instantly rather than ticking back.
// Adapted from sfg-taxonpages/orthoptera pages/components/AnimateNumber.vue.

import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  number: { type: Number, default: 0 },
  duration: { type: Number, default: 1600 }
})

const display = ref(0)
let raf = null

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

watch(
  () => props.number,
  (to, prev) => {
    if (to !== prev) animate(to)
  },
  { immediate: true }
)

function animate(to) {
  if (raf) cancelAnimationFrame(raf)
  const from = display.value
  if (to <= from || prefersReducedMotion || typeof requestAnimationFrame === 'undefined') {
    display.value = to
    return
  }
  let t0 = null
  const step = (ts) => {
    if (t0 === null) t0 = ts
    const p = Math.min((ts - t0) / props.duration, 1)
    const eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
    display.value = Math.round(from + (to - from) * eased)
    if (p < 1) raf = requestAnimationFrame(step)
    else display.value = to
  }
  raf = requestAnimationFrame(step)
}

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
})
</script>
