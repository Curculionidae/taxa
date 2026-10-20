<!--
  Curator mode only: "Open in TaxonWorks" button on the taxon page, next to
  the JSON and DwC download buttons. Placed there by the project's layout.js
  in the package's `taxa_page:header:actions:end` region, which renders before
  the OTU is loaded, so `otuId` may still be missing.
-->
<template>
  <ClientOnly>
    <VButton
      v-if="isCuratorMode && otuId"
      class="flex items-center"
      size="sm"
      title="Open this OTU in TaxonWorks"
      @click="open"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        class="w-4 h-4"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          :d="OPEN_PATH"
        />
      </svg>
    </VButton>
  </ClientOnly>
</template>

<script setup>
import { useCuratorMode, twOtuUrl } from './curatorMode.js'
import { OPEN_PATH } from './pencilIcon.js'

const isCuratorMode = useCuratorMode()

const props = defineProps({
  otuId: {
    type: [Number, String],
    default: null
  }
})

function open() {
  window.open(twOtuUrl(props.otuId), '_blank', 'noopener')
}
</script>
