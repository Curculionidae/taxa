<template>
  <span>{{ display.toLocaleString() }}</span>
</template>

<script setup>
// Counts up from 0 to `number` once, on mount. A new `number` (the live
// figure replacing the built-in one) does not start a second count:
// - still counting: the target moves and the count carries on along the same
//   curve, so there is no pause and no restart;
// - already done: the shown number stays. Any change after the count has
//   finished would read as a break, so a late figure is left for the
//   caller to use next time (ProjectStatsStrip remembers it).
// Never counts backward: a figure below what is shown mid-count settles.
// With reduced motion there is no count, and a new figure just replaces it.
// Adapted from sfg-taxonpages/orthoptera pages/components/AnimateNumber.vue.
//
// `display` is seeded with `number` rather than 0 so a server render (dev:ssr)
// and the first client render agree, no hydration mismatch. The sweep up from
// 0 is a client-only flourish kicked off in onMounted, after hydration.

import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  number: { type: Number, default: 0 },
  duration: { type: Number, default: 1600 }
})

const display = ref(props.number)

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// The running count: from `from` to `to` over `length` ms, started at `t0`.
let run = null
let raf = null

function easeOut(p) {
  return 1 - Math.pow(1 - p, 3)
}

function step(ts) {
  if (run.t0 === null) run.t0 = ts

  const p = Math.min((ts - run.t0) / run.length, 1)

  display.value = Math.round(run.from + (run.to - run.from) * easeOut(p))

  if (p < 1) {
    raf = requestAnimationFrame(step)
  } else {
    display.value = run.to
    run = null
    raf = null
  }
}

function start(from, to, length) {
  if (raf) cancelAnimationFrame(raf)

  run = { from, to, length, t0: null }
  raf = requestAnimationFrame(step)
}

onMounted(() => {
  if (prefersReducedMotion || typeof requestAnimationFrame === 'undefined') return

  display.value = 0
  start(0, props.number, props.duration)
})

watch(
  () => props.number,
  (to) => {
    const settle = () => {
      if (raf) cancelAnimationFrame(raf)
      run = null
      raf = null
      display.value = to
    }

    if (prefersReducedMotion || typeof requestAnimationFrame === 'undefined') {
      settle()
    } else if (run) {
      // Still counting: same start and timing, new end point. Below what is
      // already shown it would tick back, so it settles instead.
      if (to >= display.value) run.to = to
      else settle()
    }
    // Count finished: the shown number stays.
  }
)

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
})
</script>
