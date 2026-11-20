// Outline lookups for the placement engine in Node, and overlap measuring.
//
// Purpose: the placement engine (placement/engine.js) is pure and asks an
// injected Geometry every question that needs outlines. This module is that
// Geometry for Node: the cache build and the measuring script use it. It reads
// the cached outlines from disk, once each, and answers point questions
// (which checklist, state or part holds a point). measureShares, used by the
// measuring script (measure-overlap.mjs), says how an area's outline is shared
// among target outlines (countries, or the states of one country).
//
// Inputs
//   shapeDir          public/map-shapes/: GeographicArea/<id>.json and
//                     Gazetteer/<id>.json, GeoJSON geometry objects (Polygon or
//                     MultiPolygon), the same files the species maps draw
//   fallbackFile      public/checklists/fallback-shapes.geojson: Natural Earth
//                     outlines by properties.name, for countries with no cached
//                     outline (Spain, used in TaxonWorks only through its provinces)
//   subdivisionsFile  public/checklists/subdivisions.geojson: state and province
//                     outlines, properties.country and properties.name
//   checklists        from placement/checklists.js (deriveChecklists)
//   rules             the compiled rules file (placement/rules.js), for parts
//                     and for the `of` country of own checklists
// Outputs: a Geometry as engine.js describes it (checklistsAt, stateAt, partAt,
//   stateNames), plus checklistTargets, stateTargets and areaPolygons for
//   measuring; measureShares; listShapes.
//
// Which outline stands for what
//   checklist  the first of its areaIds with a cached GeographicArea/<id>.json,
//              else the fallback outline with the checklist's name, else none
//   part       the first of its GA areas with a cached outline, else its `box`
//   state      the subdivisions feature with that country and name
//
// Point tests: ray casting on every ring, holes excluded, after a bounding box
// test of the outline and of each of its polygons (most points are rejected
// there, which keeps a run over 230 countries fast). A point outside every
// outline but within NEAR (0.05 degrees, about 5 km) of one counts for the
// nearest outline, unless a second one is nearly as close: coasts are
// simplified, so coastal points often miss them by a few hundred metres (as
// the old build did, countryByPoint and distanceTo in build.mjs).
//
// R22: a point inside an own checklist (rules file `checklists` entry with `of`,
// Réunion) and inside the checklist it is filed under (France, whose outline
// still contains Réunion) counts for the own checklist only.
//
// Sampling in measureShares: a regular grid of 24 x 24 points over the area's
// bounding box, keeping the points inside the area; when fewer than 30 are
// inside, a finer grid of 80 x 80 instead; when still none is inside (tiny or
// degenerate outlines), the vertices of the area's outer rings (at most about
// 400, every k-th). Each sample is tested against every target whose bounding
// box holds it. Samples in no target are `outside` (sea, or land with no
// outline) and do not count for the shares, so the shares are shares of land.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeName } from '../placement/areas.js'

/** Coastal tolerance in degrees (about 5 km), as in the old build. */
export const NEAR = 0.05

const GRID = 24
const FINE_GRID = 80
const MIN_POINTS = 30
const MAX_VERTICES = 400

/**
 * @typedef {Array<Array<[number, number]>>} Polygon  outer ring, then holes
 * @typedef {{ name: string, polygons: Polygon[], of?: string }} Target  an outline to
 *   measure against; `of` names the target it is filed under (R22)
 * @typedef {{ points: number, outside: number, shares: Array<[string, number]> }} Shares
 *   samples taken, samples in no target, and the share of land samples per target
 *   name in percent (unrounded), largest first
 */

/**
 * The polygons of a GeoJSON geometry.
 * @param {{ type: string, coordinates: any } | null} geometry
 * @returns {Polygon[]}  [] for anything but Polygon and MultiPolygon
 */
export function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates]
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates
  return []
}

/**
 * Keys of every cached outline, 'GeographicArea/32253' and 'Gazetteer/3529'.
 * @param {string} shapeDir  public/map-shapes/
 * @returns {Set<string>}
 */
export function listShapes(shapeDir) {
  const keys = new Set()
  for (const kind of ['GeographicArea', 'Gazetteer']) {
    const dir = join(shapeDir, kind)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) if (file.endsWith('.json')) keys.add(`${kind}/${file.slice(0, -5)}`)
  }
  return keys
}

/**
 * How an area's outline is shared among target outlines (see the header for
 * the sampling).
 * @param {Polygon[]} polygons  the area's outline
 * @param {Target[]} targets   countries, or the states of one country
 * @param {{ near?: number }} [options]  coastal tolerance for vertex samples (default NEAR)
 * @returns {Shares}
 * @example
 *   measureShares(borneo, countries)
 *   // { points: 412, outside: 3, shares: [['Indonesia', 72.1], ['Malaysia', 27.6], ['Brunei', 0.7]] }
 */
export function measureShares(polygons, targets, { near = NEAR } = {}) {
  const area = prepared(polygons)
  const { points, fromVertices } = samplesOf(area)
  const prepTargets = targets.map((target) => ({ target, shape: preparedTarget(target) }))
  const counts = new Map()
  let outside = 0
  for (const point of points) {
    let hits = prepTargets.filter(({ shape }) => contains(shape, point)).map(({ target }) => target)
    if (!hits.length && fromVertices && near > 0) hits = nearest(prepTargets, point, near).map(({ target }) => target)
    hits = ownOverOf(hits)
    if (!hits.length) { outside += 1; continue }
    for (const target of hits) counts.set(target.name, (counts.get(target.name) ?? 0) + 1)
  }
  const land = points.length - outside
  const shares = [...counts]
    .map(([name, count]) => [name, (count / land) * 100])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
  return { points: points.length, outside, shares }
}

/**
 * The Node Geometry: cached outlines read from disk, each once.
 * @param {Object} input
 * @param {string} input.shapeDir          public/map-shapes/
 * @param {string} input.fallbackFile      public/checklists/fallback-shapes.geojson
 * @param {string} input.subdivisionsFile  public/checklists/subdivisions.geojson
 * @param {import('../placement/checklists.js').Checklist[]} input.checklists
 * @param {import('../placement/rules.js').CompiledRules} [input.rules]  parts and `of`
 * @returns {import('../placement/engine.js').Geometry & {
 *   checklistTargets: () => Target[],
 *   stateTargets: (checklistId: number|string) => Target[],
 *   areaPolygons: (kind: 'GA'|'GZ', id: number) => Polygon[] | null }}
 */
export function createNodeGeometry({ shapeDir, fallbackFile, subdivisionsFile, checklists, rules = null }) {
  const files = new Map() // 'GeographicArea/1' -> polygons or null
  const readShape = (key) => {
    if (!files.has(key)) {
      const file = join(shapeDir, `${key}.json`)
      files.set(key, existsSync(file) ? polygonsOf(JSON.parse(readFileSync(file, 'utf8'))) : null)
    }
    return files.get(key)
  }
  const fallback = new Map()
  if (fallbackFile && existsSync(fallbackFile)) {
    for (const feature of JSON.parse(readFileSync(fallbackFile, 'utf8')).features) {
      fallback.set(normalizeName(feature.properties.name), polygonsOf(feature.geometry))
    }
  }
  const subdivisions = subdivisionsFile && existsSync(subdivisionsFile)
    ? JSON.parse(readFileSync(subdivisionsFile, 'utf8')).features
    : []

  // `of` of own checklists, by normalized name (Réunion -> France).
  const ofByName = new Map()
  for (const entry of rules?.checklists ?? []) if (entry.of) ofByName.set(normalizeName(entry.name), entry.of)
  const byId = new Map(checklists.map((checklist) => [checklist.id, checklist]))

  // Checklist outlines as targets, in checklist order; checklists without one are left out.
  let targets = null
  const checklistTargets = () => {
    targets ??= checklists.flatMap((checklist) => {
      const id = checklist.areaIds.find((areaId) => readShape(`GeographicArea/${areaId}`))
      const polygons = id != null ? readShape(`GeographicArea/${id}`) : fallback.get(normalizeName(checklist.name))
      if (!polygons?.length) return []
      const of = ofByName.get(normalizeName(checklist.name))
      return [{ name: checklist.name, id: checklist.id, polygons, ...(of ? { of } : {}) }]
    })
    return targets
  }
  let preparedChecklists = null
  const checklistShapes = () => {
    preparedChecklists ??= checklistTargets().map((target) => ({ target, shape: preparedTarget(target) }))
    return preparedChecklists
  }

  const statesById = new Map()
  const stateTargets = (checklistId) => {
    if (!statesById.has(checklistId)) {
      const checklist = byId.get(checklistId)
      const list = checklist?.states
        ? subdivisions
          .filter((feature) => normalizeName(feature.properties.country) === normalizeName(checklist.name))
          .map((feature) => ({ name: feature.properties.name, polygons: polygonsOf(feature.geometry) }))
        : []
      statesById.set(checklistId, list)
    }
    return statesById.get(checklistId)
  }

  const partShapes = new Map()
  const partsOf = (checklistId) => {
    if (!partShapes.has(checklistId)) {
      const checklist = byId.get(checklistId)
      const parts = (checklist && rules?.parts?.[checklist.name]) || []
      partShapes.set(checklistId, parts.map((part) => {
        const id = part.areas.filter((key) => key.startsWith('GA ')).map((key) => key.slice(3))
          .find((areaId) => readShape(`GeographicArea/${areaId}`))
        const polygons = id != null ? readShape(`GeographicArea/${id}`) : null
        return { name: part.name, shape: polygons ? preparedTarget({ name: part.name, polygons }) : null, box: part.box ?? null }
      }))
    }
    return partShapes.get(checklistId)
  }

  return {
    async checklistsAt(point) {
      const shapes = checklistShapes()
      let hits = shapes.filter(({ shape }) => contains(shape, point))
      if (!hits.length) hits = nearest(shapes, point, NEAR)
      return ownOverOf(hits.map(({ target }) => target)).map((target) => target.id)
    },
    async stateAt(checklistId, point) {
      const shapes = stateTargets(checklistId).map((target) => ({ target, shape: preparedTarget(target) }))
      const hit = shapes.find(({ shape }) => contains(shape, point)) ?? onlyNearest(shapes, point)
      return hit?.target.name ?? null
    },
    async partAt(checklistId, point) {
      const parts = partsOf(checklistId)
      const inOutline = parts.find((part) => part.shape && contains(part.shape, point))
      if (inOutline) return inOutline.name
      return parts.find((part) => part.box && inBox(part.box, point))?.name ?? null
    },
    stateNames(checklistId) {
      return stateTargets(checklistId).map((target) => target.name)
    },
    checklistTargets,
    stateTargets,
    areaPolygons(kind, id) {
      const polygons = readShape(`${kind === 'GZ' ? 'Gazetteer' : 'GeographicArea'}/${id}`)
      return polygons?.length ? polygons : null
    }
  }
}

// Prepared outlines: polygons with their bounding boxes, cached per target object.
const preparedCache = new WeakMap()
function preparedTarget(target) {
  if (!preparedCache.has(target)) preparedCache.set(target, prepared(target.polygons))
  return preparedCache.get(target)
}

function prepared(polygons) {
  const parts = polygons.filter((polygon) => polygon?.[0]?.length).map((rings) => ({ rings, box: boxOf(rings[0]) }))
  const box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const part of parts) {
    box[0] = Math.min(box[0], part.box[0]); box[1] = Math.min(box[1], part.box[1])
    box[2] = Math.max(box[2], part.box[2]); box[3] = Math.max(box[3], part.box[3])
  }
  return { parts, box }
}

function boxOf(ring) {
  const box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [lng, lat] of ring) {
    if (lng < box[0]) box[0] = lng
    if (lat < box[1]) box[1] = lat
    if (lng > box[2]) box[2] = lng
    if (lat > box[3]) box[3] = lat
  }
  return box
}

function inBox(box, [lng, lat], margin = 0) {
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

// Is the point inside the prepared outline (holes excluded)?
function contains(shape, point) {
  if (!inBox(shape.box, point)) return false
  const [lng, lat] = point
  return shape.parts.some(({ rings: [outer, ...holes], box }) =>
    inBox(box, point) && inRing(outer, lng, lat) && !holes.some((hole) => inRing(hole, lng, lat)))
}

// Distance in degrees from a point to the edges of a prepared outline, only
// for polygons whose box widened by `limit` holds the point; else Infinity.
function distanceTo(shape, point, limit) {
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

// The outlines within `limit` of a point: the nearest alone, or the two
// nearest when the second is nearly as close (less than limit / 2 further).
function nearest(shapes, point, limit) {
  const close = shapes
    .map((entry) => ({ entry, distance: distanceTo(entry.shape, point, limit) }))
    .filter(({ distance }) => distance <= limit)
    .sort((a, b) => a.distance - b.distance)
  if (!close.length) return []
  if (close.length > 1 && close[1].distance - close[0].distance < limit / 2) return [close[0].entry, close[1].entry]
  return [close[0].entry]
}

// The nearest outline within NEAR when it is unambiguous, else undefined.
function onlyNearest(shapes, point) {
  const hits = nearest(shapes, point, NEAR)
  return hits.length === 1 ? hits[0] : undefined
}

// R22: drop a target when an own checklist filed under it is also hit.
function ownOverOf(hits) {
  if (hits.length < 2) return hits
  const covered = new Set(hits.filter((target) => target.of).map((target) => normalizeName(target.of)))
  return covered.size ? hits.filter((target) => !covered.has(normalizeName(target.name))) : hits
}

// Sample points of a prepared area (see the header).
function samplesOf(area) {
  if (!area.parts.length) return { points: [], fromVertices: false }
  for (const size of [GRID, FINE_GRID]) {
    const points = grid(area, size)
    if (points.length >= MIN_POINTS || (size === FINE_GRID && points.length)) return { points, fromVertices: false }
  }
  const vertices = area.parts.flatMap(({ rings }) => rings[0].slice(0, -1))
  const step = Math.max(1, Math.ceil(vertices.length / MAX_VERTICES))
  return { points: vertices.filter((_, index) => index % step === 0), fromVertices: true }
}

function grid(area, size) {
  const [west, south, east, north] = area.box
  const points = []
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const point = [west + ((i + 0.5) * (east - west)) / size, south + ((j + 0.5) * (north - south)) / size]
      if (contains(area, point)) points.push(point)
    }
  }
  return points
}
