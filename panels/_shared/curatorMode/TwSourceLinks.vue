<!--
  Curator mode only: edit a source in TaxonWorks, and, when it has a PDF
  attached, open its TaxonWorks page that lists the PDF. For rows of our own
  source lists (bibliography search and recently published).
-->
<template>
  <span
    v-if="isCuratorMode && sourceId"
    class="inline-flex items-center gap-2"
  >
    <TwEditLink
      :href="twEditUrl.source(sourceId)"
      :icon-class="iconClass"
    />
    <TwEditLink
      v-if="withPdf"
      icon="document"
      :href="twSourcePageUrl(sourceId)"
      :icon-class="iconClass"
      title="PDF: open the source in TaxonWorks, which lists its documents"
    />
  </span>
</template>

<script setup>
import { ref, watch } from 'vue'
import TwEditLink from './TwEditLink.vue'
import { useCuratorMode, twEditUrl, twSourcePageUrl } from './curatorMode.js'
import { hasPdf } from './sourcePdfs.js'

const isCuratorMode = useCuratorMode()

const props = defineProps({
  sourceId: {
    type: [Number, String],
    default: null
  },

  iconClass: {
    type: String,
    default: 'size-4'
  }
})

const withPdf = ref(false)

watch(
  [() => props.sourceId, isCuratorMode],
  ([id, isOn]) => {
    withPdf.value = false
    if (!id || !isOn) return
    hasPdf(id).then((yes) => {
      if (props.sourceId === id) withPdf.value = yes
    })
  },
  { immediate: true }
)
</script>
