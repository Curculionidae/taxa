<!--
  The map of the curator page (CuratorPage.vue): where a record is and where
  the placement put it, as two layers.

  Props
    own       the record's own place: { label, polygons } (the cached outline
              of its area, from public/map-shapes/) or { label, point: [lat, lng] }
              (a specimen's coordinates); null when there is none
    assigned  the outline the placement chose: { label, polygons } (placement.shape,
              or the checklist's fallback outline); null when there is none
    ownKind   colour of a point: 'CollectionObject' or 'FieldOccurrence'

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
    <div
      ref="mapElement"
      class="h-80 w-full rounded-md border border-base-muted sm:h-96"
    />
    <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-base-content">
      <li
        v-if="own"
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
        v-if="assigned"
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
  ownKind: { type: String, default: null }
})

const mapElement = ref(null)
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
  Object.values(tiles)[0]?.addTo(mapObject)
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
