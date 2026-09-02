import { DISABLE_LAYER_OPTIONS } from '@/components/Map/constants'
import geojsonDefaultOptions from '@/components/Map/utils/geojsonOptions'
import * as Shape from '@/components/Map/shapes'
import { computed, ref, unref } from 'vue'

const asArray = (base) => (Array.isArray(base) ? base : [base])

// An AssertedDistribution polygon tagged "Adventive" is drawn with the SVG hatch
// pattern injected in PanelMapV2.vue.
function isAdventiveFeature(feature, adventiveAdIds) {
  if (!adventiveAdIds || !adventiveAdIds.size) return false
  return asArray(feature?.properties?.base).some(
    (b) => b?.type === 'AssertedDistribution' && adventiveAdIds.has(b.id)
  )
}

// 'primary' | 'other' | null — the strongest type-material status among the
// feature's CollectionObject bases, from the store's DwC-derived map.
function typeMaterialKind(feature, typeStatusByCoId) {
  if (!typeStatusByCoId || !typeStatusByCoId.size) return null
  let kind = null
  for (const b of asArray(feature?.properties?.base)) {
    if (b?.type !== 'CollectionObject') continue
    const k = typeStatusByCoId.get(b.id)
    if (k === 'primary') return 'primary'
    if (k === 'other') kind = 'other'
  }
  return kind
}

export function makeGeojsonOptions({ popupElement, popupItem, adventiveAdIds, typeStatusByCoId }) {
  return function (args) {
    const { L } = args
    const defaults = geojsonDefaultOptions(args)
    const kindOf = (f) => typeMaterialKind(f, unref(typeStatusByCoId))

    return {
      style: (feature) => {
        const base = defaults.style(feature)
        const kind = kindOf(feature)
        if (kind === 'other') {
          return {
            ...base,
            color: 'var(--pp-map-other-type)',
            fillOpacity: 'var(--tp-map-shape-opacity)'
          }
        }
        if (kind === 'primary') return { ...base, ...Shape.TypeMaterial }
        if (isAdventiveFeature(feature, unref(adventiveAdIds))) {
          return {
            ...base,
            color: 'var(--pp-map-adventive)',
            className: `${base.className || ''} leaflet-adventive-hatch`.trim(),
            fillOpacity: 1
          }
        }
        return base
      },

      pointToLayer: (feature, latLng) => {
        const kind = kindOf(feature)
        if (!kind) return defaults.pointToLayer(feature, latLng)
        const className =
          kind === 'other'
            ? 'pp-map-other-type-marker map-point-marker rounded-full'
            : 'bg-map-type-material map-point-marker rounded-full'
        const marker = L.marker(latLng, {
          icon: L.divIcon({ className, iconSize: [8, 8], iconAnchor: [4, 4] }),
          zIndexOffset: kind === 'primary' ? 6000 : 3000
        })
        marker.pm?.setOptions?.(DISABLE_LAYER_OPTIONS)
        return marker
      },

      onEachFeature: (feature, layer) => {
        layer.pm.setOptions(DISABLE_LAYER_OPTIONS)
        layer.pm.disable()

        if (asArray(feature.properties.base).some(({ label }) => Boolean(label))) {
          layer.on('popupopen', () => (popupItem.value = feature.properties))
          layer.on('popupclose', () => (popupItem.value = null))

          layer.bindPopup(popupElement.value, {
            minWidth: 400,
            maxWidth: 400
          })
        }
      }
    }
  }
}

export function useGeojsonOptions({ popupElement, adventiveAdIds, typeStatusByCoId }) {
  const popupItem = ref(null)

  const geojsonOptions = computed(() =>
    makeGeojsonOptions({ popupElement, popupItem, adventiveAdIds, typeStatusByCoId })
  )

  return {
    geojsonOptions,
    popupItem
  }
}
