// Outline lookups for the placement engine in the browser, and the engine
// context of the curator page, made from the cache files only.
//
// Purpose: the curator page (CuratorPage.vue) places a record live with the
// same engine as the cache build (engine.js). For its explanations to equal
// the build's, it must decide with the same inputs: the checklists, the rules
// and the outlines the build used. The build writes them to
// public/checklists/context.json and rules.json; loadCacheContext reads those
// files and nothing else. createBrowserGeometry is the Geometry (engine.js
// typedef) of the browser: the same answers as the Node geometry
// (scripts/geometry-node.mjs), since every point test comes from the shared
// placement/geometry.js; only the outlines are fetched instead of read.
//
// Inputs (through fetchJson, paths relative to the site root)
//   checklists/context.json         written by the build (see below)
//   checklists/rules.json           the compiled rules file (rules.js)
//   checklists/subdivisions.geojson state outlines, fetched once on creation
//                                   (stateNames is synchronous, so it must be there)
//   checklists/fallback-shapes.geojson  fetched once, the first time a fallback
//                                   outline is needed
//   map-shapes/<kind>/<id>.json     one outline, fetched the first time a point
//                                   lies within its bbox (widened by the coastal
//                                   tolerance), then kept in memory; a missing
//                                   file (404) counts as no outline
// context.json
//   built       the build date
//   checklists  every checklist the engine knows (checklists.js Checklist: id,
//               name, iso2, areaIds, parts, states, ref), in the build's order
//   outlines    [{ id, outline, bbox }]: the outline that stands for each checklist
//               with one ('GeographicArea/<id>' or 'fallback/<feature name>'), in
//               checklist order, and its bbox [west, south, east, north]
//   shapes      { GeographicArea: [ids], Gazetteer: [ids] }: every cached outline
//               the build saw (the engine's `shapes`)
//   unusable    { GeographicArea: [ids], Gazetteer: [ids] }: the cached outlines of
//               used areas that hold no polygon (the engine's `unusable`)
//   stateAreas  { [checklist id]: [Area] }: the areas the build placed in each
//               checklist with states (the engine's `stateAreas`, R51)
// Output: createBrowserGeometry gives a Geometry; loadCacheContext gives
//   { ctx, context, rules }, ctx being the engine Context (createContext).
// Errors: a failed fetch rejects (the page shows it), except a missing outline
//   file (404): that outline counts as missing, so the page still shows what
//   exists. Then the answer can differ from the build's (the map shapes were
//   refreshed after the checklist build; README, "Limits"). Nothing is guessed.
import { createContext } from './engine.js'
import { normalizeName } from './areas.js'
import {
  polygonsOf, preparedTarget, entriesOf, inBox, ofByName, toleranceOf, measureShares, polygonsBox, boxesMeet,
  checklistsAtPoint, stateAtPoint, stateTargetsOf, partOutlineId, partAtPoint
} from './geometry.js'

/** bbox values in context.json are rounded to 1e-4; the filter widens a little more. */
const BBOX_ROUNDING = 0.001

/**
 * @typedef {(path: string) => Promise<any>} FetchJson  fetches a JSON file by its
 *   path relative to the site root ('checklists/index.json'), rejects on failure
 *
 * @typedef {Object} CacheContext  the contents of context.json
 * @property {string} built
 * @property {import('./checklists.js').Checklist[]} checklists
 * @property {{ id: number|string, outline: string, bbox: number[] }[]} outlines
 * @property {{ GeographicArea: number[], Gazetteer: number[] }} shapes
 */

/**
 * The cached outline keys of context.json as a Set.
 * @param {{ GeographicArea?: number[], Gazetteer?: number[] }} shapes
 * @returns {Set<string>}  'GeographicArea/32253', 'Gazetteer/3529'
 */
export function shapeKeys(shapes) {
  const keys = new Set()
  for (const kind of ['GeographicArea', 'Gazetteer']) for (const id of shapes?.[kind] ?? []) keys.add(`${kind}/${id}`)
  return keys
}

/**
 * A fetchJson for the site: base URL + path, JSON or a rejection with the status.
 * @param {string} baseUrl  the site base, '/' or '/taxa/'
 * @param {typeof fetch} [fetchImpl]
 * @returns {FetchJson}
 */
export function siteFetchJson(baseUrl, fetchImpl = globalThis.fetch) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return async (path) => {
    const response = await fetchImpl(`${base}${path}`)
    if (!response.ok) throw Object.assign(new Error(`could not load ${path} (${response.status})`), { status: response.status })
    return response.json()
  }
}

/**
 * Is this fetch failure a missing file (404)?
 * @param {any} failure
 * @returns {boolean}
 */
export function isMissing(failure) {
  return failure?.status === 404 || /\b404\b/.test(String(failure?.message ?? ''))
}

// The promise kept under `key`, made once; dropped again when it rejects.
function kept(map, key, make) {
  if (!map.has(key)) {
    const promise = make()
    map.set(key, promise)
    promise.catch(() => { if (map.get(key) === promise) map.delete(key) })
  }
  return map.get(key)
}

/**
 * The browser Geometry. Fetches subdivisions.geojson before it resolves.
 * @param {Object} input
 * @param {CacheContext} input.context
 * @param {import('./rules.js').CompiledRules} input.rules
 * @param {FetchJson} input.fetchJson
 * @returns {Promise<import('./engine.js').Geometry & {
 *   outlinePolygons: (key: string) => Promise<import('./geometry.js').Polygon[]|null> }>}
 *   outlinePolygons fetches one outline by key ('GeographicArea/32253' or
 *   'fallback/Spain'), for the map
 */
export async function createBrowserGeometry({ context, rules, fetchJson }) {
  const subdivisions = (await fetchJson('checklists/subdivisions.geojson')).features ?? []
  const cached = shapeKeys(context.shapes)
  const byId = new Map(context.checklists.map((checklist) => [checklist.id, checklist]))
  const ofOf = ofByName(rules)
  const tolerance = toleranceOf(rules)
  const bboxMargin = tolerance + BBOX_ROUNDING

  // Outlines by key, each fetched once (the promise is kept, so two questions
  // at once share one request; a failed one is forgotten, so a later lookup
  // tries again).
  const outlines = new Map()
  const fallbackFile = new Map()
  const fallbackFeatures = () => kept(fallbackFile, 'all', () =>
    fetchJson('checklists/fallback-shapes.geojson').then((file) => file.features ?? []))
  function outlinePolygons(key) {
    const name = key.startsWith('fallback/') ? key.slice('fallback/'.length) : null
    return kept(outlines, key, () => (name != null
      ? fallbackFeatures().then((features) => {
        // The last feature of that name, as the Node geometry's Map keeps it.
        const feature = features.findLast((f) => normalizeName(f.properties.name) === normalizeName(name))
        return feature ? polygonsOf(feature.geometry) : null
      })
      : fetchJson(`map-shapes/${key}.json`).then(polygonsOf, (failure) => {
        if (isMissing(failure)) return null
        throw failure
      })))
  }

  // Checklist targets, made once each, so preparedTarget's cache holds.
  const targets = new Map()
  async function checklistTarget({ id, outline }) {
    if (!targets.has(id)) {
      const checklist = byId.get(id)
      const polygons = await outlinePolygons(outline)
      const of = ofOf.get(normalizeName(checklist.name))
      targets.set(id, polygons?.length ? { name: checklist.name, id, polygons, outline, ...(of ? { of } : {}) } : null)
    }
    return targets.get(id)
  }

  const statesById = new Map()
  const stateTargets = (checklistId) => {
    if (!statesById.has(checklistId)) statesById.set(checklistId, stateTargetsOf(subdivisions, byId.get(checklistId)))
    return statesById.get(checklistId)
  }

  const partsById = new Map()
  function partsOf(checklistId) {
    const checklist = byId.get(checklistId)
    const parts = (checklist && rules?.parts?.[checklist.name]) || []
    return kept(partsById, checklistId, () => Promise.all(parts.map(async (part) => {
      const id = partOutlineId(part, (key) => cached.has(key))
      const polygons = id != null ? await outlinePolygons(`GeographicArea/${id}`) : null
      return { name: part.name, shape: polygons ? preparedTarget({ name: part.name, polygons }) : null, box: part.box ?? null }
    })))
  }

  return {
    async checklistsAt(point) {
      // Only outlines whose bbox (widened by the coastal tolerance) holds the
      // point can contain it or lie within the tolerance of it; the others
      // are not fetched.
      const near = context.outlines.filter(({ bbox }) => bbox && inBox(bbox, point, bboxMargin))
      const found = (await Promise.all(near.map(checklistTarget))).filter(Boolean)
      return checklistsAtPoint(entriesOf(found), point, tolerance)
    },
    async stateAt(checklistId, point) {
      return stateAtPoint(entriesOf(stateTargets(checklistId)), point, tolerance)
    },
    async partAt(checklistId, point) {
      return partAtPoint(await partsOf(checklistId), point)
    },
    async checklistShares(polygons) {
      // Only outlines whose bbox meets the shape's (widened by the coastal
      // tolerance) can hold a sample; the others are not fetched. The order
      // stays the checklist order, as in the Node geometry.
      const box = polygonsBox(polygons)
      const near = context.outlines.filter(({ bbox }) => bbox && boxesMeet(bbox, box, bboxMargin))
      const found = (await Promise.all(near.map(checklistTarget))).filter(Boolean)
      return measureShares(polygons, found, { near: tolerance })
    },
    async stateShares(checklistId, polygons) {
      return measureShares(polygons, stateTargets(checklistId), { near: tolerance })
    },
    stateNames(checklistId) {
      return stateTargets(checklistId).map(({ name }) => ({ name }))
    },
    outlinePolygons
  }
}

/**
 * The engine context of the curator page, from the cache files only.
 * @param {{ fetchJson: FetchJson }} input
 * @returns {Promise<{ ctx: import('./engine.js').Context, context: CacheContext,
 *   rules: import('./rules.js').CompiledRules }>}
 */
export async function loadCacheContext({ fetchJson }) {
  const [context, rules] = await Promise.all([fetchJson('checklists/context.json'), fetchJson('checklists/rules.json')])
  const geometry = await createBrowserGeometry({ context, rules, fetchJson })
  const ctx = createContext({
    checklists: context.checklists,
    rules,
    geometry,
    shapes: shapeKeys(context.shapes),
    unusable: shapeKeys(context.unusable),
    outlines: new Map(context.outlines.map(({ id, outline }) => [id, outline])),
    // JSON keys are text; the checklist ids may be numbers.
    stateAreas: new Map(context.checklists.filter(({ id }) => context.stateAreas?.[id]).map(({ id }) => [id, context.stateAreas[id]]))
  })
  return { ctx, context, rules }
}
