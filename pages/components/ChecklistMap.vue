<template>
  <div ref="mapElement" />
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { makeTileFromConfiguration } from '@/components/Map/utils/makeTileFromConfiguration'
import { MAP_LONGITUDE_LIMITS } from '../data/mapWrapping.js'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  geojson: { type: Object, required: true },
  geojsonOptions: { type: Function, default: () => ({}) },
  center: { type: Array, default: () => [15, 0] },
  zoom: { type: Number, default: 2 },
  dragging: { type: Boolean, default: true }
})

const emit = defineEmits(['geojson:ready'])
const mapElement = ref(null)
let leaflet
let mapObject
let boundaryLayer
let resizeObserver
let disposed = false

// Smallest zoom at which one world copy fills the map width (256px world at zoom 0).
function worldZoom() {
  const width = mapElement.value?.clientWidth || 0
  return Math.max(props.zoom, width ? Math.ceil(Math.log2(width / 256)) : props.zoom)
}

async function renderBoundaries() {
  if (!mapObject || disposed) return
  boundaryLayer?.remove()
  const layer = leaflet.geoJSON(
    props.geojson,
    props.geojsonOptions({ L: leaflet, mapObject })
  ).addTo(mapObject)
  boundaryLayer = layer
  // Wait until the parent can access getMapObject() through its component ref.
  await nextTick()
  if (!disposed && boundaryLayer === layer) emit('geojson:ready', layer)
}

onMounted(async () => {
  const { default: L } = await import('leaflet')
  if (disposed) return
  leaflet = L
  mapObject = L.map(mapElement.value, {
    center: props.center,
    zoom: worldZoom(),
    dragging: props.dragging,
    worldCopyJump: true,
    // Beyond these longitudes only the repeated US/Russia boundaries exist; other countries would be blank.
    maxBounds: [[-85, MAP_LONGITUDE_LIMITS.west], [85, MAP_LONGITUDE_LIMITS.east]],
    maxBoundsViscosity: 1,
    // Fractional zoom lets country fits fill the map; Leaflet's stop() would otherwise snap them to whole levels.
    zoomSnap: 0,
    maxZoom: 18
  })
  mapObject.attributionControl.setPrefix(false)

  const tiles = makeTileFromConfiguration(L, {
    maxZoom: 18,
    minZoom: 0,
    className: 'map-tiles'
  })
  const [initialTile] = Object.values(tiles)
  initialTile?.addTo(mapObject)
  if (Object.keys(tiles).length > 1) {
    L.control.layers(tiles, {}, { position: 'topleft', collapsed: false }).addTo(mapObject)
  }

  // Resizing updates the canvas without fitting all country boundaries again.
  // Leaflet's default non-animated pan keeps the geographic center in place.
  resizeObserver = new ResizeObserver(() => {
    mapObject?.invalidateSize({ animate: false, debounceMoveend: true })
  })
  resizeObserver.observe(mapElement.value)
  await renderBoundaries()
})

watch(() => props.geojson, renderBoundaries)
watch(() => props.dragging, (enabled) => {
  if (mapObject) mapObject.dragging[enabled ? 'enable' : 'disable']()
})

onBeforeUnmount(() => {
  disposed = true
  resizeObserver?.disconnect()
  mapObject?.remove()
  mapObject = undefined
})

defineExpose({ getMapObject: () => mapObject, getWorldZoom: worldZoom })
</script>
