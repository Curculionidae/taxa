<template>
  <VCard>
    <div class="relative">
      <Teleport to="body">
        <VModal
          v-if="activeCitation"
          @close="activeCitation = null"
        >
          <template #header>
            <div class="text-sm font-medium">Reference</div>
          </template>
          <div
            class="px-4 pb-4 text-sm leading-relaxed"
            v-html="linkify(activeCitation.full)"
          />
        </VModal>
      </Teleport>
      <ClientOnly>
        <VSpinner v-if="isLoading" />
        <VMap
          class="h-96 max-h-96"
          dragging
          :cluster="cluster"
          :zoom="zoom"
          :zoom-bounds="8"
          :geojson="store.distribution.geojson"
          :cluster-icon-create-function="makeClusterIconFor"
          :geojson-options="geojsonOptions"
          @geojson:ready="onGeojsonReady"
        />
        <div ref="popupElement">
          <MapPopup
            v-if="popupItem"
            :items="popupItem.base"
            :targets="popupItem.target"
            :tags-by-ad-id="store.tagsByAdId"
            @selected="dwcTableRef.show"
            @citation-selected="activeCitation = $event"
          />
        </div>
        <VButton
          class="h-6 text-sm absolute right-3 top-3 z-[400]"
          primary
          @click="() => (isOtuSearchVisible = true)"
        >
          Search
        </VButton>

        <OtuSearch
          v-if="isOtuSearchVisible"
          :otu="otu"
          :shapes="store.distribution.geojson"
          @close="() => (isOtuSearchVisible = false)"
        />

        <CachedMap
          v-if="store.distribution.cachedMap"
          :cached-map="store.distribution.cachedMap"
        />
      </ClientOnly>
    </div>
    <div
      v-if="store.distribution.errorMessage"
      class="flex flex-row p-2 text-xs italic"
    >
      * {{ store.distribution.errorMessage }}
    </div>
    <div
      class="flex flex-row p-2 gap-2 text-xs"
      v-if="store.distribution.currentShapeTypes.length"
    >
      <div
        v-for="type in store.distribution.currentShapeTypes"
        :key="type"
        class="flex flex-row items-center"
      >
        <div
          :class="['w-3', 'h-3', 'm-1', 'rounded-sm', LEGEND[type].background]"
          :style="LEGEND[type].style"
        />
        <span>{{ LEGEND[type].label }}</span>
      </div>
    </div>
    <DwcTable ref="dwcTableRef" />
  </VCard>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

function linkify(html) {
  if (!html) return ''
  return html.replace(
    /(?<!href=["'])(?<!">)(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-secondary hover:underline">$1</a>'
  )
}
import './map-tokens.css'
import { useDistributionStore } from './store/useDistributionStore.js'
import { makeClusterIconFor } from './clusters'
import { useGeojsonOptions } from './composables/useGeojsonOptions.js'
import { LEGEND } from './constants'
import MapPopup from './components/MapPopup.vue'
import CachedMap from './components/CachedMap.vue'
import OtuSearch from './components/Search/OtuSearch.vue'
import DwcTable from '../_shared/DwcTable.vue'

const props = defineProps({
  otuId: {
    type: [String, Number],
    required: true
  },

  otu: {
    type: Object,
    required: true
  },

  taxon: {
    type: Object,
    required: true
  },

  cluster: {
    type: Boolean,
    default: true
  }
})

const zoom = 2
const isLoading = ref(true)
const activeCitation = ref(null)
const isOtuSearchVisible = ref(false)
const dwcTableRef = ref(null)
const store = useDistributionStore()
const popupElement = ref(null)
const { popupItem, geojsonOptions } = useGeojsonOptions({
  popupElement,
  adventiveAdIds: computed(() => store.adventiveAdIds)
})

// A second SVG hatch pattern (the package's addPatternToMap only makes the
// "asserted absent" one): purple diagonal lines over a faint purple wash, so an
// adventive polygon stays legible over an overlapping solid native one. Adventive
// AD polygons carry `leaflet-adventive-hatch`, styled to `fill: url(#adventive-hatch)`
// below. `url(#id)` resolves document-wide, so one definition on <body> serves
// every map on the page.
function addAdventivePattern() {
  if (typeof document === 'undefined' || document.getElementById('adventive-hatch')) return
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  const p = document.createElementNS(NS, 'pattern')
  p.setAttribute('id', 'adventive-hatch')
  p.setAttribute('patternUnits', 'userSpaceOnUse')
  p.setAttribute('width', '8')
  p.setAttribute('height', '8')
  p.setAttribute('patternTransform', 'rotate(45)')
  const bg = document.createElementNS(NS, 'rect')
  bg.setAttribute('width', '8')
  bg.setAttribute('height', '8')
  bg.setAttribute('fill', 'var(--pp-map-adventive)')
  bg.setAttribute('fill-opacity', '0.2')
  const line = document.createElementNS(NS, 'line')
  line.setAttribute('x1', '0')
  line.setAttribute('y1', '0')
  line.setAttribute('x2', '0')
  line.setAttribute('y2', '8')
  line.setAttribute('stroke', 'var(--pp-map-adventive)')
  line.setAttribute('stroke-width', '3')
  p.appendChild(bg)
  p.appendChild(line)
  const defs = document.createElementNS(NS, 'defs')
  defs.appendChild(p)
  svg.appendChild(defs)
  document.body.appendChild(svg)
}

function onGeojsonReady() {
  isLoading.value = false
  addAdventivePattern()
}

onMounted(() => {
  isLoading.value = true

  store.loadDistribution({
    otuId: props.otuId,
    rankString: props.taxon.rank_string
  })
})

onBeforeUnmount(() => {
  store.resetRequest()
  store.$reset()
})
</script>

<style>
/* Adventive-tagged asserted-distribution polygons: hatched instead of solid.
   Unscoped: the target is a Leaflet-generated <path>. */
.leaflet-adventive-hatch {
  fill: url(#adventive-hatch) !important;
}
</style>
