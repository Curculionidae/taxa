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
// measureShares (and its sampling) lives in placement/geometry.js, shared with
// the engine (a specimen's georeference shape) and the curator page.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeName } from '../placement/areas.js'
import {
  polygonsOf, preparedTarget, entriesOf, ofByName, toleranceOf, measureShares,
  checklistsAtPoint, stateAtPoint, stateTargetsOf, partOutlineId, partAtPoint, checklistOutline
} from '../placement/geometry.js'

export { polygonsOf, measureShares }

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
    async checklistShares(polygons) {
      return measureShares(polygons, checklistTargets(), { near: tolerance })
    },
    async stateShares(checklistId, polygons) {
      return measureShares(polygons, stateTargets(checklistId), { near: tolerance })
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
