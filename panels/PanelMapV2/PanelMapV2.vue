<template>
  <VCard>
    <div class="relative">
      <Teleport to="body">
        <ReferenceModal
          :citation="activeCitation"
          @close="activeCitation = null"
        />
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
            :type-status-by-co-id="store.typeStatusByCoId"
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import './map-tokens.css'
import { useDistributionStore } from './store/useDistributionStore.js'
import { makeClusterIconFor } from './clusters'
import { useGeojsonOptions } from './composables/useGeojsonOptions.js'
import { restyleEnriched } from './composables/enrichedStyle.js'
import { LEGEND } from './constants'
import MapPopup from './components/MapPopup.vue'
import CachedMap from './components/CachedMap.vue'
import OtuSearch from './components/Search/OtuSearch.vue'
import DwcTable from '../_shared/DwcTable.vue'
import ReferenceModal from '../_shared/ReferenceModal.vue'

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
// the L.geoJSON layer group VMap hands back on @geojson:ready — kept so the
// async enrichment can restyle its layers in place instead of the store
// re-emitting the geojson (which makes VMap rebuild every layer + cluster pie).
const geoLayerGroup = ref(null)
const { popupItem, geojsonOptions } = useGeojsonOptions({
  popupElement,
  adventiveAdIds: computed(() => store.adventiveAdIds),
  typeStatusByCoId: computed(() => store.typeStatusByCoId)
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

let geojsonBuilds = 0

function onGeojsonReady(group) {
  isLoading.value = false
  geoLayerGroup.value = group
  addAdventivePattern()

  if (import.meta.env.DEV) {
    geojsonBuilds += 1
    console.debug(`[PanelMapV2] L.geoJSON build #${geojsonBuilds}`)
  }
}

// Restyle the already-drawn layers once the tag / type-status enrichment lands,
// in place — no geojson re-emit, so VMap keeps the layer group it already built.
async function applyEnrichedStyles() {
  const group = geoLayerGroup.value
  if (!group) return
  if (!store.adventiveAdIds.size && !store.typeStatusByCoId.size) return

  const { default: L } = await import('leaflet')
  const t0 = import.meta.env.DEV ? performance.now() : 0
  const changed = restyleEnriched(group, {
    L,
    adventiveAdIds: store.adventiveAdIds,
    typeStatusByCoId: store.typeStatusByCoId
  })
  if (import.meta.env.DEV) {
    console.debug(
      `[PanelMapV2] restyled ${changed} layer(s) in ${(performance.now() - t0).toFixed(1)}ms (no rebuild)`
    )
  }
}

watch(
  () => [store.adventiveAdIds, store.typeStatusByCoId, geoLayerGroup.value],
  applyEnrichedStyles
)

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
/* Unscoped: the targets are Leaflet-generated <path> / marker elements. */
.leaflet-adventive-hatch {
  fill: url(#adventive-hatch) !important;
}
.pp-map-other-type-marker {
  background: var(--pp-map-other-type);
}
.pp-fill-map-other-type {
  fill: var(--pp-map-other-type);
}
</style>
