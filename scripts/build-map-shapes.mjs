// Builds public/map-shapes/: one file per shape (GeographicArea or Gazetteer)
// the species map can need, as a plain GeoJSON geometry, simplified for
// display: every shape an asserted distribution of the project uses, plus the
// area of every collecting event of a determined collection object without a
// georeference (the map draws such a specimen as that area). PanelMapV2 reads these instead of waiting
// for TaxonWorks to serialise every shape of a page's map on each visit, which
// takes about 93 ms per area plus 54 µs per point (Canada alone: about 4 s).
// See panels/PanelMapV2/lib/fastDistribution.js.
//
// Run with `npm run map-shapes`. Shapes already on disk are kept (areas do not
// change), so a re-run only fetches shapes new distributions started using.
// `npm run map-shapes -- --refresh` fetches all of them again. A shape the map
// needs that is not here yet is fetched live, so the map stays complete.
// Areas TaxonWorks has no shape for are listed in without-shape.json; the map
// leaves them out, as distribution.geojson does.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Ramer-Douglas-Peucker tolerance in degrees (0.005° is about 0.5 km), and
// coordinate decimals (4 is about 11 m). Small at the map's zoom levels, and
// shrinks the shapes to about a fifth.
const TOLERANCE = 0.005
const DECIMALS = 4

const PER = 500
const PARALLEL = 6
const OUT_DIR = fileURLToPath(new URL('../public/map-shapes/', import.meta.url))
const WITHOUT_SHAPE_FILE = `${OUT_DIR}without-shape.json`
const REFRESH = process.argv.includes('--refresh')

const apiConfig = readFileSync(new URL('../config/api.yml', import.meta.url), 'utf8')
const BASE = apiConfig.match(/^\s*url:\s*['"]?([^'"\s]+)/m)[1]
const TOKEN = apiConfig.match(/^\s*project_token:\s*['"]?([^'"\s]+)/m)[1]

async function get(path, params = []) {
  const query = new URLSearchParams([['project_token', TOKEN], ...params])

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${BASE}${path}?${query}`)

    if (response.ok) return { data: await response.json(), headers: response.headers }
    if (attempt === 3) throw new Error(`${response.status} ${path}`)
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
  }
}

async function forEachLimited(list, limit, fn) {
  let next = 0

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < list.length) await fn(list[next++])
    })
  )
}

// Perpendicular distance based simplification of one ring; keeps a ring at
// four points or more, so a small island never collapses.
function simplifyRing(points) {
  if (points.length <= 4) return points

  const keep = new Uint8Array(points.length)
  const stack = [[0, points.length - 1]]

  keep[0] = keep[points.length - 1] = 1

  while (stack.length) {
    const [a, b] = stack.pop()
    const [x1, y1] = points[a]
    const [x2, y2] = points[b]
    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy)
    let farthest = -1
    let index = -1

    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i]
      const d = length
        ? Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length
        : Math.hypot(x - x1, y - y1)

      if (d > farthest) {
        farthest = d
        index = i
      }
    }

    if (farthest > TOLERANCE) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }

  const kept = points.filter((_, i) => keep[i])

  return kept.length >= 4 ? kept : points
}

const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS

function simplify(geometry) {
  if (!geometry) return geometry

  const ring = (points) => simplifyRing(points).map(([x, y]) => [round(x), round(y)])

  switch (geometry.type) {
    case 'Polygon':
      return { type: 'Polygon', coordinates: geometry.coordinates.map(ring) }
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) => polygon.map(ring))
      }
    case 'GeometryCollection':
      return { type: 'GeometryCollection', geometries: geometry.geometries.map(simplify) }
    case 'Point':
      return { type: 'Point', coordinates: geometry.coordinates.slice(0, 2).map(round) }
    default:
      return geometry
  }
}

// Every page of an index request.
async function getAll(path, params = []) {
  const first = await get(path, [...params, ['per', PER], ['page', 1]])
  const pages = Number(first.headers.get('pagination-total-pages')) || 1
  const all = [...first.data]
  const rest = Array.from({ length: pages - 1 }, (_, i) => i + 2)

  await forEachLimited(rest, PARALLEL, async (page) => {
    all.push(...(await get(path, [...params, ['per', PER], ['page', page]])).data)
  })

  return all
}

async function getByIds(path, param, ids, extra = []) {
  const batches = []

  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100))

  const all = []

  await forEachLimited(batches, PARALLEL, async (batch) => {
    all.push(...(await getAll(path, [...batch.map((id) => [param, id]), ...extra])))
  })

  return all
}

// 1. Every shape the project's asserted distributions use.
const shapes = new Set(
  (await getAll('/asserted_distributions')).map(
    (ad) => `${ad.asserted_distribution_shape_type}/${ad.asserted_distribution_shape_id}`
  )
)

console.log(`${shapes.size} shapes used by distributions`)

// 2. Areas of collecting events of determined collection objects without a
// georeference. No distribution may use such an area, and TaxonWorks returns
// an area's shape only with a distribution or inside an OTU's
// distribution.geojson: so for each area not covered yet, Map<key, otuId> of
// an OTU whose map has it.
const unplacedIds = (await getAll('/dwc_occurrences', [['dwc_occurrence_object_type', 'CollectionObject']]))
  .filter((row) => !row.footprintWKT && (row.decimalLatitude == null || row.decimalLatitude === ''))
  .map((row) => row.dwc_occurrence_object_id)
const objects = await getByIds('/collection_objects', 'collection_object_id[]', unplacedIds, [
  ['extend[]', 'taxon_determinations']
])
const otuByEvent = new Map()

for (const co of objects) {
  const determination = (co.taxon_determinations || []).find((td) => td.otu_id)

  if (co.collecting_event_id && determination) otuByEvent.set(co.collecting_event_id, determination.otu_id)
}

const events = await getByIds('/collecting_events', 'collecting_event_id[]', [...otuByEvent.keys()])
const specimenAreas = new Map()

for (const ce of events) {
  const key = `GeographicArea/${ce.geographic_area_id}`

  if (ce.geographic_area_id && !shapes.has(key)) specimenAreas.set(key, otuByEvent.get(ce.id))
}

console.log(
  `${unplacedIds.length} collection objects without a georeference, ` +
    `${otuByEvent.size} collecting events of determined ones; ` +
    `${specimenAreas.size} of their areas used by no distribution`
)

const knownWithoutShape = new Set(
  !REFRESH && existsSync(WITHOUT_SHAPE_FILE) ? JSON.parse(readFileSync(WITHOUT_SHAPE_FILE, 'utf8')) : []
)
const todo = [...shapes, ...specimenAreas.keys()].filter(
  (key) => REFRESH || (!existsSync(`${OUT_DIR}${key}.json`) && !knownWithoutShape.has(key))
)

console.log(`${shapes.size + specimenAreas.size} shapes in use, ${todo.length} to fetch`)

let done = 0
let written = 0
const failed = []
const withoutShape = new Set(
  [...knownWithoutShape].filter((key) => shapes.has(key) || specimenAreas.has(key))
)
const otuMaps = new Map() // otuId -> Promise<features>

// The geometry of a shape: from one distribution with it, or, for an area
// only specimens use, from the distribution.geojson of an OTU that has it
// (slow, 1 to 15 s, but only once per area). Undefined: not found at all.
async function fetchGeometry(type, id, key) {
  if (!specimenAreas.has(key)) {
    const { data } = await get('/asserted_distributions', [
      ['geo_shape_id[]', id],
      ['geo_shape_type[]', type],
      ['per', 1],
      ['extend[]', 'geo_json']
    ])

    if (!data[0]) return undefined

    // The filter matches the exact shape (checked 2026-11-06), but a wrong
    // outline must never be stored, so this is verified on every record.
    if (
      data[0].asserted_distribution_shape_type !== type ||
      String(data[0].asserted_distribution_shape_id) !== String(id)
    ) {
      throw new Error(`asked for ${type} ${id}, got ${data[0].asserted_distribution_shape_type} ${data[0].asserted_distribution_shape_id}`)
    }

    return data[0].asserted_distribution_shape?.geo_json?.geometry ?? null
  }

  const otuId = specimenAreas.get(key)

  if (!otuMaps.has(otuId)) {
    otuMaps.set(
      otuId,
      get(`/otus/${otuId}/inventory/distribution.geojson`).then(({ data }) => data.features || [])
    )
  }

  const feature = (await otuMaps.get(otuId)).find(
    (f) => f.properties?.shape?.type === type && String(f.properties.shape.id) === String(id)
  )

  // Not on the map of an OTU with a specimen there: TaxonWorks has no shape
  // to draw it with, and leaves the specimen out, as the map then does too.
  return feature?.geometry ?? null
}

await forEachLimited(todo, PARALLEL, async (key) => {
  const [type, id] = key.split('/')

  try {
    const geometry = await fetchGeometry(type, id, key)

    if (geometry === undefined) throw new Error('not found')

    if (!geometry) {
      withoutShape.add(key)
      rmSync(`${OUT_DIR}${key}.json`, { force: true })
      return
    }

    mkdirSync(`${OUT_DIR}${type}`, { recursive: true })
    writeFileSync(`${OUT_DIR}${key}.json`, JSON.stringify(simplify(geometry)))
    written++
  } catch (error) {
    failed.push(`${key} (${error.message})`)
  }

  if (++done % 100 === 0) console.log(`  ${done}/${todo.length}`)
})

writeFileSync(WITHOUT_SHAPE_FILE, JSON.stringify([...withoutShape].sort()) + '\n')

console.log(
  `${written} shapes written to public/map-shapes/, ` +
    `${withoutShape.size} areas without a shape listed in without-shape.json`
)
if (failed.length) console.log(`failed (fetched live by the map): ${failed.join(', ')}`)
