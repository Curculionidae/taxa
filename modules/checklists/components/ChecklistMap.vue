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

// World view: the zoom (fractional, zoomSnap is 0) and centre at which one
// world copy, from Tierra del Fuego to the Arctic islands, fits the map in
// both width and height. Web Mercator: the world is 256px wide at zoom 0.
const WORLD_VIEW_LATITUDES = { south: -56, north: 76 }
function mercatorY(lat) {
  const rad = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2
}
function worldView() {
  const width = mapElement.value?.clientWidth || 0
  const height = mapElement.value?.clientHeight || 0
  const north = mercatorY(WORLD_VIEW_LATITUDES.north)
  const south = mercatorY(WORLD_VIEW_LATITUDES.south)
  const middle = (north + south) / 2
  const centerLat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * middle))) * 180) / Math.PI
  if (!width || !height) return { center: [centerLat, 0], zoom: props.zoom }
  const zoom = Math.min(Math.log2(width / 256), Math.log2(height / (256 * (south - north))))
  return { center: [centerLat, 0], zoom }
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
    ...worldView(),
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
  // Links on the checklists page open in a new tab, the map credit too (its
  // HTML comes from the map configuration, so the target is set on click).
  L.DomEvent.on(mapObject.attributionControl.getContainer(), 'click', (event) => {
    const link = event.target.closest?.('a[href]')
    if (link) Object.assign(link, { target: '_blank', rel: 'noopener' })
  })

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

defineExpose({ getMapObject: () => mapObject, getWorldView: worldView })
</script>
