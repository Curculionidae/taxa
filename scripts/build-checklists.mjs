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

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PER = 500
const PARALLEL = 6
const OUT_DIR = fileURLToPath(new URL('../public/checklists/', import.meta.url))
const COUNTRY_DIR = `${OUT_DIR}countries/`
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
    unplaced.taxa.add(row.otu_id)
    continue
  }

  const record = {}
  for (const key of KEEP) {
    const value = classification[key]
    if (value !== '' && value != null) record[key] = value
  }
  const checklist = checklistOf.get(id)
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

rmSync(COUNTRY_DIR, { recursive: true, force: true })
mkdirSync(COUNTRY_DIR, { recursive: true })
const index = []
for (const [id, records] of byCountry) {
  const { name, iso2, ids } = checklistOf.get(id)
  writeFileSync(`${COUNTRY_DIR}${id}.json`, JSON.stringify(records))
  index.push({ id, name, iso2, areas: ids, taxa: new Set(records.map((record) => record.otu_id)).size, records: records.length })
}
index.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(`${OUT_DIR}index.json`, JSON.stringify({
  updated: new Date().toISOString().slice(0, 10),
  countries: index,
  unplaced: { records: unplaced.records, taxa: unplaced.taxa.size }
}, null, 1))

console.log(`${index.length} countries written, ${readdirSync(COUNTRY_DIR).length} files`)
console.log(`unplaced: ${unplaced.records} records of ${unplaced.taxa.size} taxa`)
