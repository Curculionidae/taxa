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
//                     (properties.aliases, other names from Natural Earth, are
//                     not read: they decide nothing, R51)
//   checklists        from placement/checklists.js (deriveChecklists)
//   rules             the compiled rules file (placement/rules.js), for parts,
//                     the `of` country of own checklists and synonyms
// Outputs: a Geometry as engine.js describes it (checklistsAt, stateAt, partAt,
//   stateNames), plus checklistTargets, stateTargets and areaPolygons for
//   measuring; measureShares; listShapes.
//
// Which outline stands for what
//   checklist  the first of its areaIds with a cached GeographicArea/<id>.json,
//              else the fallback outline named like the checklist or one of
//              its synonyms (rules file `synonyms`, compared with normalizeName:
//              "Saint Barthelemy" for Saint Barthélemy), else none; a rules
//              file entry with `outline: natural_earth` takes the fallback
//              outline first (placement/geometry.js checklistOutline)
//   part       the first of its GA areas with a cached outline, else its `box`
//   state      the subdivisions feature with that country and name
//
// Point tests, the coastal tolerance (rules file coastal_tolerance_degrees) and R22 come from
// placement/geometry.js, shared with the browser geometry of the curator page
// (placement/geometry-browser.js), so both answer every point question alike.
//
// Sampling in measureShares: a regular grid of 24 x 24 points over the area's
// bounding box, keeping the points inside the area; when fewer than 30 are
// inside, a finer grid of 80 x 80 instead (the coarse points again if the fine
// grid finds none); when still none is inside (tiny or degenerate outlines), the vertices of the area's outer rings (at most about
// 400, every k-th). Each sample is tested against every target whose bounding
// box holds it. Samples in no target are `outside` (sea, or land with no
// outline) and do not count for the shares, so the shares are shares of land.
// Targets that overlap without an `of` link (two outlines covering the same
// coast) each count a sample inside both, so shares can add up to more than 100%.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeName } from '../placement/areas.js'
import {
  polygonsOf, prepared, preparedTarget, entriesOf, contains, nearest, ownOverOf, ofByName, toleranceOf,
  checklistsAtPoint, stateAtPoint, stateTargetsOf, partOutlineId, partAtPoint, checklistOutline
} from '../placement/geometry.js'

export { polygonsOf }

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
 * @param {{ near?: number }} [options]  coastal tolerance in degrees for vertex samples
 *   (the measuring script passes the rules file's coastal_tolerance_degrees; default 0)
 * @returns {Shares}
 * @example
 *   measureShares(borneo, countries)
 *   // { points: 412, outside: 3, shares: [['Indonesia', 72.1], ['Malaysia', 27.6], ['Brunei', 0.7]] }
 */
export function measureShares(polygons, targets, { near = 0 } = {}) {
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
 * @param {import('../placement/rules.js').CompiledRules} [input.rules]  parts, `of` and synonyms
 * @returns {import('../placement/engine.js').Geometry & {
 *   checklistTargets: () => Target[],
 *   outlineOf: (checklist: import('../placement/checklists.js').Checklist) =>
 *     { key: string|null, fallback: string|null, ref: string|null },
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
  const fallback = new Map() // normalized name -> { name, polygons }
  if (fallbackFile && existsSync(fallbackFile)) {
    for (const feature of JSON.parse(readFileSync(fallbackFile, 'utf8')).features) {
      fallback.set(normalizeName(feature.properties.name), { name: feature.properties.name, polygons: polygonsOf(feature.geometry) })
    }
  }
  const fallbackNames = new Map([...fallback].map(([key, { name }]) => [key, name]))
  const tolerance = toleranceOf(rules)
  const subdivisions = subdivisionsFile && existsSync(subdivisionsFile)
    ? JSON.parse(readFileSync(subdivisionsFile, 'utf8')).features
    : []

  const ofOf = ofByName(rules) // Réunion -> France
  const byId = new Map(checklists.map((checklist) => [checklist.id, checklist]))

  // The outline of a checklist (placement/geometry.js checklistOutline): key,
  // fallback feature name and the rules line that chose it.
  const outlineOf = (checklist) => checklistOutline(checklist, {
    rules, fallbackNames, isCached: (key) => Boolean(readShape(key)?.length)
  })

  // Checklist outlines as targets, in checklist order; checklists without one
  // are left out. `outline` says which file it came from (written to
  // context.json for the curator page): 'GeographicArea/<id>' or 'fallback/<name>'.
  let targets = null
  const checklistTargets = () => {
    targets ??= checklists.flatMap((checklist) => {
      const { key, fallback: name } = outlineOf(checklist)
      const polygons = !key ? null : name != null ? fallback.get(normalizeName(name))?.polygons : readShape(key)
      if (!polygons?.length) return []
      const of = ofOf.get(normalizeName(checklist.name))
      return [{ name: checklist.name, id: checklist.id, polygons, outline: key, ...(of ? { of } : {}) }]
    })
    return targets
  }
  let preparedChecklists = null
  const checklistShapes = () => {
    preparedChecklists ??= entriesOf(checklistTargets())
    return preparedChecklists
  }

  const statesById = new Map()
  const stateTargets = (checklistId) => {
    if (!statesById.has(checklistId)) statesById.set(checklistId, stateTargetsOf(subdivisions, byId.get(checklistId)))
    return statesById.get(checklistId)
  }

  const partShapes = new Map()
  const partsOf = (checklistId) => {
    if (!partShapes.has(checklistId)) {
      const checklist = byId.get(checklistId)
      const parts = (checklist && rules?.parts?.[checklist.name]) || []
      partShapes.set(checklistId, parts.map((part) => {
        const id = partOutlineId(part, (key) => Boolean(readShape(key)))
        const polygons = id != null ? readShape(`GeographicArea/${id}`) : null
        return { name: part.name, shape: polygons ? preparedTarget({ name: part.name, polygons }) : null, box: part.box ?? null }
      }))
    }
    return partShapes.get(checklistId)
  }

  return {
    async checklistsAt(point) {
      return checklistsAtPoint(checklistShapes(), point, tolerance)
    },
    async stateAt(checklistId, point) {
      return stateAtPoint(entriesOf(stateTargets(checklistId)), point, tolerance)
    },
    async partAt(checklistId, point) {
      return partAtPoint(partsOf(checklistId), point)
    },
    stateNames(checklistId) {
      return stateTargets(checklistId).map(({ name }) => ({ name }))
    },
    checklistTargets,
    stateTargets,
    outlineOf,
    areaPolygons(kind, id) {
      const polygons = readShape(`${kind === 'GZ' ? 'Gazetteer' : 'GeographicArea'}/${id}`)
      return polygons?.length ? polygons : null
    }
  }
}

/**
 * The cached outlines of some areas that hold no polygon to measure or test
 * points against (GZ 10497 Low Beskids is a Point): the engine says "no
 * usable outline" for them instead of "not measured yet" (engine.js
 * createContext `unusable`). Written to context.json, so the curator page
 * knows them too.
 * @param {Iterable<import('../placement/areas.js').Area>} areas
 * @param {Set<string>} shapes  cached outline keys (listShapes)
 * @param {{ areaPolygons: (kind: 'GA'|'GZ', id: number) => Polygon[]|null }} geometry
 * @returns {Set<string>}  'Gazetteer/10497'
 */
export function unusableOutlines(areas, shapes, geometry) {
  const keys = new Set()
  for (const area of areas) {
    const key = `${area.kind === 'GZ' ? 'Gazetteer' : 'GeographicArea'}/${area.id}`
    if (shapes.has(key) && !geometry.areaPolygons(area.kind, area.id)) keys.add(key)
  }
  return keys
}

// Sample points of a prepared area (see the header).
function samplesOf(area) {
  if (!area.parts.length) return { points: [], fromVertices: false }
  const coarse = grid(area, GRID)
  if (coarse.length >= MIN_POINTS) return { points: coarse, fromVertices: false }
  const fine = grid(area, FINE_GRID)
  if (fine.length) return { points: fine, fromVertices: false }
  if (coarse.length) return { points: coarse, fromVertices: false }
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
