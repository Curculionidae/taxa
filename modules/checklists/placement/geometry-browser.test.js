import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserGeometry, loadCacheContext, shapeKeys } from './geometry-browser.js'

// A rectangle as a GeoJSON Polygon.
const rect = (west, south, east, north) => ({
  type: 'Polygon',
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
})

const RULES = {
  checklists: [{ name: 'Réunion', iso2: 'RE', of: 'France', areas: ['GA 900'], names: ['Reunion'], why: '', ref: 'placement.yml:5' }],
  stateCountries: { names: ['Utopia'], ref: null },
  synonyms: [],
  ignoredNameWords: { words: [], ref: null },
  coastalTolerance: { degrees: 0.05, ref: 'placement.yml:9' },
  parts: {
    France: [
      { name: 'Corsica', areas: ['GA 950'], names: ['Corse'], ref: 'placement.yml:20' },
      { name: 'Islands', areas: ['GA 951'], names: [], box: [50, 50, 60, 60], ref: 'placement.yml:21' },
      { name: 'Mainland France', areas: [], names: [], rest: true, ref: 'placement.yml:22' }
    ]
  },
  manual: [],
  overlap: []
}

const CONTEXT = {
  built: '2026-11-20',
  checklists: [
    { id: 1, name: 'France', iso2: 'FR', areaIds: [1], parts: ['Corsica', 'Islands', 'Mainland France'], states: false },
    { id: 900, name: 'Réunion', iso2: 'RE', areaIds: [900], states: false, ref: 'placement.yml:5' },
    { id: 2, name: 'Spain', iso2: 'ES', areaIds: [2], states: false },
    { id: 3, name: 'Utopia', iso2: 'UT', areaIds: [3], states: true },
    { id: 4, name: 'Atlantis', iso2: '', areaIds: [4], states: false }
  ],
  outlines: [
    { id: 1, outline: 'GeographicArea/1', bbox: [0, 0, 10, 10] },
    { id: 900, outline: 'GeographicArea/900', bbox: [2, 2, 4, 4] },
    { id: 2, outline: 'fallback/Spain', bbox: [-10, 0, 0, 10] },
    { id: 3, outline: 'GeographicArea/3', bbox: [20, 0, 30, 10] }
  ],
  shapes: { GeographicArea: [1, 3, 900, 950], Gazetteer: [7] },
  unusable: { GeographicArea: [], Gazetteer: [7] }
}

const FILES = {
  'checklists/context.json': CONTEXT,
  'checklists/rules.json': RULES,
  'map-shapes/GeographicArea/1.json': rect(0, 0, 10, 10),
  'map-shapes/GeographicArea/900.json': rect(2, 2, 4, 4),
  'map-shapes/GeographicArea/3.json': rect(20, 0, 30, 10),
  'map-shapes/GeographicArea/950.json': rect(8, 8, 9, 9),
  'checklists/fallback-shapes.geojson': {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: 'Spain' }, geometry: rect(-10, 0, 0, 10) }]
  },
  'checklists/subdivisions.geojson': {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { country: 'Utopia', name: 'North', aliases: ['Nord'] }, geometry: rect(20, 5, 30, 10) },
      { type: 'Feature', properties: { country: 'Utopia', name: 'South' }, geometry: rect(20, 0, 30, 5) }
    ]
  }
}

// A fetchJson that serves FILES and records every path asked for.
function fakeFetch() {
  const calls = []
  const fetchJson = async (path) => {
    calls.push(path)
    if (!(path in FILES)) throw new Error(`404 ${path}`)
    return structuredClone(FILES[path])
  }
  return { fetchJson, calls }
}

const geometryOf = async () => {
  const { fetchJson, calls } = fakeFetch()
  const geometry = await createBrowserGeometry({ context: CONTEXT, rules: RULES, fetchJson })
  return { geometry, calls }
}

test('createBrowserGeometry: fetches subdivisions once and no outline before a question', async () => {
  const { geometry, calls } = await geometryOf()
  assert.deepEqual(calls, ['checklists/subdivisions.geojson'])
  assert.deepEqual(geometry.stateNames(3), [{ name: 'North' }, { name: 'South' }])
  assert.deepEqual(geometry.stateNames(1), [])
  await geometry.stateAt(3, [25, 7])
  assert.equal(calls.filter((path) => path.endsWith('subdivisions.geojson')).length, 1)
})

test('checklistsAt: fetches only outlines whose bbox holds the point, each once', async () => {
  const { geometry, calls } = await geometryOf()
  assert.deepEqual((await geometry.checklistsAt([25, 5])).ids, [3])
  assert.deepEqual(calls.slice(1), ['map-shapes/GeographicArea/3.json'])
  assert.deepEqual((await geometry.checklistsAt([26, 6])).ids, [3])
  assert.deepEqual(calls.slice(1), ['map-shapes/GeographicArea/3.json'])
})

test('checklistsAt: a fallback outline comes from fallback-shapes.geojson', async () => {
  const { geometry, calls } = await geometryOf()
  assert.deepEqual((await geometry.checklistsAt([-5, 5])).ids, [2])
  assert.ok(calls.includes('checklists/fallback-shapes.geojson'))
})

test('checklistsAt: an own checklist wins over the country it is filed under (R22)', async () => {
  const { geometry } = await geometryOf()
  assert.deepEqual((await geometry.checklistsAt([3, 3])).ids, [900])
  assert.deepEqual((await geometry.checklistsAt([6, 6])).ids, [1])
})

test('checklistsAt: a point just off the coast counts for the nearest outline', async () => {
  const { geometry } = await geometryOf()
  assert.deepEqual(await geometry.checklistsAt([30.02, 5]), { ids: [3], near: true })
  assert.deepEqual(await geometry.checklistsAt([25, 5]), { ids: [3], near: false })
  assert.deepEqual(await geometry.checklistsAt([31, 5]), { ids: [], near: false })
})

test('stateAt: the state outline holding the point, else the only one near it', async () => {
  const { geometry } = await geometryOf()
  assert.deepEqual(await geometry.stateAt(3, [25, 7]), { name: 'North', near: false })
  assert.deepEqual(await geometry.stateAt(3, [25, 2]), { name: 'South', near: false })
  assert.deepEqual(await geometry.stateAt(3, [30.02, 8]), { name: 'North', near: true })
  assert.equal(await geometry.stateAt(1, [5, 5]), null)
})

test('partAt: the part outline, else the part box, else null', async () => {
  const { geometry, calls } = await geometryOf()
  assert.deepEqual(await geometry.partAt(1, [8.5, 8.5]), { name: 'Corsica', by: 'outline' })
  assert.deepEqual(await geometry.partAt(1, [55, 55]), { name: 'Islands', by: 'box' })
  assert.equal(await geometry.partAt(1, [5, 5]), null)
  // GA 951 is not cached, so it is never fetched.
  assert.ok(!calls.includes('map-shapes/GeographicArea/951.json'))
})

test('shapeKeys: the cached outline keys of context.json', () => {
  assert.deepEqual([...shapeKeys(CONTEXT.shapes)], ['GeographicArea/1', 'GeographicArea/3', 'GeographicArea/900', 'GeographicArea/950', 'Gazetteer/7'])
})

test('loadCacheContext: an engine context from the cache files only', async () => {
  const { fetchJson } = fakeFetch()
  const { ctx, context, rules } = await loadCacheContext({ fetchJson })
  assert.equal(context.built, '2026-11-20')
  assert.equal(rules.parts.France.length, 3)
  assert.equal(ctx.byId.get(900).name, 'Réunion')
  assert.ok(ctx.shapes.has('Gazetteer/7'))
  assert.ok(ctx.unusable.has('Gazetteer/7'))
  assert.equal(ctx.outlines.get(2), 'fallback/Spain')
  assert.deepEqual((await ctx.geometry.checklistsAt([3, 3])).ids, [900])
})

test('checklistsAt: a failed outline fetch rejects, and the next question fetches it again', async () => {
  let fail = true
  const fetchJson = async (path) => {
    if (path.endsWith('GeographicArea/3.json') && fail) { fail = false; throw new Error('could not load (500)') }
    return structuredClone(FILES[path])
  }
  const geometry = await createBrowserGeometry({ context: CONTEXT, rules: RULES, fetchJson })
  await assert.rejects(geometry.checklistsAt([25, 5]), /500/)
  assert.deepEqual((await geometry.checklistsAt([25, 5])).ids, [3])
})

test('checklistsAt: a missing outline file (404) counts as no outline, the others still answer', async () => {
  const fetchJson = async (path) => {
    if (path.endsWith('GeographicArea/900.json')) throw Object.assign(new Error('could not load (404)'), { status: 404 })
    return structuredClone(FILES[path])
  }
  const geometry = await createBrowserGeometry({ context: CONTEXT, rules: RULES, fetchJson })
  assert.deepEqual(await geometry.checklistsAt([3, 3]), { ids: [1], near: false })
  assert.equal(await geometry.outlinePolygons('GeographicArea/900'), null)
})

test('without coastal_tolerance_degrees in the rules there is no coastal tolerance', async () => {
  const { fetchJson } = fakeFetch()
  const rules = { ...RULES, coastalTolerance: { degrees: 0, ref: null } }
  const geometry = await createBrowserGeometry({ context: CONTEXT, rules, fetchJson })
  assert.deepEqual(await geometry.checklistsAt([30.02, 5]), { ids: [], near: false })
})
