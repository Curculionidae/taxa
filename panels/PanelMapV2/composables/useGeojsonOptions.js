import { DISABLE_LAYER_OPTIONS } from '@/components/Map/constants'
import geojsonDefaultOptions from '@/components/Map/utils/geojsonOptions'
import { computed, ref, unref } from 'vue'

// An AssertedDistribution polygon tagged "Adventive" is drawn with the SVG hatch
// pattern injected by addAdventivePattern() (PanelMapV2.vue) instead of a solid
// fill. Everything else keeps the package's default per-type styling.
function isAdventiveFeature(feature, adventiveAdIds) {
  if (!adventiveAdIds || !adventiveAdIds.size) return false
  const base = feature?.properties?.base
  return (Array.isArray(base) ? base : [base]).some(
    (b) => b?.type === 'AssertedDistribution' && adventiveAdIds.has(b.id)
  )
}

export function makeGeojsonOptions({ popupElement, popupItem, adventiveAdIds }) {
  return function (args) {
    const defaults = geojsonDefaultOptions(args)

    return {
      style: (feature) => {
        const base = defaults.style(feature)
        if (!isAdventiveFeature(feature, unref(adventiveAdIds))) return base
        return {
          ...base,
          color: 'var(--pp-map-adventive)',
          className: `${base.className || ''} leaflet-adventive-hatch`.trim(),
          fillOpacity: 1
        }
      },

      onEachFeature: (feature, layer) => {
        layer.pm.setOptions(DISABLE_LAYER_OPTIONS)
        layer.pm.disable()

        if (feature.properties.base.some(({ label }) => Boolean(label))) {
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

export function useGeojsonOptions({ popupElement, adventiveAdIds }) {
  const popupItem = ref(null)

  const geojsonOptions = computed(() =>
    makeGeojsonOptions({ popupElement, popupItem, adventiveAdIds })
  )

  return {
    geojsonOptions,
    popupItem
  }
}
