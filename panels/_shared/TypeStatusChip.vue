<template>
  <div
    v-if="labels.length"
    class="flex flex-col gap-1"
  >
    <div
      v-for="label in labels"
      :key="label"
    >
      <span
        class="inline-block max-w-full break-words text-xs font-medium rounded px-1.5 py-0.5 [&_em]:italic"
        :style="typeLabelStyle(label)"
        v-html="typeStatusHtml(label)"
      />
    </div>
  </div>
</template>

<script setup>
// The type-status chip: "holotype of <em>Aus bus</em> Author, 1900" on a red
// label for a name-bearing type, a yellow one for other type material
// (paratype, ...), after the pinned-label convention.
//
// `status` may be one status or a whole DwC `typeStatus` cell (" | "-joined):
// every status gets a chip of its own, coloured and italicised on its own.
// Nothing is rendered for an empty one. Spacing is the caller's: pass a
// margin class.
//
// Each chip is an inline-block on purpose: a clickable row that underlines
// itself on hover (the map popup) then leaves the label alone.
//
// Depended on by:
//   - ./DwcTable.vue (identity block)
//   - ../PanelSpecimenOccurrences/components/ListRecords.vue (list rows)
//   - ../PanelMapV2/components/MapPopup.vue (specimen and type material rows)
import { computed } from 'vue'
import './panel-tokens.css'
import { typeLabelStyle, typeStatusLabels } from './typeStatus.js'
import { typeStatusHtml } from './scientificName.js'

const props = defineProps({
  // "holotype of Aus bus Author, 1900", or several joined by " | ".
  status: {
    type: String,
    default: ''
  }
})

const labels = computed(() => [...new Set(typeStatusLabels(props.status))])
</script>
