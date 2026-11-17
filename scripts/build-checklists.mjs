// Builds public/checklists/: the data of the country checklists page
// (pages/checklists.vue), so a visitor loads one small file per country
// instead of paging through the project's 80,000 DwC occurrences.
//
//   index.json             updated date, every country with its taxon count
//   countries/<id>.json    the records of one country (<id> is the country's
//                          TaxonWorks GeographicArea id, its level0_id)
//
// Run with `npm run checklists` (about 2 minutes).
//
// Why not page /dwc_occurrences: that index has no ORDER BY, so pages overlap
// and about 5% of the rows are missed or doubled on every full download
// (measured 2026-11-17). /dwc_occurrences.csv returns everything in one
// request. /asserted_distributions is ordered by id, so it pages safely.
//
// Which country a record belongs to:
// - asserted distribution: its area's level0_id (a GeographicArea and every
//   subdivision of it carry their country's id); a Gazetteer by its ISO 3166
//   alpha-2 code; otherwise by the DwC `country` text. Gazetteers never get a
//   DwC country (TaxonWorks), so this places most of them that DwC can't.
// - collection object / field occurrence: the DwC `country` text, matched to
//   a country by name.
// Records that end up without a country are counted in index.json
// (`unplaced`) and left out.
//
// Only taxa of Curculionoidea at species rank and below, present (not absent)
// records. Field occurrences come without classification in the DwC export,
// so their classification is taken from the OTU's parents.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PER = 500
const PARALLEL = 6
const OUT_DIR = fileURLToPath(new URL('../public/checklists/', import.meta.url))
const COUNTRY_DIR = `${OUT_DIR}countries/`
const SHAPE_DIR = fileURLToPath(new URL('../public/map-shapes/', import.meta.url))
const FALLBACK_FILE = `${OUT_DIR}fallback-shapes.geojson`
// ISO codes of countries whose TaxonWorks area has none (for the flag).
const EXTRA_ISO = JSON.parse(readFileSync(new URL('./data/country-iso.json', import.meta.url), 'utf8'))
const SUPERFAMILY = 'Curculionoidea'
const RANKS = new Set(['species', 'subspecies'])

const apiConfig = readFileSync(new URL('../config/api.yml', import.meta.url), 'utf8')
const BASE = apiConfig.match(/^\s*url:\s*['"]?([^'"\s]+)/m)[1]
const TOKEN = apiConfig.match(/^\s*project_token:\s*['"]?([^'"\s]+)/m)[1]

async function request(path, params = []) {
  const query = new URLSearchParams([['project_token', TOKEN], ...params])
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${BASE}${path}?${query}`)
    if (response.ok) return response
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

// Tab-separated, fields optionally in double quotes ("" escapes a quote).
function parseTsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === '\t') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows
  return body.map((values) => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ''])))
}

const normalize = (name) => String(name || '').trim().toLocaleLowerCase()

// 1. Every DwC occurrence, in one request.
console.log('Downloading /dwc_occurrences.csv …')
const rows = parseTsv(await (await request('/dwc_occurrences.csv')).text())
console.log(`${rows.length} occurrences`)

// 2. Every asserted distribution with its area and citations.
const first = await request('/asserted_distributions', [['per', PER], ['page', 1], ['extend[]', 'asserted_distribution_shape']])
const pages = Number(first.headers.get('pagination-total-pages')) || 1
const distributions = new Map()
const addDistributions = (list) => { for (const ad of list) distributions.set(String(ad.id), ad) }
addDistributions(await first.json())
await forEachLimited(Array.from({ length: pages - 1 }, (_, i) => i + 2), PARALLEL, async (page) => {
  addDistributions(await (await request('/asserted_distributions', [
    ['per', PER], ['page', page], ['extend[]', 'asserted_distribution_shape']
  ])).json())
})
const expected = Number(first.headers.get('pagination-total'))
if (distributions.size !== expected) throw new Error(`got ${distributions.size} of ${expected} distributions`)
console.log(`${distributions.size} asserted distributions`)

// 3. Countries: id -> name, plus lookups by ISO code and by name.
const countries = new Map() // level0 id -> { id, name, iso2 }
const countryByIso = new Map()
const countryByName = new Map()
const subdivisionNames = new Map() // level1 id -> name
for (const ad of distributions.values()) {
  const shape = ad.asserted_distribution_shape
  if (ad.asserted_distribution_shape_type !== 'GeographicArea' || !shape) continue
  if (shape.level0_id && shape.id === shape.level0_id) {
    countries.set(shape.level0_id, { id: shape.level0_id, name: shape.name, iso2: shape.iso_3166_a2 || '' })
    if (shape.iso_3166_a2) countryByIso.set(shape.iso_3166_a2.toUpperCase(), shape.level0_id)
    countryByName.set(normalize(shape.name), shape.level0_id)
  }
  if (shape.level1_id && shape.id === shape.level1_id) subdivisionNames.set(shape.level1_id, shape.name)
}
// A country used only through its subdivisions: name it by the DwC country
// text of those records.
const dwcByDistribution = new Map(
  rows.filter((row) => row.dwc_occurrence_object_type === 'AssertedDistribution')
    .map((row) => [String(row.dwc_occurrence_object_id), row])
)
for (const ad of distributions.values()) {
  const shape = ad.asserted_distribution_shape
  const level0 = shape?.level0_id
  if (ad.asserted_distribution_shape_type !== 'GeographicArea' || !level0 || countries.has(level0)) continue
  const name = dwcByDistribution.get(String(ad.id))?.country
  if (!name) continue
  countries.set(level0, { id: level0, name, iso2: '' })
  if (!countryByName.has(normalize(name))) countryByName.set(normalize(name), level0)
}
// The DwC country text of distributions placed by level0 is also a name of
// that country (catches spelling differences between the two).
for (const ad of distributions.values()) {
  const level0 = ad.asserted_distribution_shape?.level0_id
  const name = dwcByDistribution.get(String(ad.id))?.country
  if (level0 && name && !countryByName.has(normalize(name))) countryByName.set(normalize(name), level0)
}
// TaxonWorks has several country-level areas for some countries (from
// different gazetteers, often one without ISO code, spelled differently).
// They are merged into one checklist under one name; its id is the area with
// an ISO code when there is one.
const ALIASES = {
  'bosnia and herz.': 'Bosnia and Herzegovina',
  'cayman is.': 'Cayman Islands',
  'dem. rep. korea': 'North Korea',
  korea: 'South Korea',
  'eq. guinea': 'Equatorial Guinea',
  'faeroe is.': 'Faroe Islands',
  'lao pdr': 'Laos',
  macedonia: 'North Macedonia',
  'são tomé and principe': 'Sao Tome and Principe',
  'solomon is.': 'Solomon Islands',
  'st. kitts and nevis': 'Saint Kitts and Nevis',
  'st. vin. and gren.': 'Saint Vincent and the Grenadines',
  'u.s. virgin is.': 'Virgin Islands, U.S.',
  'united republic of tanzania': 'Tanzania',
  'viet nam': 'Vietnam',
  'saint martin (french part)': 'Saint Martin',
  'w. sahara': 'Western Sahara'
}
const canonicalName = (name) => ALIASES[normalize(name)] || name
const merged = new Map() // canonical key -> { id, name, iso2, ids }
for (const country of countries.values()) {
  const name = canonicalName(country.name)
  const key = normalize(name)
  if (!merged.has(key)) merged.set(key, { id: country.id, name, iso2: '', ids: [] })
  const entry = merged.get(key)
  entry.ids.push(country.id)
  if (country.iso2 && !entry.iso2) Object.assign(entry, { id: country.id, iso2: country.iso2 })
}
const checklistOf = new Map() // level0 id -> merged entry
for (const entry of merged.values()) for (const id of entry.ids) checklistOf.set(id, entry)
console.log(`${countries.size} country areas, ${merged.size} countries`)

// Overseas parts TaxonWorks files under a country (French Guiana is a
// subdivision of France there) get a checklist of their own, and their parts
// are cut out of the country's outline on the map. A record goes to one when
// its area, place or province names it, or its coordinates fall in the box.
// The page groups them under their country (ASSOCIATED_AREAS_BY_SOVEREIGN).
const SEPARATE = [
  { name: 'French Guiana', iso2: 'GF', of: 'France', match: /french guiana|guyane/i, box: [-55, 1.8, -51, 6.2] },
  { name: 'Guadeloupe', iso2: 'GP', of: 'France', match: /guadeloupe|\bglp-/i, box: [-62, 15.7, -60.8, 16.6] },
  { name: 'Martinique', iso2: 'MQ', of: 'France', match: /martinique|\bmrt-/i, box: [-61.3, 14.3, -60.7, 15] },
  { name: 'Réunion', iso2: 'RE', of: 'France', match: /r[ée]union|\breu-/i, box: [55.1, -21.5, 56, -20.8] },
  { name: 'Mayotte', iso2: 'YT', of: 'France', match: /mayotte|\bmay-/i, box: [44.9, -13.1, 45.4, -12.5] }
]
const subdivisionIdByName = new Map() // level1 name -> level1 id (shape)
for (const ad of distributions.values()) {
  const shape = ad.asserted_distribution_shape
  if (shape?.level1_id && shape.id === shape.level1_id) subdivisionIdByName.set(normalize(shape.name), shape.level1_id)
}
for (const area of SEPARATE) {
  const key = normalize(area.name)
  const level1 = [...subdivisionIdByName].find(([name]) => area.match.test(name))?.[1]
  if (!merged.has(key)) merged.set(key, { id: level1 || area.iso2, name: area.name, iso2: area.iso2, ids: level1 ? [level1] : [] })
  const entry = merged.get(key)
  Object.assign(entry, { name: area.name, iso2: area.iso2, separate: area })
  if (level1 && !entry.ids.includes(level1)) entry.ids.push(level1)
  checklistOf.set(entry.id, entry)
  for (const id of entry.ids) checklistOf.set(id, entry)
}
const separateOf = (checklist, row, place, region) => {
  const text = [region, place, row.stateProvince, row.county].filter(Boolean).join(' | ')
  const lat = Number.parseFloat(row.decimalLatitude)
  const lng = Number.parseFloat(row.decimalLongitude)
  const area = SEPARATE.find(({ of, match, box }) => of === checklist.name && (
    match.test(text) ||
    (Number.isFinite(lat) && Number.isFinite(lng) && lng >= box[0] && lat >= box[1] && lng <= box[2] && lat <= box[3])
  ))
  return area ? merged.get(normalize(area.name)) : checklist
}

// 4. Classification of OTUs the DwC export leaves without one (field
// occurrences): from the OTU's parents, by name endings.
const RANK_ENDINGS = [
  ['superfamily', /oidea$/], ['family', /idae$/], ['subfamily', /inae$/],
  ['tribe', /ini$/], ['subtribe', /ina$/]
]
const missing = [...new Set(rows
  .filter((row) => !row.superfamily && row.otu_id && RANKS.has(row.taxonRank))
  .map((row) => row.otu_id))]
const parentClassification = new Map()
await forEachLimited(missing, PARALLEL, async (otuId) => {
  try {
    const { parents } = await (await request(`/otus/${otuId}`, [['extend[]', 'parents']])).json()
    const names = Object.keys(parents || {})
    const classification = {}
    for (const name of names) {
      for (const [rank, ending] of RANK_ENDINGS) if (ending.test(name)) classification[rank] = name
    }
    parentClassification.set(otuId, classification)
  } catch {
    parentClassification.set(otuId, {})
  }
})
console.log(`${missing.length} OTUs classified from their parents`)

// 5. Assign, filter and write.
const KEEP = [
  'id', 'dwc_occurrence_object_type', 'dwc_occurrence_object_id', 'otu_id', 'country',
  'stateProvince', 'county', 'municipality', 'verbatimLocality', 'scientificName',
  'scientificNameAuthorship', 'taxonRank', 'basisOfRecord', 'institutionCode',
  'catalogNumber', 'recordedBy', 'eventDate', 'verbatimEventDate', 'occurrenceID',
  'associatedReferences', 'superfamily', 'family', 'subfamily', 'tribe', 'subtribe', 'genus'
]
const byCountry = new Map()
// A taxon is its name: several OTUs of one name count once (as on the page).
const taxonKey = (record) => `${record.scientificName || ''} ${record.scientificNameAuthorship || ''}`.trim().toLocaleLowerCase() || String(record.otu_id)
const unplaced = { records: 0, taxa: new Set() }

function countryOf(row) {
  if (row.dwc_occurrence_object_type === 'AssertedDistribution') {
    const ad = distributions.get(String(row.dwc_occurrence_object_id))
    const shape = ad?.asserted_distribution_shape
    if (shape?.level0_id && countries.has(shape.level0_id)) return { ad, id: shape.level0_id, region: subdivisionNames.get(shape.level1_id) || '' }
    const iso = shape?.iso_3166_a2?.toUpperCase()
    if (iso && countryByIso.has(iso)) return { ad, id: countryByIso.get(iso), region: '' }
    const id = countryByName.get(normalize(row.country))
    return id ? { ad, id, region: '' } : { ad }
  }
  const id = countryByName.get(normalize(row.country))
  return id ? { id, region: '' } : {}
}

for (const row of rows) {
  if (!RANKS.has(row.taxonRank) || !row.otu_id) continue
  if (normalize(row.occurrenceStatus) === 'absent') continue
  const classification = row.superfamily ? row : { ...row, ...parentClassification.get(row.otu_id) }
  if (!classification.genus) classification.genus = String(row.scientificName || '').split(' ')[0]
  if (classification.superfamily !== SUPERFAMILY) continue

  const { ad, id, region } = countryOf(row)
  if (ad?.is_absent) continue
  if (!id) {
    unplaced.records++
    unplaced.taxa.add(taxonKey(row))
    continue
  }

  const record = {}
  for (const key of KEEP) {
    const value = classification[key]
    if (value !== '' && value != null) record[key] = value
  }
  const checklist = separateOf(checklistOf.get(id), row, ad?.asserted_distribution_shape?.name, region)
  record.country = checklist.name
  if (region) record.region = region
  if (ad) {
    record.place = ad.asserted_distribution_shape?.name || ''
    record.citations = (ad.citations || [])
      .map((citation) => ({ id: String(citation.id), full: citation.source?.name || '', pages: citation.pages || '' }))
      .filter((citation) => citation.full)
    delete record.associatedReferences
  }
  if (!byCountry.has(checklist.id)) byCountry.set(checklist.id, [])
  byCountry.get(checklist.id).push(record)
}

// Files are overwritten in place and only stale ones removed (recreating the
// folder makes a running dev server lose track of them).
mkdirSync(COUNTRY_DIR, { recursive: true })
const written = new Set([...byCountry.keys()].map((id) => `${id}.json`))
for (const file of readdirSync(COUNTRY_DIR)) if (!written.has(file)) rmSync(`${COUNTRY_DIR}${file}`)
const index = []
for (const [id, records] of byCountry) {
  const { name, iso2, ids } = checklistOf.get(id)
  writeFileSync(`${COUNTRY_DIR}${id}.json`, JSON.stringify(records))
  // The map draws the country from the species map's shape cache
  // (public/map-shapes/, npm run map-shapes).
  const shapeId = ids.find((area) => existsSync(`${SHAPE_DIR}GeographicArea/${area}.json`))
  // The country's outline without the parts that have a checklist of their own.
  const exclude = SEPARATE.filter((area) => area.of === name).map((area) => area.box)
  index.push({
    id, name, iso2: iso2 || EXTRA_ISO[name] || '', areas: ids,
    shape: shapeId ? `GeographicArea/${shapeId}` : null,
    ...(exclude.length ? { exclude } : {}),
    taxa: new Set(records.map(taxonKey)).size, records: records.length })
}
index.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(`${OUT_DIR}index.json`, JSON.stringify({
  updated: new Date().toISOString().slice(0, 10),
  countries: index,
  unplaced: { records: unplaced.records, taxa: unplaced.taxa.size }
}, null, 1))

console.log(`${index.length} countries written, ${readdirSync(COUNTRY_DIR).length} files`)

// A country no record uses directly (only its subdivisions) has no shape in
// the cache, and TaxonWorks only hands out a shape through a record using it.
// Those are drawn from fallback-shapes.geojson (Natural Earth outlines).
const fallback = new Set(JSON.parse(readFileSync(FALLBACK_FILE, 'utf8')).features.map((feature) => feature.properties.name))
const withoutShape = index.filter((country) => !country.shape && !fallback.has(country.name))
if (withoutShape.length) console.log(`not on the map (no cached or fallback shape): ${withoutShape.map((country) => country.name).join(', ')}`)
console.log(`unplaced: ${unplaced.records} records of ${unplaced.taxa.size} taxa`)
