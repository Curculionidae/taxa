<!--
  The map of the curator page (CuratorPage.vue): where a record is and where
  the placement put it, as two layers.

  Props
    own       the record's own place: { label, polygons } (the cached outline
              of its area, from public/map-shapes/) or { label, point: [lat, lng] }
              (a specimen's coordinates); null when there is none
    assigned  the outline the placement chose: { label, polygons } (placement.shape,
              or the checklist's fallback outline); null when there is none
              or both (a georeference shape with its inside point)
    ownKind   colour of a point: 'CollectionObject' or 'FieldOccurrence'
    loading   a lookup is running: the map keeps its place and shows a spinner
              over it, and the legend says so; the spinner also stays until
              the background tiles have loaded ("Loading the map…")

  Colours are the taxon pages' map tokens (--tp-map-asserted for an area,
  --tp-map-collection-object / --tp-map-field-occurrence for a point,
  --tp-map-aggregate for the assigned outline), read with getComputedStyle,
  since Leaflet needs literal colour strings; the legend uses the matching
  bg-map-* utilities. Leaflet is loaded the way ChecklistMap.vue loads it
  (dynamic import, tiles from the site configuration, so dark mode filters
  the tiles as on every other map). The view fits both layers. The layers
  are redrawn in the new colours when the theme changes (dark class on <html>).
-->
<template>
  <div class="flex flex-col gap-2">
    <div class="relative h-80 w-full sm:h-96">
      <div
        ref="mapElement"
        class="size-full rounded-md border border-base-muted"
        :aria-busy="loading"
      />
      <!-- Over the map (above Leaflet's panes and controls), not the package
           VSpinner, which positions itself by measuring and lands beside it. -->
      <div
        v-if="loading || tilesLoading"
        class="absolute inset-0 z-[1001] flex flex-col items-center justify-center gap-3 rounded-md bg-base-foreground/75 text-base-content"
        role="status"
      >
        <span
          class="size-10 animate-spin rounded-full border-4 border-base-muted border-t-secondary"
          aria-hidden="true"
        />
        <span class="text-sm font-medium">{{ loading ? 'Placing the record…' : 'Loading the map…' }}</span>
      </div>
    </div>
    <!-- min-h keeps one legend line reserved, so the box does not grow when it fills. -->
    <ul class="flex min-h-5 flex-wrap gap-x-4 gap-y-1 text-sm text-base-content">
      <li
        v-if="loading"
        class="text-base-soft"
      >
        Loading the map layers…
      </li>
      <li
        v-if="own && !loading"
        class="flex items-center gap-2"
      >
        <span
          class="inline-block size-3 shrink-0 rounded-full"
          :class="ownSwatch"
          aria-hidden="true"
        />
        {{ own.label }}
      </li>
      <li
        v-if="assigned && !loading"
        class="flex items-center gap-2"
      >
        <span
          class="bg-map-aggregate inline-block size-3 shrink-0 rounded-sm"
          aria-hidden="true"
        />
        {{ assigned.label }}
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { makeTileFromConfiguration } from '@/components/Map/utils/makeTileFromConfiguration'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  own: { type: Object, default: null },
  assigned: { type: Object, default: null },
  ownKind: { type: String, default: null },
  loading: { type: Boolean, default: false }
})

const mapElement = ref(null)
// Leaflet's tile layer is fetching tiles (its loading and load events).
const tilesLoading = ref(true)
let leaflet
let mapObject
let layerGroup
let disposed = false
let themeObserver = null

const POINT_TOKEN = { CollectionObject: '--tp-map-collection-object', FieldOccurrence: '--tp-map-field-occurrence' }

const ownSwatch = computed(() => {
  if (!props.own?.point) return 'bg-map-asserted'
  return props.ownKind === 'FieldOccurrence' ? 'bg-map-field-occurrence' : 'bg-map-collection-object'
})

function cssVar(name) {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// GeoJSON geometry of a list of polygons.
const multiPolygon = (polygons) => ({ type: 'MultiPolygon', coordinates: polygons })

// fit: move the view to the layers (not when only the theme changed).
function draw({ fit = true } = {}) {
  if (!mapObject || disposed) return
  layerGroup?.remove()
  layerGroup = leaflet.featureGroup().addTo(mapObject)
  if (props.assigned?.polygons?.length) {
    const color = cssVar('--tp-map-aggregate')
    leaflet.geoJSON(multiPolygon(props.assigned.polygons), {
      style: { color, weight: 2, fillColor: color, fillOpacity: 0.2 }
    }).addTo(layerGroup)
  }
  if (props.own?.polygons?.length) {
    const color = cssVar('--tp-map-asserted')
    leaflet.geoJSON(multiPolygon(props.own.polygons), {
      style: { color, weight: 2, fillColor: color, fillOpacity: 0.45 }
    }).addTo(layerGroup)
  }
  if (props.own?.point) {
    const color = cssVar(POINT_TOKEN[props.ownKind] || POINT_TOKEN.CollectionObject)
    leaflet.circleMarker(props.own.point, {
      radius: 7, color: cssVar('--tp-base-foreground'), weight: 2, fillColor: color, fillOpacity: 1
    }).addTo(layerGroup)
  }
  if (!fit) return
  const bounds = layerGroup.getBounds()
  if (bounds.isValid()) mapObject.fitBounds(bounds, { padding: [20, 20], maxZoom: 9 })
  else mapObject.setView([15, 0], 1)
}

onMounted(async () => {
  const { default: L } = await import('leaflet')
  if (disposed) return
  leaflet = L
  mapObject = L.map(mapElement.value, { center: [15, 0], zoom: 1, worldCopyJump: true, zoomSnap: 0, maxZoom: 18 })
  mapObject.attributionControl.setPrefix(false)
  const tiles = makeTileFromConfiguration(L, { maxZoom: 18, minZoom: 0, className: 'map-tiles' })
  const tileLayer = Object.values(tiles)[0]
  if (tileLayer) {
    tileLayer.on('loading', () => { tilesLoading.value = true })
    tileLayer.on('load', () => { tilesLoading.value = false })
    tileLayer.addTo(mapObject)
  } else {
    tilesLoading.value = false
  }
  draw()
  // Leaflet holds literal colours, so redraw when the dark-mode class flips.
  themeObserver = new MutationObserver(() => draw({ fit: false }))
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
})

watch(() => [props.own, props.assigned], () => draw())

onBeforeUnmount(() => {
  disposed = true
  themeObserver?.disconnect()
  mapObject?.remove()
  mapObject = undefined
})
</script>
