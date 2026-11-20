// Does the curator page decide exactly like the build (R37)?
//
// Builds the engine context the browser way, from the cache files only
// (placement/geometry-browser.js, loadCacheContext, with a fetchJson that
// reads public/ from disk instead of fetching it), and checks that it
// reproduces the cached placements:
//   - every area in areas.json (checklist, part, state, outline, reason and
//     every step), with the Area made from the saved TaxonWorks data as the
//     live lookup makes it from the API (toArea of asserted_distribution_shape);
//   - 200 specimens and field occurrences of the country files (checklist, part,
//     state): 100 spread over all of them, 100 placed by their coordinates
//     (no DwC country), which exercise the outlines; their RecordInput is made
//     with live.js recordFromDwc from the saved DwC rows;
//   - the specimens unplaced for their coordinates (unplaced.json), same reason.
// Needs the saved data of `npm run checklists -- --save` in
// modules/checklists/.cache/data and a cache built from it; skipped without them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCacheContext } from '../placement/geometry-browser.js'
import { placeRecord } from '../placement/engine.js'
import { toArea } from '../placement/areas.js'
import { recordFromDwc } from '../placement/live.js'
import { expandChecklist } from '../data/compact.js'
import { assignKeys, publicPlacement } from './cacheFiles.mjs'
import { parseTsv } from './download.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const PUBLIC = join(ROOT, 'public/')
const DATA = join(ROOT, 'modules/checklists/.cache/data/')
const ready = existsSync(join(PUBLIC, 'checklists/context.json')) && existsSync(join(DATA, 'distributions.json'))
const skip = ready ? false : 'needs modules/checklists/.cache/data and public/checklists/context.json'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
// The browser's fetchJson, reading the same files from disk.
const fetchJson = async (path) => {
  const file = join(PUBLIC, path)
  if (!existsSync(file)) throw new Error(`could not load ${path} (404)`)
  return readJson(file)
}

const KIND = { CollectionObject: 'CO', FieldOccurrence: 'FO' }

test('browser context reproduces every area placement of areas.json', { skip }, async () => {
  const { ctx } = await loadCacheContext({ fetchJson })
  const keys = assignKeys(ctx.checklists)
  const areas = new Map()
  for (const ad of readJson(join(DATA, 'distributions.json'))) {
    if (!ad.asserted_distribution_shape) continue
    const area = toArea(ad.asserted_distribution_shape_type, ad.asserted_distribution_shape)
    if (!areas.has(area.key)) areas.set(area.key, area)
  }
  const rows = readJson(join(PUBLIC, 'checklists/areas.json')).filter((row) => row.placement)
  const differ = []
  for (const row of rows) {
    const placement = publicPlacement(await placeRecord({ type: 'AssertedDistribution', id: 0 }, ctx, areas.get(row.key)), keys)
    if (JSON.stringify(placement) !== JSON.stringify(row.placement)) differ.push(row.key)
  }
  console.log(`areas: ${rows.length} compared, ${differ.length} differ`)
  assert.deepEqual(differ, [])
  assert.ok(rows.length > 2000)
})

test('browser context reproduces 200 specimen placements of the country files and the coordinate reasons of unplaced.json', { skip }, async () => {
  const { ctx } = await loadCacheContext({ fetchJson })
  const dwcRows = new Map()
  for (const row of parseTsv(readFileSync(join(DATA, 'dwc_occurrences.csv'), 'utf8'))) {
    const kind = KIND[row.dwc_occurrence_object_type]
    if (kind) dwcRows.set(`${kind} ${Number(row.dwc_occurrence_object_id)}`, row)
  }

  // What the cache says: checklist, part and state of every listed specimen.
  const cached = new Map()
  for (const entry of readJson(join(PUBLIC, 'checklists/index.json')).countries) {
    for (const record of expandChecklist(readJson(join(PUBLIC, 'checklists/countries', entry.file)))) {
      const kind = KIND[record.dwc_occurrence_object_type]
      if (kind) cached.set(`${kind} ${Number(record.dwc_occurrence_object_id)}`, { checklist: entry.name, part: record.part ?? null, state: record.state ?? null })
    }
  }
  const spread = (list, n) => list.filter((_, index) => index % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n)
  const all = [...cached.keys()].sort()
  const byCoordinates = all.filter((key) => {
    const row = dwcRows.get(key)
    return row && !String(row.country ?? '').trim() && String(row.decimalLatitude ?? '').trim()
  })
  const coordinateSample = spread(byCoordinates, 100)
  const taken = new Set(coordinateSample)
  const sample = [...coordinateSample, ...spread(all.filter((key) => !taken.has(key)), 200 - coordinateSample.length)]

  const place = (key) => {
    const [kind, id] = key.split(' ')
    const type = kind === 'CO' ? 'CollectionObject' : 'FieldOccurrence'
    return placeRecord(recordFromDwc(type, Number(id), dwcRows.get(key)), ctx)
  }
  const differ = []
  for (const key of sample) {
    const placement = await place(key)
    const got = { checklist: placement.checklist?.name ?? null, part: placement.part, state: placement.state }
    if (JSON.stringify(got) !== JSON.stringify(cached.get(key))) differ.push(`${key}: ${JSON.stringify(got)} vs ${JSON.stringify(cached.get(key))}`)
  }

  const unplaced = Object.entries(readJson(join(PUBLIC, 'checklists/unplaced.json')))
    .filter(([reason]) => reason.startsWith('coordinates'))
    .flatMap(([reason, ids]) => ids.map(([kind, id]) => ({ key: `${kind} ${id}`, reason })))
  for (const { key, reason } of unplaced) {
    const placement = await place(key)
    if (placement.reason !== reason) differ.push(`${key}: ${placement.reason} vs ${reason}`)
  }
  console.log(`specimens: ${sample.length} compared (${coordinateSample.length} by coordinates of ${byCoordinates.length}), ${unplaced.length} unplaced by coordinates, ${differ.length} differ`)
  assert.deepEqual(differ, [])
  assert.equal(sample.length, 200)
})

test('the built cache: Norfolk Island drawn from Natural Earth, GZ 10458 in it, Alabama under the United States (R44, R49)', { skip }, () => {
  const index = readJson(join(PUBLIC, 'checklists/index.json'))
  const norfolk = index.countries.find((country) => country.name === 'Norfolk Island')
  assert.equal(norfolk.shape, null)
  assert.equal(norfolk.fallback, 'Norfolk Island')
  const rows = new Map(readJson(join(PUBLIC, 'checklists/areas.json')).map((row) => [row.key, row]))
  assert.equal(rows.get('GZ 10458').placement.checklist.name, 'Norfolk Island')
  assert.equal(rows.get('GZ 10458').placement.shape.key, 'fallback/Norfolk Island')
  assert.equal(rows.get('GA 34374').placement.checklist.name, 'Australia', 'Lord Howe I. stays Australia')
  assert.deepEqual(rows.get('GA 26688').ancestors, ['GA 237'])
})
