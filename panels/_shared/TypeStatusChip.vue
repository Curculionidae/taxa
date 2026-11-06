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
      >
        <template v-if="otuIdByLabel[label]"><span v-html="typeStatusHtmlParts(label).prefix" /><RouterLink
          :to="{ name: 'otus-id', params: { id: otuIdByLabel[label] } }"
          class="underline underline-offset-2 hover:no-underline"
          :style="{ color: 'inherit' }"
          @click="emit('navigate')"
        ><span v-html="typeStatusHtmlParts(label).name" /></RouterLink></template>
        <span
          v-else
          v-html="typeStatusHtml(label)"
        />
      </span>
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
// `linkNames` links the name in each chip to that name's OTU page (found by
// ./typeNameOtu.js; a name it can't pin down stays plain). Off by default: the
// map popup and the specimen list rows are themselves clickable. A click on
// the link emits `navigate`, so the caller can close its modal. The link keeps
// the chip's ink (the global `a` colour would be unreadable on the chip).
//
// Each chip is an inline-block on purpose: a clickable row that underlines
// itself on hover (the map popup) then leaves the label alone.
//
// Depended on by:
//   - ./DwcTable.vue (identity block, with `linkNames`)
//   - ../PanelSpecimenOccurrences/components/ListRecords.vue (list rows)
//   - ../PanelMapV2/components/MapPopup.vue (specimen and type material rows)
import { computed, onMounted, reactive, watch } from 'vue'
import './panel-tokens.css'
import { typeLabelStyle, typeStatusLabels } from './typeStatus.js'
import { typeStatusHtml, typeStatusHtmlParts } from './scientificName.js'
import { findTypeNameOtuId } from './typeNameOtu.js'

const props = defineProps({
  // "holotype of Aus bus Author, 1900", or several joined by " | ".
  status: {
    type: String,
    default: ''
  },
  linkNames: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['navigate'])

const labels = computed(() => [...new Set(typeStatusLabels(props.status))])

// label -> OTU id, filled in as the lookups come back. Browser only (looked
// up from onMounted): server-rendered, the chips are plain and the lookups
// don't fill a cache shared by every visitor.
const otuIdByLabel = reactive({})

function lookUpLinks() {
  if (!props.linkNames) return
  for (const label of labels.value) {
    if (label in otuIdByLabel) continue
    otuIdByLabel[label] = null
    findTypeNameOtuId(label).then((id) => {
      otuIdByLabel[label] = id
    })
  }
}

onMounted(() => {
  lookUpLinks()
  watch(labels, lookUpLinks)
})
</script>
