const PACIFIC_ARCHIPELAGOS = new Set(['FJ', 'KI'])
const WRAPPED_SUBDIVISION_COUNTRIES = new Set(['United States', 'Russia'])

// The map can't be panned beyond these longitudes. The west edge sits just east of Australia,
// so only places within the edge strips (east of 156°E or west of 140°W) need repeated copies.
export const MAP_LONGITUDE_LIMITS = { west: -204, east: 220 }
const WEST_STRIP_START = MAP_LONGITUDE_LIMITS.west + 360 + 1
const EAST_STRIP_END = MAP_LONGITUDE_LIMITS.east - 360 - 1.5

function reachesEdgeStrips(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.some((polygon) => polygon.some((ring) => ring.some(([longitude]) => (
    longitude > WEST_STRIP_START || longitude < EAST_STRIP_END
  ))))
}

// Adjacent world copies retain clickable boundaries after Leaflet wraps a pan.
// Focus uses the original geometry, rather than fitting all three world copies.
function wrapFeature(feature, allIslands = false) {
  const geometry = feature.geometry
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const islands = allIslands
    ? polygons.map((polygon) => polygon.map((ring) => ring.map(([longitude, ...rest]) => (
      [longitude < 0 ? longitude + 360 : longitude, ...rest]
    ))))
    : polygons

  let focusBounds
  if (allIslands) {
    let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity
    for (const polygon of islands) {
      for (const ring of polygon) {
        for (const [longitude, latitude] of ring) {
          south = Math.min(south, latitude)
          north = Math.max(north, latitude)
          west = Math.min(west, longitude)
          east = Math.max(east, longitude)
        }
      }
    }
    focusBounds = [[south, west], [north, east]]
  }

  return {
    ...feature,
    checklistFocusGeometry: { type: 'MultiPolygon', coordinates: islands },
    ...(focusBounds ? { checklistFocusBounds: focusBounds } : {}),
    geometry: {
      type: 'MultiPolygon',
      coordinates: [-360, 0, 360].flatMap((offset) => islands.map((polygon) => (
        polygon.map((ring) => ring.map(([longitude, ...rest]) => [longitude + offset, ...rest]))
      )))
    }
  }
}

export function prepareCountryMapData(data) {
  return {
    ...data,
    features: data.features.map((feature) => {
      const code = feature.properties?.['ISO3166-1-Alpha-2']
      return reachesEdgeStrips(feature.geometry)
        ? wrapFeature(feature, PACIFIC_ARCHIPELAGOS.has(code))
        : feature
    })
  }
}

export function prepareSubdivisionMapData(data) {
  return {
    ...data,
    features: data.features.map((feature) => (
      WRAPPED_SUBDIVISION_COUNTRIES.has(feature.properties?.country) ? wrapFeature(feature) : feature
    ))
  }
}

export function wrappedCountryBounds(feature, referenceLongitude, fallbackBounds) {
  const bounds = feature?.checklistFocusBounds || (feature?.checklistFocusGeometry ? fallbackBounds : null)
  if (!bounds) return null
  const [[south, west], [north, east]] = bounds
  const middle = (west + east) / 2
  const candidates = [-360, 0, 360].map((offset) => ({
    offset,
    fits: west + offset >= MAP_LONGITUDE_LIMITS.west && east + offset <= MAP_LONGITUDE_LIMITS.east,
    distance: Math.abs(middle + offset - referenceLongitude)
  }))
  // The original geometry is the canonical copy, so clicking a repeated edge copy
  // (for example New Zealand at the far left) moves to the full place on the other side.
  const original = candidates.find((candidate) => candidate.offset === 0)
  const fitting = candidates.filter((candidate) => candidate.fits)
  const pool = original.fits ? [original] : fitting.length ? fitting : candidates
  const { offset } = pool.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best))
  return [[south, west + offset], [north, east + offset]]
}
