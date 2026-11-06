// Checks panels/PanelMapV2/lib/fastDistribution.js against TaxonWorks'
// distribution.geojson (+ distribution_is_absent.geojson) for some OTUs:
// times both, and compares every feature (ids, labels, shapes, targets,
// absent flag). Shapes come from public/map-shapes/, live when missing.
//
//   node scripts/compare-map-distribution.mjs 729972 723601 [--synonym]

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadFastDistribution } from '../panels/PanelMapV2/lib/fastDistribution.js'

const apiConfig = readFileSync(new URL('../config/api.yml', import.meta.url), 'utf8')
const BASE = apiConfig.match(/^\s*url:\s*['"]?([^'"\s]+)/m)[1]
const TOKEN = apiConfig.match(/^\s*project_token:\s*['"]?([^'"\s]+)/m)[1]
const SHAPES = fileURLToPath(new URL('../public/map-shapes/', import.meta.url))

const isSynonym = process.argv.includes('--synonym')
const otuIds = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number)

async function get(path, params = []) {
  const query = new URLSearchParams([['project_token', TOKEN], ...params])
  const response = await fetch(`${BASE}${path}?${query}`)

  if (!response.ok) throw new Error(`${response.status} ${path}`)

  return { data: await response.json(), headers: response.headers }
}

let liveShapes = 0
const withoutShape = new Set(JSON.parse(readFileSync(`${SHAPES}without-shape.json`, 'utf8')))

async function loadShape(type, id) {
  const file = `${SHAPES}${type}/${id}.json`

  if (withoutShape.has(`${type}/${id}`)) return null
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))

  liveShapes++
  const { data } = await get('/asserted_distributions', [
    ['geo_shape_id[]', id],
    ['geo_shape_type[]', type],
    ['per', 1],
    ['extend[]', 'geo_json']
  ])

  // Same as the map's lib/shapeCache.js: no distribution with this shape
  // means it can't be loaded, which makes the fast path decline.
  if (!data[0]) throw new Error(`No distribution with ${type} ${id}`)

  return data[0].asserted_distribution_shape?.geo_json?.geometry ?? null
}

const key = (f) => `${f.properties.base.type}:${f.properties.base.id}`
const isSpecimen = (f) => ['CollectionObject', 'FieldOccurrence'].includes(f.properties.base.type)
// A specimen's label only shows when its target has none, which never
// happens here, so only its presence is compared.
const describe = (f) => ({
  label: isSpecimen(f) ? Boolean(f.properties.base.label) : f.properties.base.label,
  shape: f.properties.base.type === 'AssertedDistribution' || f.properties.shape.type !== 'Georeference'
    ? `${f.properties.shape.type}:${f.properties.shape.id}`
    : 'Georeference',
  target: f.properties.target?.id,
  targetLabel: f.properties.target?.label,
  absent: Boolean(f.properties.is_absent)
})

for (const otuId of otuIds) {
  liveShapes = 0
  const { data: otu } = await get(`/otus/${otuId}`)
  const { data: name } = otu.taxon_name_id
    ? await get(`/taxon_names/${otu.taxon_name_id}`)
    : { data: {} }

  let t0 = performance.now()
  const fast = await loadFastDistribution({
    otuId,
    taxonNameId: otu.taxon_name_id,
    validTaxonNameId: name.cached_valid_taxon_name_id,
    isSynonym,
    get,
    loadShape
  })
  const fastMs = performance.now() - t0

  t0 = performance.now()
  const params = isSynonym ? [['coordinate_otus', 'false']] : []
  const [present, absent] = await Promise.all([
    get(`/otus/${otuId}/inventory/distribution.geojson`, params),
    get(`/otus/${otuId}/inventory/distribution_is_absent.geojson`, params)
  ])
  const slowMs = performance.now() - t0

  if (!fast) {
    console.log(`OTU ${otuId}: fast path declined (falls back); slow ${(slowMs / 1000).toFixed(1)} s`)
    continue
  }

  const slow = [...present.data.features, ...(absent.data.features || [])]
  const typeMaterial = slow.filter((f) => f.properties.base.type === 'TypeMaterial')
  const slowByKey = new Map(slow.filter((f) => f.properties.base.type !== 'TypeMaterial').map((f) => [key(f), f]))
  const fastByKey = new Map(fast.map((f) => [key(f), f]))

  const onlySlow = [...slowByKey.keys()].filter((k) => !fastByKey.has(k))
  const onlyFast = [...fastByKey.keys()].filter((k) => !slowByKey.has(k))
  const differ = []

  for (const [k, f] of fastByKey) {
    const s = slowByKey.get(k)

    if (!s) continue
    const a = describe(f)
    const b = describe(s)

    for (const field of Object.keys(a)) {
      if (a[field] !== b[field]) differ.push(`${k} ${field}: fast ${JSON.stringify(a[field])} / geojson ${JSON.stringify(b[field])}`)
    }
  }

  // Which specimens share a marker: same groups on both maps.
  const groups = (features) => {
    const byShape = new Map()

    for (const f of features.filter(isSpecimen)) {
      const k = `${f.properties.shape.type}:${f.properties.shape.id}`

      byShape.set(k, [...(byShape.get(k) || []), key(f)])
    }

    return new Set([...byShape.values()].map((list) => list.sort().join(' + ')))
  }
  const slowGroups = groups([...slowByKey.values()])
  const fastGroups = groups([...fastByKey.values()])
  const groupDiffer = [...slowGroups].filter((g) => !fastGroups.has(g))

  groupDiffer.slice(0, 4).forEach((g) => differ.push(`marker grouping in geojson not matched: ${g}`))

  const ok = !onlySlow.length && !onlyFast.length && !differ.length

  console.log(
    `OTU ${otuId}: ${ok ? 'MATCH' : 'DIFFERENT'}, ${fastByKey.size} features ` +
      `(geojson ${slowByKey.size} + ${typeMaterial.length} TypeMaterial left to the store); ` +
      `${slowGroups.size} specimen markers; ` +
      `fast ${(fastMs / 1000).toFixed(1)} s (${liveShapes} shapes live), slow ${(slowMs / 1000).toFixed(1)} s`
  )
  if (onlySlow.length) console.log(`   only in geojson: ${onlySlow.join(', ')}`)
  if (onlyFast.length) console.log(`   only in fast: ${onlyFast.join(', ')}`)
  differ.slice(0, 8).forEach((d) => console.log(`   ${d}`))
}
