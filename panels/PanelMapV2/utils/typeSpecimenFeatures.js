// Pure helpers that put type specimens the geojson lacks onto the map (see
// ../../_shared/typeMaterialSpecimen.js for why it lacks them).
//
// No Vue, no leaflet, no '@/' imports here on purpose: `node --test` covers it.

import { asArray } from '../composables/enrichedStyle.js'

const COLLECTION_OBJECT = 'CollectionObject'
const TYPE_MATERIAL = 'TypeMaterial'

// "1 2 0, 3 4 0" -> [[1, 2], [3, 4]]  (any Z / M ordinate dropped)
function positions(text) {
  return text
    .split(',')
    .map((p) => p.trim().split(/\s+/).slice(0, 2).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
}

// "(a), (b)" -> ["a", "b"], splitting on top-level parentheses only
function groups(text) {
  const out = []
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') {
      if (depth === 0) start = i + 1
      depth += 1
    } else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) out.push(text.slice(start, i))
    }
  }
  return out
}

/**
 * GeoJSON geometry for a DwC `footprintWKT` value. Handles POINT, POLYGON and
 * MULTIPOLYGON (with or without Z), which is what TaxonWorks writes for a
 * georeference; anything else, or anything malformed, is null.
 * @param {string} wkt
 * @returns {{ type: string, coordinates: Array }|null}
 */
export function wktToGeometry(wkt) {
  const m = /^\s*(POINT|POLYGON|MULTIPOLYGON)\s*(?:ZM|Z|M)?\s*\(([\s\S]*)\)\s*$/i.exec(String(wkt || ''))
  if (!m) return null
  const kind = m[1].toUpperCase()
  const body = m[2]

  if (kind === 'POINT') {
    const [p] = positions(body)
    return p ? { type: 'Point', coordinates: p } : null
  }

  const polygon = (text) => groups(text).map(positions).filter((ring) => ring.length >= 4)

  if (kind === 'POLYGON') {
    const rings = polygon(body)
    return rings.length ? { type: 'Polygon', coordinates: rings } : null
  }

  const polygons = groups(body).map(polygon).filter((rings) => rings.length)
  return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null
}

/**
 * The type specimens (from `fetchTypeSpecimens`) the map does not show yet:
 * neither as a CollectionObject entry nor through one of their TypeMaterial
 * records.
 * @param {object[]} features   store features (base is an array)
 * @param {object[]} specimens
 * @returns {object[]}
 */
export function specimensNotOnMap(features, specimens) {
  const coIds = new Set()
  const typeMaterialIds = new Set()
  for (const f of features || []) {
    for (const b of asArray(f?.properties?.base)) {
      if (b?.type === COLLECTION_OBJECT) coIds.add(b.id)
      if (b?.type === TYPE_MATERIAL) typeMaterialIds.add(b.id)
    }
  }
  return (specimens || []).filter(
    (s) =>
      !coIds.has(s.collectionObjectId) &&
      !s.typeMaterials.some((tm) => typeMaterialIds.has(tm.id))
  )
}

/**
 * Where a specimen was collected, from its DwC record: the georeference shape
 * (`footprintWKT`, a point or an uncertainty polygon) or, when that is absent or
 * not a form wktToGeometry reads, the plain coordinates. Null when the record
 * has neither - a specimen located only by geographic area cannot be drawn
 * (TaxonWorks has no public route for an area's shape).
 * @param {object} dwc
 * @returns {{ type: string, coordinates: Array }|null}
 */
export function specimenGeometry(dwc) {
  const fromFootprint = wktToGeometry(dwc?.footprintWKT)
  if (fromFootprint) return fromFootprint

  if (dwc?.decimalLatitude == null || dwc?.decimalLongitude == null) return null
  const lat = Number(dwc.decimalLatitude)
  const lng = Number(dwc.decimalLongitude)
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? { type: 'Point', coordinates: [lng, lat] }
    : null
}

/**
 * Map features for type specimens, from `{ collectionObjectId, geometry }`
 * placements (placements without a geometry are skipped). Specimens sharing
 * exactly one geometry become one feature, hence one marker and one popup with
 * a row each, like removeDuplicateShapes does for the server's features.
 * Each base entry is a CollectionObject flagged `undetermined`, so the popup
 * shows no identified name; its type status comes from `typeStatusByCoId`.
 * @returns {object[]}
 */
export function buildTypeSpecimenFeatures(placements, target) {
  const byGeometry = new Map()

  for (const p of placements || []) {
    if (!p.geometry) continue
    const key = JSON.stringify(p.geometry)
    if (!byGeometry.has(key)) {
      byGeometry.set(key, {
        type: 'Feature',
        geometry: p.geometry,
        properties: {
          base: [],
          target: [],
          shape: { type: 'TypeSpecimen', id: p.collectionObjectId }
        }
      })
    }
    const { properties } = byGeometry.get(key)
    properties.base.push({
      type: COLLECTION_OBJECT,
      id: p.collectionObjectId,
      label: `CollectionObject ${p.collectionObjectId}`,
      undetermined: true
    })
    properties.target.push(target)
  }

  return [...byGeometry.values()]
}
