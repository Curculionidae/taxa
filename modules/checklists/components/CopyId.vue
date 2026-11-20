<!--
  A small copy button beside a record id on the curator page (R43): copies
  the id as text ("AD 669847") to the clipboard and says "Copied" for a
  moment. When the clipboard is not available (no permission, no secure
  context), a small read-only field with the id appears, selected, ready for
  Ctrl+C, and the button says "Selected". The id itself is never rendered a
  second time (no hidden copy of it), so it is read and seen once. The click
  does not reach the table row (no lookup).

  Props
    text  what to copy, e.g. 'AD 669847'
-->
<template>
  <span class="ml-1 inline-flex items-center gap-1 align-middle">
    <button
      type="button"
      class="rounded p-0.5 text-base-soft hover:text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="`Copy ${text}`"
      :title="`Copy ${text}`"
      @click.stop="copy"
      @keydown.enter.stop
    >
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect
          x="9"
          y="9"
          width="13"
          height="13"
          rx="2"
        />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
    <input
      v-if="manual"
      ref="field"
      class="w-28 rounded border border-base-border bg-base-foreground px-1 font-mono text-xs text-base-content"
      readonly
      :value="text"
      :aria-label="`${text}, selected for copying`"
      @click.stop
      @keydown.enter.stop
      @blur="manual = false"
    >
    <span
      v-if="feedback"
      class="text-xs text-base-content"
      role="status"
    >{{ feedback }}</span>
  </span>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  text: { type: String, required: true }
})

const field = ref(null)
const manual = ref(false)
const feedback = ref('')
let timer = null

function show(message) {
  feedback.value = message
  clearTimeout(timer)
  timer = setTimeout(() => { feedback.value = '' }, 1500)
}

// Show the id in a read-only field, selected, so it can be copied by hand.
async function selectText() {
  manual.value = true
  await nextTick()
  field.value?.focus()
  field.value?.select()
  show('Selected')
}

function copy() {
  // writeText is called inside the click handler, so the browser counts it as a user action.
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
  if (!clipboard?.writeText) { selectText(); return }
  clipboard.writeText(props.text).then(() => show('Copied'), selectText)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>
