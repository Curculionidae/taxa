import { DISABLE_LAYER_OPTIONS } from '@/components/Map/constants'
import geojsonDefaultOptions from '@/components/Map/utils/geojsonOptions'
import { computed, ref, unref } from 'vue'
import {
  featureTypeMaterialKind,
  featureIsAdventive,
  featureIsAbsent,
  enrichedPolygonStyleDelta,
  enrichedMarkerIconOptions,
  ADVENTIVE_HATCH_CLASS
} from './enrichedStyle.js'

const asArray = (base) => (Array.isArray(base) ? base : [base])

export function makeGeojsonOptions({ popupElement, popupItem, adventiveAdIds, typeStatusByCoId }) {
  return function (args) {
    const { L } = args
    const defaults = geojsonDefaultOptions(args)
    const kindOf = (f) => featureTypeMaterialKind(f, unref(typeStatusByCoId))

    return {
      style: (feature) => {
        const base = defaults.style(feature)
        // Absence wins outright: an adventive tag on the disputed presence
        // record must not repaint a corrected/absent shape back to purple.
        if (featureIsAbsent(feature)) return base
        const kind = kindOf(feature)
        const adventive = !kind && featureIsAdventive(feature, unref(adventiveAdIds))
        const delta = enrichedPolygonStyleDelta(kind, adventive)
        if (!delta) return base

        const next = { ...base, ...delta }
        if (adventive) {
          next.className = `${base.className || ''} ${ADVENTIVE_HATCH_CLASS}`.trim()
        }
        return next
      },

      pointToLayer: (feature, latLng) => {
        const kind = kindOf(feature)
        // stamp the resolved kind so the cluster pie (Mixed.js) can colour it
        if (feature.properties) feature.properties.typeMaterialKind = kind || undefined

        const iconOptions = enrichedMarkerIconOptions(kind)
        if (!iconOptions) return defaults.pointToLayer(feature, latLng)

        const marker = L.marker(latLng, {
          icon: L.divIcon(iconOptions),
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
