// Point tests on outlines, shared by the Node geometry (scripts/geometry-node.mjs,
// used by the cache build) and the browser geometry (geometry-browser.js, used
// by the curator page).
//
// Purpose: one implementation of everything that decides a point question, so
// the curator page answers exactly as the build did: point in polygon, the
// distance to a coast, the coastal tolerance, R22 (an own checklist wins over
// the country it is filed under), the order in which checklists, states and
// parts are tried, and which outline stands for a checklist. The two
// geometries differ only in how they get the outlines (files read from disk,
// or files fetched by URL).
//
// Input:  GeoJSON geometries (Polygon, MultiPolygon, or a GeometryCollection
//         holding them) and `targets`, plain objects { name, polygons, of?, id? }
//         that stand for a checklist, a state or a part. The coastal tolerance
//         comes from the rules file (coastal_tolerance_degrees, toleranceOf).
// Output: booleans, distances and the hits of a point; see each function.
// Pure:   no network, no file system, no Node-only APIs. preparedTarget keeps
//         a WeakMap cache keyed by the target object, nothing else is kept.
//
// Point tests: ray casting on every ring, holes excluded, after a bounding box
// test of the outline and of each of its polygons. A point outside every
// outline but within the coastal tolerance of one (rules file
// coastal_tolerance_degrees, 0.05 degrees, about 5 km) counts for the nearest
// outline, unless a second one is nearly as close (less than half the
// tolerance further): coasts are simplified, so coastal points often miss them
// by a few hundred metres. The answers say whether a point was inside
// (contained) or only near, so the engine can say which.
//
// R22: a point inside an own checklist (rules file `checklists` entry with
// `of`, Réunion) and inside the checklist it is filed under (France, whose
// outline still contains Réunion) counts for the own checklist only.
import { normalizeName } from './areas.js'
import { findByName } from './checklists.js'

/**
 * The coastal tolerance in degrees from the rules file
 * (coastal_tolerance_degrees); 0 (no tolerance) when the file gives none.
 * @param {import('./rules.js').CompiledRules|null} rules
 * @returns {number}
 */
export function toleranceOf(rules) {
  return rules?.coastalTolerance?.degrees ?? 0
}

/**
 * @typedef {Array<Array<[number, number]>>} Polygon  outer ring, then holes
 * @typedef {{ name: string, polygons: Polygon[], of?: string, id?: number|string }} Target
 *   an outline that stands for a checklist, state or part; `of` names the target it is
 *   filed under (R22)
 * @typedef {{ parts: { rings: Polygon, box: number[] }[], box: number[] }} Prepared
 *   polygons with their bounding boxes [west, south, east, north]
 * @typedef {{ target: Target, shape: Prepared }} Entry  a target with its prepared outline
 */

/**
 * The polygons of a GeoJSON geometry. A GeometryCollection gives the polygons
 * of its members (GZ 3614 New Guinea: a Polygon and a LineString).
 * @param {{ type: string, coordinates?: any, geometries?: any[] } | null} geometry
 * @returns {Polygon[]}  [] for points and lines
 */
export function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates]
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates
  if (geometry?.type === 'GeometryCollection') return (geometry.geometries ?? []).flatMap(polygonsOf)
  return []
}

/**
 * Polygons with their bounding boxes, for fast point tests.
 * @param {Polygon[]} polygons
 * @returns {Prepared}
 */
export function prepared(polygons) {
  const parts = polygons.filter((polygon) => polygon?.[0]?.length).map((rings) => ({ rings, box: boxOf(rings[0]) }))
  const box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const part of parts) {
    box[0] = Math.min(box[0], part.box[0]); box[1] = Math.min(box[1], part.box[1])
    box[2] = Math.max(box[2], part.box[2]); box[3] = Math.max(box[3], part.box[3])
  }
  return { parts, box }
}

const preparedCache = new WeakMap()

/**
 * The prepared outline of a target, made once per target object.
 * @param {Target} target
 * @returns {Prepared}
 */
export function preparedTarget(target) {
  if (!preparedCache.has(target)) preparedCache.set(target, prepared(target.polygons))
  return preparedCache.get(target)
}

/**
 * Targets with their prepared outlines.
 * @param {Target[]} targets
 * @returns {Entry[]}
 */
export function entriesOf(targets) {
  return targets.map((target) => ({ target, shape: preparedTarget(target) }))
}

/**
 * Bounding box of a ring.
 * @param {Array<[number, number]>} ring
 * @returns {number[]}  [west, south, east, north]
 */
export function boxOf(ring) {
  const box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [lng, lat] of ring) {
    if (lng < box[0]) box[0] = lng
    if (lat < box[1]) box[1] = lat
    if (lng > box[2]) box[2] = lng
    if (lat > box[3]) box[3] = lat
  }
  return box
}

/**
 * Does the box, widened by `margin` degrees, hold the point?
 * @param {number[]} box  [west, south, east, north]
 * @param {[number, number]} point  [lng, lat]
 * @param {number} [margin]
 * @returns {boolean}
 */
export function inBox(box, [lng, lat], margin = 0) {
  return lng >= box[0] - margin && lng <= box[2] + margin && lat >= box[1] - margin && lat <= box[3] + margin
}

function inRing(ring, lng, lat) {
  let inside = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [x1, y1] = ring[a]
    const [x2, y2] = ring[b]
    if ((y1 > lat) !== (y2 > lat) && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside
  }
  return inside
}

/**
 * Is the point inside the prepared outline (holes excluded)?
 * @param {Prepared} shape
 * @param {[number, number]} point  [lng, lat]
 * @returns {boolean}
 */
export function contains(shape, point) {
  if (!inBox(shape.box, point)) return false
  const [lng, lat] = point
  return shape.parts.some(({ rings: [outer, ...holes], box }) =>
    inBox(box, point) && inRing(outer, lng, lat) && !holes.some((hole) => inRing(hole, lng, lat)))
}

/**
 * Distance in degrees from a point to the edges of a prepared outline, only
 * for polygons whose box widened by `limit` holds the point; else Infinity.
 * @param {Prepared} shape
 * @param {[number, number]} point
 * @param {number} limit
 * @returns {number}
 */
export function distanceTo(shape, point, limit) {
  if (!inBox(shape.box, point, limit)) return Infinity
  const [lng, lat] = point
  let best = Infinity
  for (const { rings, box } of shape.parts) {
    if (!inBox(box, point, limit)) continue
    for (const ring of rings) {
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [x1, y1] = ring[b]
        const [x2, y2] = ring[a]
        const dx = x2 - x1
        const dy = y2 - y1
        const t = dx || dy ? Math.max(0, Math.min(1, ((lng - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy))) : 0
        best = Math.min(best, Math.hypot(lng - (x1 + t * dx), lat - (y1 + t * dy)))
      }
    }
  }
  return best
}

/**
 * The entries within `limit` of a point: the nearest alone, or the two nearest
 * when the second is nearly as close (less than limit / 2 further). R22 is
 * applied to every close outline first (an `of` country drops out when its own
 * checklist is close too), so France, whose outline still holds French
 * Guiana, never pushes Suriname out of the two nearest.
 * @param {Entry[]} entries
 * @param {[number, number]} point
 * @param {number} limit
 * @returns {Entry[]}
 */
export function nearest(entries, point, limit) {
  const within = entries
    .map((entry) => ({ entry, distance: distanceTo(entry.shape, point, limit) }))
    .filter(({ distance }) => distance <= limit)
  const kept = new Set(ownOverOf(within.map(({ entry }) => entry.target)))
  const close = within.filter(({ entry }) => kept.has(entry.target)).sort((a, b) => a.distance - b.distance)
  if (!close.length) return []
  if (close.length > 1 && close[1].distance - close[0].distance < limit / 2) return [close[0].entry, close[1].entry]
  return [close[0].entry]
}

/**
 * The nearest entry within `tolerance` when it is unambiguous, else undefined.
 * @param {Entry[]} entries
 * @param {[number, number]} point
 * @param {number} tolerance  degrees
 * @returns {Entry|undefined}
 */
export function onlyNearest(entries, point, tolerance) {
  if (!(tolerance > 0)) return undefined
  const hits = nearest(entries, point, tolerance)
  return hits.length === 1 ? hits[0] : undefined
}

/**
 * R22: drop a target when an own checklist filed under it is also hit.
 * @param {Target[]} hits
 * @returns {Target[]}
 */
export function ownOverOf(hits) {
  if (hits.length < 2) return hits
  const covered = new Set(hits.filter((target) => target.of).map((target) => normalizeName(target.of)))
  return covered.size ? hits.filter((target) => !covered.has(normalizeName(target.name))) : hits
}

/**
 * The `of` country of every own checklist of the rules file, by normalized
 * name (Réunion -> France).
 * @param {import('./rules.js').CompiledRules|null} rules
 * @returns {Map<string, string>}
 */
export function ofByName(rules) {
  const map = new Map()
  for (const entry of rules?.checklists ?? []) if (entry.of) map.set(normalizeName(entry.name), entry.of)
  return map
}

/**
 * The ids of the checklists that hold a point: every outline that contains
 * it, else the nearest within `tolerance` (one, or two nearly as close); R22
 * applied. `near` is true when no outline contains the point and the ids come
 * from the tolerance.
 * @param {Entry[]} entries  checklist outlines in checklist order, target.id set
 * @param {[number, number]} point
 * @param {number} tolerance  degrees (toleranceOf)
 * @returns {{ ids: Array<number|string>, near: boolean }}
 */
export function checklistsAtPoint(entries, point, tolerance) {
  let hits = entries.filter(({ shape }) => contains(shape, point))
  const near = !hits.length && tolerance > 0
  if (near) hits = nearest(entries, point, tolerance)
  return { ids: ownOverOf(hits.map(({ target }) => target)).map((target) => target.id), near: near && hits.length > 0 }
}

/**
 * The state whose outline holds a point, else the only state within
 * `tolerance` (near: true), else null.
 * @param {Entry[]} entries  the states of one checklist
 * @param {[number, number]} point
 * @param {number} tolerance  degrees (toleranceOf)
 * @returns {{ name: string, near: boolean } | null}
 */
export function stateAtPoint(entries, point, tolerance) {
  const inside = entries.find(({ shape }) => contains(shape, point))
  if (inside) return { name: inside.target.name, near: false }
  const close = onlyNearest(entries, point, tolerance)
  return close ? { name: close.target.name, near: true } : null
}

/**
 * The state targets of a checklist: the subdivisions features of its country.
 * @param {Array<{ properties: { country: string, name: string, aliases?: string[] }, geometry: object }>} features
 *   subdivisions.geojson features
 * @param {import('./checklists.js').Checklist|undefined} checklist
 * @returns {Array<Target & { aliases: string[] }>}  [] for a checklist without `states`
 */
export function stateTargetsOf(features, checklist) {
  if (!checklist?.states) return []
  return features
    .filter((feature) => normalizeName(feature.properties.country) === normalizeName(checklist.name))
    .map((feature) => ({ name: feature.properties.name, aliases: feature.properties.aliases ?? [], polygons: polygonsOf(feature.geometry) }))
}

/**
 * The GA id whose cached outline stands for a part: its first GA area with one.
 * @param {{ areas: string[] }} part  a rules file part
 * @param {(key: string) => boolean} isCached  is 'GeographicArea/<id>' cached?
 * @returns {string|undefined}
 */
export function partOutlineId(part, isCached) {
  return part.areas.filter((key) => key.startsWith('GA ')).map((key) => key.slice(3))
    .find((areaId) => isCached(`GeographicArea/${areaId}`))
}

/**
 * The part whose outline holds a point (by 'outline'), else whose `box` from
 * the rules file holds it (by 'box'), else null.
 * @param {Array<{ name: string, shape: Prepared|null, box: number[]|null }>} parts  in rules file order
 * @param {[number, number]} point
 * @returns {{ name: string, by: 'outline'|'box' } | null}
 */
export function partAtPoint(parts, point) {
  const inOutline = parts.find((part) => part.shape && contains(part.shape, point))
  if (inOutline) return { name: inOutline.name, by: 'outline' }
  const inBoxOf = parts.find((part) => part.box && inBox(part.box, point))
  return inBoxOf ? { name: inBoxOf.name, by: 'box' } : null
}

/**
 * The outline that stands for a checklist: 'GeographicArea/<id>' of its first
 * area with a cached outline, else 'fallback/<feature name>', the Natural
 * Earth outline named like the checklist or a synonym of it
 * (fallback-shapes.geojson), else null. A rules file entry with
 * `outline: natural_earth` takes the Natural Earth outline even when an area
 * outline is cached (Norfolk Island: the TDWG outline of GA 33700 also covers
 * Lord Howe Island); `ref` then cites that line.
 * @param {{ id: number|string, name: string, areaIds: number[] }} checklist
 * @param {Object} input
 * @param {import('./rules.js').CompiledRules|null} input.rules
 * @param {(key: string) => boolean} input.isCached  is 'GeographicArea/<id>' cached (with polygons)?
 * @param {Map<string, string>} input.fallbackNames  fallback feature name by normalizeName(name)
 * @returns {{ key: string|null, fallback: string|null, ref: string|null }}
 *   fallback: the feature name when the key is a fallback one
 */
export function checklistOutline(checklist, { rules, isCached, fallbackNames }) {
  const entry = (rules?.checklists ?? []).find((candidate) => normalizeName(candidate.name) === normalizeName(checklist.name))
  const fallback = findByName(fallbackNames, checklist.name, rules) ?? null
  if (entry?.outline === 'natural_earth') {
    return { key: fallback ? `fallback/${fallback}` : null, fallback, ref: entry.outlineRef ?? entry.ref }
  }
  const id = checklist.areaIds.find((areaId) => isCached(`GeographicArea/${areaId}`))
  if (id != null) return { key: `GeographicArea/${id}`, fallback: null, ref: null }
  return { key: fallback ? `fallback/${fallback}` : null, fallback, ref: null }
}
