<!--
  Shared "Reference" detail modal — presentational only. Shows a citation's
  full source (sanitized + linkified), falling back to the short
  citation_source_body when `extend[]=source` wasn't requested / matched.

  Deliberately prop/emit, not defineExpose show()/state-owning: each caller
  keeps its own `activeCitation` ref because callers differ in what else
  that state needs to drive (e.g. ImageLightbox's own keyboard-capture logic
  checks it too, and its VModal must stay a direct, non-teleported child —
  see ImageLightbox.vue for why). This component only owns the markup.

  Depended on by (relative import paths from panels/_shared/):
    - ./ImageLightbox.vue   — clicking an image citation
    - ./DwcTable.vue        — clicking a type material citation

  If you change this file, sanity-check both call sites.
-->
<template>
  <VModal
    v-if="citation"
    aria-label="Reference"
    @close="emit('close')"
  >
    <template #header>
      <div class="text-sm font-medium">Reference</div>
    </template>
    <div
      class="px-4 pb-4 text-sm leading-relaxed [&_a]:text-secondary [&_a]:hover:underline"
      v-html="sanitizeAndLinkifyHtml(citation.source?.cached || citation.citation_source_body || '')"
    />
  </VModal>
</template>

<script setup>
import { sanitizeAndLinkifyHtml } from '@/utils'

defineProps({
  citation: { type: Object, default: null }
})

const emit = defineEmits(['close'])
</script>
