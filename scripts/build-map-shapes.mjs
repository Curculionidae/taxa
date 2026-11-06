// Builds public/map-shapes/: one file per shape (GeographicArea or Gazetteer)
// that any asserted distribution of the project uses, as a plain GeoJSON
// geometry, simplified for display. PanelMapV2 reads these instead of waiting
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

// Every shape the project's asserted distributions use.
const first = await get('/asserted_distributions', [['per', PER], ['page', 1]])
const pages = Number(first.headers.get('pagination-total-pages')) || 1
const shapes = new Set()
const collect = (list) =>
  list.forEach((ad) =>
    shapes.add(`${ad.asserted_distribution_shape_type}/${ad.asserted_distribution_shape_id}`)
  )

collect(first.data)

const pageNumbers = Array.from({ length: pages - 1 }, (_, i) => i + 2)

await forEachLimited(pageNumbers, PARALLEL, async (page) => {
  collect((await get('/asserted_distributions', [['per', PER], ['page', page]])).data)
})

const knownWithoutShape = new Set(
  !REFRESH && existsSync(WITHOUT_SHAPE_FILE) ? JSON.parse(readFileSync(WITHOUT_SHAPE_FILE, 'utf8')) : []
)
const todo = [...shapes].filter(
  (key) => REFRESH || (!existsSync(`${OUT_DIR}${key}.json`) && !knownWithoutShape.has(key))
)

console.log(`${shapes.size} shapes in use, ${todo.length} to fetch`)

let done = 0
const failed = []
const withoutShape = new Set([...knownWithoutShape].filter((key) => shapes.has(key)))

await forEachLimited(todo, PARALLEL, async (key) => {
  const [type, id] = key.split('/')

  try {
    // One distribution with this shape, its geometry included.
    const { data } = await get('/asserted_distributions', [
      ['geo_shape_id[]', id],
      ['geo_shape_type[]', type],
      ['per', 1],
      ['extend[]', 'geo_json']
    ])
    const geometry = data[0]?.asserted_distribution_shape?.geo_json?.geometry

    if (!data[0]) throw new Error('no distribution with this shape')

    if (!geometry) {
      withoutShape.add(key)
      rmSync(`${OUT_DIR}${key}.json`, { force: true })
      return
    }

    mkdirSync(`${OUT_DIR}${type}`, { recursive: true })
    writeFileSync(`${OUT_DIR}${key}.json`, JSON.stringify(simplify(geometry)))
  } catch (error) {
    failed.push(`${key} (${error.message})`)
  }

  if (++done % 100 === 0) console.log(`  ${done}/${todo.length}`)
})

writeFileSync(WITHOUT_SHAPE_FILE, JSON.stringify([...withoutShape].sort()) + '\n')

console.log(
  `${todo.length - failed.length - withoutShape.size + knownWithoutShape.size} shapes written to ` +
    `public/map-shapes/, ${withoutShape.size} areas without a shape listed in without-shape.json`
)
if (failed.length) console.log(`failed (fetched live by the map): ${failed.join(', ')}`)
