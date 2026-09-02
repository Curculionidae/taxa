import { makeSegmentedCircle } from '../utils/makeSegmentedCircle.js'
import {
  COLLECTION_OBJECT,
  FIELD_OCCURRENCE,
  TYPE_MATERIAL
} from '@/constants/objectTypes'

const OTHER_TYPE_MATERIAL = 'OtherTypeMaterial'

// The type-material kind stamped on a feature by useGeojsonOptions.pointToLayer
// overrides its raw base types: a paratype etc. shows yellow, a DwC-confirmed
// primary type shows as TypeMaterial even if the geojson called it a plain CO.
function markerTypes(l) {
  const kind = l.feature?.properties?.typeMaterialKind
  if (kind === 'other') return [OTHER_TYPE_MATERIAL]
  if (kind === 'primary') return [TYPE_MATERIAL]
  return (l.feature?.properties?.base || []).map((item) => item.type)
}

export function Mixed(cluster) {
  const sliceColor = {
    [FIELD_OCCURRENCE]: 'fill-map-field-occurrence',
    [COLLECTION_OBJECT]: 'fill-map-collection-object',
    [TYPE_MATERIAL]: 'fill-map-type-material',
    [OTHER_TYPE_MATERIAL]: 'pp-fill-map-other-type'
  }

  const markers = cluster.getAllChildMarkers()
  const types = markers.map(markerTypes)
  const uniqueTypes = [...new Set(types.flat())]
  const segments = uniqueTypes.map((type) => ({
    class: sliceColor[type]
  }))

  const circle = makeSegmentedCircle({
    attributes: {
      class: 'absolute opacity-50 w-[40px] h-[40px]'
    },
    segments
  })

  const innerCircle = makeSegmentedCircle({
    attributes: {
      class: 'absolute w-[30px] h-[30px] mt-[5px] ml-[5px]'
    },
    segments
  })

  return {
    html: [
      circle,
      innerCircle,
      `<span class="absolute text-xs top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary-content  z-[200]">
        ${cluster.getChildCount()}
      </span>
      `
    ].join(''),
    className: 'leaflet-marker-icon leaflet-zoom-animated leaflet-interactive',
    iconSize: [40, 40]
  }
}
