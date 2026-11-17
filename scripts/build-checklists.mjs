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

// Retries HTTP errors and network failures; after the last try it throws,
// which stops the build: a half-built cache must never be written.
async function request(path, params = []) {
  const query = new URLSearchParams([['project_token', TOKEN], ...params])
  for (let attempt = 1; ; attempt++) {
    let failure
    try {
      const response = await fetch(`${BASE}${path}?${query}`)
      if (response.ok) return response
      failure = new Error(`${response.status} ${path}`)
    } catch (error) {
      failure = new Error(`${error.message} ${path}`)
    }
    if (attempt === 4) throw failure
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
  'w. sahara': 'Western Sahara',
  taaf: 'French Southern Territories'
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

// Every area some distribution uses, by id (GeographicArea only).
const areaById = new Map()
for (const ad of distributions.values()) {
  if (ad.asserted_distribution_shape_type === 'GeographicArea' && ad.asserted_distribution_shape) {
    areaById.set(ad.asserted_distribution_shape.id, ad.asserted_distribution_shape)
  }
}
// The areas a test picks, plus their children (TDWG level 4 under level 3,
// a commune under its department), as far as distributions use them.
function areaIds(test) {
  const ids = new Set([...areaById.values()].filter(test).map((area) => area.id))
  for (let grew = true; grew;) {
    grew = false
    for (const area of areaById.values()) {
      if (!ids.has(area.id) && ids.has(area.parent_id)) { ids.add(area.id); grew = true }
    }
  }
  return ids
}
const inBox = (row, box) => {
  const lat = Number.parseFloat(row.decimalLatitude)
  const lng = Number.parseFloat(row.decimalLongitude)
  return Number.isFinite(lat) && Number.isFinite(lng) && lng >= box[0] && lat >= box[1] && lng <= box[2] && lat <= box[3]
}
const cachedArea = (ids) => [...ids].find((id) => existsSync(`${SHAPE_DIR}GeographicArea/${id}.json`))

// Overseas departments TaxonWorks files under France, though each has an
// ISO 3166-1 code of its own: they get a checklist of their own and are cut
// out of France's outline. A record goes to one when its area is one of the
// department's areas (named like it, or a child of one), a gazetteer carries
// its ISO code, or the record's DwC country, province, place or coordinates
// name it. The page lists them under France (ASSOCIATED_AREAS_BY_SOVEREIGN).
const SEPARATE = [
  { name: 'French Guiana', iso2: 'GF', of: 'France', match: /french guiana|guyane/i, box: [-55, 1.8, -51, 6.2] },
  { name: 'Guadeloupe', iso2: 'GP', of: 'France', match: /guadeloupe|\bglp-/i, box: [-62, 15.7, -60.8, 16.6] },
  { name: 'Martinique', iso2: 'MQ', of: 'France', match: /martinique|\bmrt-/i, box: [-61.3, 14.3, -60.7, 15] },
  { name: 'Réunion', iso2: 'RE', of: 'France', match: /r[ée]union|\breu-/i, box: [55.1, -21.5, 56, -20.8] },
  { name: 'Mayotte', iso2: 'YT', of: 'France', match: /mayotte|\bmay-/i, box: [44.9, -13.1, 45.4, -12.5] }
]
for (const area of SEPARATE) {
  area.ids = areaIds((shape) => area.match.test(shape.name))
  const key = normalize(area.name)
  const outline = cachedArea(area.ids)
  if (!merged.has(key)) merged.set(key, { id: outline || [...area.ids][0] || area.iso2, name: area.name, iso2: area.iso2, ids: [] })
  const entry = merged.get(key)
  Object.assign(entry, { name: area.name, iso2: area.iso2, separate: area })
  for (const id of area.ids) if (!entry.ids.includes(id)) entry.ids.push(id)
  checklistOf.set(entry.id, entry)
  for (const id of entry.ids) checklistOf.set(id, entry)
}
function separateOf(row, ad) {
  const shape = ad?.asserted_distribution_shape
  const onArea = ad?.asserted_distribution_shape_type === 'GeographicArea' && shape
  const text = [shape?.name, row.country, row.stateProvince, row.county].filter(Boolean).join(' | ')
  const area = SEPARATE.find((candidate) => (
    (onArea && candidate.ids.has(shape.id)) ||
    shape?.iso_3166_a2?.toUpperCase() === candidate.iso2 ||
    candidate.match.test(text) ||
    inBox(row, candidate.box)
  ))
  return area ? merged.get(normalize(area.name)) : null
}

// Parts of a country that can be selected on their own (the page shows them
// like states). Their records stay in the country's checklist and carry
// `part`. A part takes a record whose area is one of its areas, whose
// province or place names it, or whose coordinates fall in its box; the
// `rest` part takes every other record placed inside the country (a
// subdivision area, a specimen with a province). Records on the whole
// country (France's political area) or without province or coordinates get
// no part: they count for the country only.
const PARTS = {
  France: [
    { name: 'Corsica', areas: (shape) => /^cors/i.test(shape.name), match: /\bcors/i, box: [8.4, 41.3, 9.7, 43.1] },
    {
      name: 'Mainland France',
      // TDWG's "France" (12FRA) is mainland France: its outline has no
      // Corsica and no overseas parts.
      areas: (shape) => /^france$/i.test(shape.name) && /^tdwg/.test(shape.data_origin || ''),
      box: [-5.5, 42.2, 8.3, 51.2],
      rest: true
    }
  ]
}
for (const parts of Object.values(PARTS)) for (const part of parts) part.ids = areaIds(part.areas)

function partOf(checklist, row, ad) {
  const parts = PARTS[checklist.name]
  if (!parts) return ''
  const shape = ad?.asserted_distribution_shape
  const onArea = ad?.asserted_distribution_shape_type === 'GeographicArea' && shape
  const text = [shape?.name, row.stateProvince, row.county].filter(Boolean).join(' | ')
  const part = parts.find((candidate) => (onArea && candidate.ids.has(shape.id)))
    || parts.find((candidate) => candidate.match?.test(text) || inBox(row, candidate.box))
  if (part) return part.name
  const rest = parts.find((candidate) => candidate.rest)
  const onSubdivision = onArea && shape.level0_id && !checklist.ids.includes(shape.id)
  return rest && (onSubdivision || (!ad && row.stateProvince)) ? rest.name : ''
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
  // No catch: a failed lookup would silently drop every record of the OTU.
  const { parents } = await (await request(`/otus/${otuId}`, [['extend[]', 'parents']])).json()
  const names = Object.keys(parents || {})
  const classification = {}
  for (const name of names) {
    for (const [rank, ending] of RANK_ENDINGS) if (ending.test(name)) classification[rank] = name
  }
  parentClassification.set(otuId, classification)
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

// For overview.html: what each checklist is made of, by source place.
const contributions = new Map() // checklist id -> Map(source key -> tally)
const unplacedSources = new Map()

function sourceOf(row, ad) {
  if (ad) {
    const shape = ad.asserted_distribution_shape
    return { place: shape?.name || `(area ${ad.asserted_distribution_shape_id})`, kind: `${ad.asserted_distribution_shape_type} ${ad.asserted_distribution_shape_id}` }
  }
  const kind = row.dwc_occurrence_object_type === 'FieldOccurrence' ? 'Field occurrence' : 'Collection object'
  return { place: row.country ? `${row.country}${row.stateProvince ? `: ${row.stateProvince}` : ''}` : '(no DwC country)', kind }
}

function tally(map, source, rule, row) {
  const key = `${source.kind}|${source.place}|${rule}`
  if (!map.has(key)) map.set(key, { ...source, rule, records: 0, taxa: new Set() })
  const entry = map.get(key)
  entry.records++
  entry.taxa.add(taxonKey(row))
}

function countryOf(row) {
  if (row.dwc_occurrence_object_type === 'AssertedDistribution') {
    const ad = distributions.get(String(row.dwc_occurrence_object_id))
    const shape = ad?.asserted_distribution_shape
    if (shape?.level0_id && countries.has(shape.level0_id)) return { ad, id: shape.level0_id, region: subdivisionNames.get(shape.level1_id) || '', rule: 'area country' }
    // "TAAF: Île Saint-Paul": a gazetteer named after its territory, which
    // can differ from its ISO code (FR).
    const prefix = shape?.name?.includes(':') ? shape.name.split(':')[0] : ''
    const prefixed = prefix && countryByName.get(normalize(canonicalName(prefix)))
    if (prefixed) return { ad, id: prefixed, region: '', rule: 'gazetteer name' }
    const iso = shape?.iso_3166_a2?.toUpperCase()
    if (iso && countryByIso.has(iso)) return { ad, id: countryByIso.get(iso), region: '', rule: 'ISO code' }
    const id = countryByName.get(normalize(row.country))
    return id ? { ad, id, region: '', rule: 'DwC country' } : { ad }
  }
  const id = countryByName.get(normalize(row.country))
  return id ? { id, region: '', rule: 'DwC country' } : {}
}

for (const row of rows) {
  if (!RANKS.has(row.taxonRank) || !row.otu_id) continue
  if (normalize(row.occurrenceStatus) === 'absent') continue
  const classification = row.superfamily ? row : { ...row, ...parentClassification.get(row.otu_id) }
  if (!classification.genus) classification.genus = String(row.scientificName || '').split(' ')[0]
  if (classification.superfamily !== SUPERFAMILY) continue

  const placed = countryOf(row)
  const ad = placed.ad || (row.dwc_occurrence_object_type === 'AssertedDistribution' ? distributions.get(String(row.dwc_occurrence_object_id)) : undefined)
  if (ad?.is_absent) continue
  const separate = separateOf(row, ad)
  const id = separate ? separate.id : placed.id
  const { region } = placed
  const rule = separate ? `overseas ${separate.iso2}` : placed.rule
  const source = sourceOf(row, ad)
  if (!id) {
    unplaced.records++
    unplaced.taxa.add(taxonKey(row))
    tally(unplacedSources, source, '', row)
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
  const part = partOf(checklist, row, ad)
  if (part) record.part = part
  if (!contributions.has(checklist.id)) contributions.set(checklist.id, new Map())
  tally(contributions.get(checklist.id), source, PARTS[checklist.name] ? `${rule}; ${part || 'no part'}` : rule, row)
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
    ...(PARTS[name] ? {
      parts: PARTS[name].map((part) => ({
        name: part.name,
        shape: cachedArea(part.ids) ? `GeographicArea/${cachedArea(part.ids)}` : null
      }))
    } : {}),
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

writeFileSync(`${OUT_DIR}overview.html`, overviewHtml())
console.log('overview written to public/checklists/overview.html')

// A static page documenting what every checklist is made of: its TaxonWorks
// country areas, outline, and every place its records come from with the rule
// that placed them; then what no rule placed. Rebuilt with the cache.
function overviewHtml() {
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const num = (value) => value.toLocaleString('en-US')
  const rows = (map) => [...map.values()]
    .sort((a, b) => b.records - a.records || a.place.localeCompare(b.place))
    .map((entry) => `<tr><td>${esc(entry.place)}</td><td>${esc(entry.kind)}</td><td>${esc(entry.rule)}</td><td class="n">${num(entry.records)}</td><td class="n">${num(entry.taxa.size)}</td></tr>`)
    .join('')
  const table = (map, ruleHeader = 'Placed by') => `<div class="scroll"><table><thead><tr><th>Place</th><th>Source</th><th>${ruleHeader}</th><th class="n">Records</th><th class="n">Taxa</th></tr></thead><tbody>${rows(map)}</tbody></table></div>`
  const areaName = (areaId) => countries.get(areaId)?.name || ''
  const sections = index.map((country) => {
    const entry = checklistOf.get(country.id)
    const areas = country.areas.map((areaId) => `${esc(areaName(areaId) || country.name)} (GeographicArea ${areaId})`).join(', ') || 'none'
    const outline = country.shape ? `${esc(country.shape)} from the shape cache` : fallback.has(country.name) ? 'Natural Earth fallback' : 'none, not on the map'
    const split = SEPARATE.filter((area) => area.of === country.name).map((area) => esc(area.name))
    const splitFrom = entry.separate ? `<li>Filed under ${esc(entry.separate.of)} in TaxonWorks; own checklist by area, ISO code ${esc(entry.separate.iso2)}, name or coordinates</li>` : ''
    const parts = country.parts ? `<li>Selectable parts: ${country.parts.map((part) => `${esc(part.name)} (${part.shape ? esc(part.shape) : 'no cached outline'})`).join(', ')}; records marked "no part" count for ${esc(country.name)} only</li>` : ''
    return `<details id="c-${esc(country.id)}"><summary><span class="name">${esc(country.name)}</span><span class="meta">${num(country.taxa)} taxa, ${num(country.records)} records</span></summary>
<ul class="facts"><li>TaxonWorks country areas: ${areas}</li><li>Map outline: ${outline}</li>${split.length ? `<li>Split off into own checklists (cut from the outline): ${split.join(', ')}</li>` : ''}${splitFrom}${parts}</ul>
${table(contributions.get(country.id) || new Map())}</details>`
  }).join('\n')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checklist Sources</title>
<style>
:root { --bg:#f4f6f3; --panel:#fff; --fg:#17201a; --soft:#5b6760; --line:#d3dbd5; --accent:#037316; color-scheme:light }
@media (prefers-color-scheme: dark) { :root { --bg:#141815; --panel:#1d221e; --fg:#e8ede9; --soft:#9aa69e; --line:#39423b; --accent:#66cf7e; color-scheme:dark } }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif }
main { max-width:1100px; margin:0 auto; padding:32px max(16px, env(safe-area-inset-left, 0px)) 64px; display:grid; gap:18px }
h1 { margin:0; font-size:28px } h2 { margin:16px 0 0; font-size:20px }
p, ul { margin:0; max-width:75ch } .soft { color:var(--soft) }
code { font:13px ui-monospace, Menlo, monospace }
details { background:var(--panel); border:1px solid var(--line); border-radius:8px }
summary { cursor:pointer; padding:10px 14px; display:flex; flex-wrap:wrap; gap:4px 14px; align-items:baseline }
summary .name { font-weight:600 } summary .meta { color:var(--soft); font-size:13.5px; font-variant-numeric:tabular-nums }
details[open] summary { border-bottom:1px solid var(--line) }
.facts { padding:10px 14px 0 32px; display:grid; gap:4px; font-size:14px }
.scroll { overflow-x:auto; padding:10px 14px 14px }
table { border-collapse:collapse; width:100%; font-size:13.5px }
th, td { text-align:left; padding:5px 10px 5px 0; border-bottom:1px solid var(--line); vertical-align:top }
th { color:var(--soft); font-weight:500 } .n { text-align:right; font-variant-numeric:tabular-nums }
.rules { display:grid; gap:6px; padding-left:1.2em }
</style></head><body><main>
<h1>Checklist sources</h1>
<p class="soft">Built ${esc(new Date().toISOString().slice(0, 10))} by <code>scripts/build-checklists.mjs</code> together with the cache it documents. ${num(index.length)} checklists, ${num(unplaced.records)} records of ${num(unplaced.taxa.size)} taxa left out.</p>
<h2>How a record is placed</h2>
<ul class="rules">
<li><b>area country</b>: an asserted distribution whose TaxonWorks area carries a country (<code>level0_id</code>; a subdivision carries its country's).</li>
<li><b>ISO code</b>: an asserted distribution on a gazetteer, by the gazetteer's ISO 3166 code.</li>
<li><b>DwC country</b>: the DwC <code>country</code> text matched to a country by name; the only rule for collection objects and field occurrences.</li>
<li><b>gazetteer name</b>: a gazetteer named after its territory ("TAAF: Île Saint-Paul"), which can differ from its ISO code.</li>
<li><b>overseas GF, GP, MQ, RE, YT</b>: an overseas department TaxonWorks files under France, by its areas, ISO code, name or coordinates; it has a checklist of its own.</li>
<li><b>; part</b>: for a country with selectable parts, the part the record counts for, or "no part".</li>
</ul>
<p class="soft">Only Curculionoidea at species and subspecies rank, present records. Several TaxonWorks country areas of one country are merged into one checklist.</p>
<h2>Checklists</h2>
${sections}
<h2 id="left-out">Left out</h2>
<p class="soft">Records no rule places in a country, by place.</p>
${table(unplacedSources, 'Reason').replace(/<td><\/td><td class="n">/g, '<td>no country found</td><td class="n">')}
</main></body></html>
`
}
