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

// Retries server errors, rate limits and network failures; after the last
// try it throws. A client error (404, 403) is final and throws at once.
async function request(path, params = []) {
  const query = new URLSearchParams([['project_token', TOKEN], ...params])
  for (let attempt = 1; ; attempt++) {
    let failure
    try {
      const response = await fetch(`${BASE}${path}?${query}`)
      if (response.ok) return response
      failure = new Error(`${response.status} ${path}`)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw failure
    } catch (error) {
      if (error === failure) throw error
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
const BUILD_DATE = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD, local time

// TaxonWorks links for overview.html, the same builders curator mode uses on
// the site (panels/_shared/curatorMode/).
globalThis.__APP_ENV__ = { url: BASE }
const { twEditUrl, twOtuUrl, twRecordUrl } = await import('../panels/_shared/curatorMode/curatorMode.js')
const TW_BASE = BASE.replace(/\/api\/v1\/?$/, '')

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

// Status, following the project's conventions for asserted distributions
// (curculionidae.github.io/docs/TutorialAssertedDistributions/):
// - refuted or doubted: the distribution carries a "Reassessment" data
//   attribute, or an "is absent" distribution exists for the same taxon and
//   area. It is kept in TaxonWorks so nobody adds it again; here it no longer
//   counts and is shown as reassessed, with the note and the refuting source.
// - the keywords "Adventive" and "Endemic", as tags on a distribution (and
//   "Adventive" also on a specimen).
// These lists are small (hundreds); each comes in one page, checked.
async function getOnePage(path, params) {
  const response = await request(path, [...params, ['per', 5000]])
  const total = Number(response.headers.get('pagination-total'))
  const list = await response.json()
  if (Number.isFinite(total) && total > list.length) throw new Error(`${path}: ${total} rows, only ${list.length} in one page`)
  return list
}
const tagsByObject = new Map() // "AssertedDistribution:12" -> Set of lowercase keywords
function addTags(list) {
  for (const tag of list) {
    const key = `${tag.tag_object_type}:${tag.tag_object_id}`
    if (!tagsByObject.has(key)) tagsByObject.set(key, new Set())
    tagsByObject.get(key).add(normalize(tag.keyword?.name))
  }
}
// The keywords by name, then every tag with them, on any kind of record
// (distributions, collection objects, field occurrences).
const STATUS_KEYWORDS = ['adventive', 'endemic']
const statusKeywordIds = (await getOnePage('/controlled_vocabulary_terms', [['type[]', 'Keyword']]))
  .filter((term) => STATUS_KEYWORDS.includes(normalize(term.name)))
  .map((term) => term.id)
const statusTags = statusKeywordIds.length ? await getOnePage('/tags', statusKeywordIds.map((id) => ['keyword_id[]', id])) : []
addTags(statusTags)

const reassessmentsByDistribution = new Map() // AD id -> [{ note, sources }]
const reassessmentAttributes = (await getOnePage('/data_attributes', [['attribute_subject_type', 'AssertedDistribution']]))
  .filter((attribute) => normalize(attribute.predicate_name || attribute.import_predicate) === 'reassessment')
const attributeSources = new Map() // data attribute id -> [source label]
// In batches of 100 ids, to stay under the server's URL length limit.
for (let i = 0; i < reassessmentAttributes.length; i += 100) {
  const citations = await getOnePage('/citations', [
    ['citation_object_type', 'DataAttribute'],
    ...reassessmentAttributes.slice(i, i + 100).map((attribute) => ['citation_object_id[]', attribute.id]),
    ['extend[]', 'source']
  ])
  for (const citation of citations) {
    const label = citation.source?.cached || citation.citation_source_body || ''
    if (!label) continue
    const id = String(citation.citation_object_id)
    if (!attributeSources.has(id)) attributeSources.set(id, [])
    attributeSources.get(id).push(label.replace(/<[^>]+>/g, ''))
  }
}
for (const attribute of reassessmentAttributes) {
  const id = String(attribute.attribute_subject_id)
  if (!reassessmentsByDistribution.has(id)) reassessmentsByDistribution.set(id, [])
  reassessmentsByDistribution.get(id).push({ note: attribute.value || '', sources: attributeSources.get(String(attribute.id)) || [] })
}
console.log(`${statusTags.length} adventive/endemic tags, ${reassessmentAttributes.length} reassessments`)

// Distributions asserted for a biological association ("egg of Lixus bidens
// collected from stem of Opopanax", in Greece) are never in TaxonWorks' DwC
// export. Each becomes a record here for every OTU side of the association
// (the weevil side survives the Curculionoidea filter, the plant does not),
// with the name and classification from that OTU's other DwC records, or
// from TaxonWorks when it has none. `association` keeps the reading.
const associationDistributions = [...distributions.values()]
  .filter((ad) => ad.asserted_distribution_object_type === 'BiologicalAssociation')
const associations = new Map()
const associationIds = [...new Set(associationDistributions.map((ad) => ad.asserted_distribution_object_id))]
for (let i = 0; i < associationIds.length; i += 100) {
  const batch = associationIds.slice(i, i + 100)
  for (const association of await getOnePage('/biological_associations/basic', batch.map((id) => ['biological_association_id[]', id]))) {
    associations.set(association.id, association)
  }
}
const rowByOtu = new Map()
for (const row of rows) if (row.otu_id && row.scientificName && !rowByOtu.has(row.otu_id)) rowByOtu.set(row.otu_id, row)
const TAXON_FIELDS = ['scientificName', 'scientificNameAuthorship', 'taxonRank', 'kingdom', 'superfamily', 'family', 'subfamily', 'tribe', 'subtribe', 'genus', 'nomenclaturalCode']
const skippedAssociationOtus = []
async function otuTaxonRow(otuId) {
  if (rowByOtu.has(otuId)) return rowByOtu.get(otuId)
  // Not in the DwC export at all: the OTU's taxon name (classification comes
  // later from the parents lookup, as for field occurrences). A stale or
  // hidden OTU (4xx) is skipped and reported; a server failure stops the build.
  let row = null
  try {
    const otu = await (await request(`/otus/${otuId}`)).json()
    if (otu.taxon_name_id) {
      const name = await (await request(`/taxon_names/${otu.taxon_name_id}`)).json()
      row = {
        otu_id: otuId,
        scientificName: [name.cached, name.cached_author_year].filter(Boolean).join(' '),
        scientificNameAuthorship: name.cached_author_year || '',
        taxonRank: name.rank || ''
      }
    }
  } catch (error) {
    if (!/^4\d\d /.test(error.message)) throw error
    skippedAssociationOtus.push(`${otuId} (${error.message})`)
  }
  rowByOtu.set(otuId, row) // null too, so it is not asked again
  return row
}
let associationRecords = 0
for (const ad of associationDistributions) {
  const association = associations.get(ad.asserted_distribution_object_id)
  if (!association) continue
  const reading = [association.subject?.label, association.relationship, association.object?.label].filter(Boolean).join(' ')
  // Only the beetle side(s): a plant side would be looked up for nothing.
  const sides = [[association.subject_otu_id, association.subject], [association.object_otu_id, association.object]]
    .filter(([otuId, side]) => otuId && (!side?.order || side.order === 'Coleoptera'))
    .map(([otuId]) => String(otuId))
  for (const otuId of new Set(sides)) {
    const taxonRow = await otuTaxonRow(otuId)
    if (!taxonRow) continue
    rows.push({
      ...Object.fromEntries(TAXON_FIELDS.map((field) => [field, taxonRow[field] || ''])),
      otu_id: otuId,
      dwc_occurrence_object_type: 'AssertedDistribution',
      dwc_occurrence_object_id: String(ad.id),
      basisOfRecord: 'MaterialCitation',
      occurrenceStatus: ad.is_absent ? 'absent' : 'present',
      country: '',
      association: reading
    })
    associationRecords++
  }
}
console.log(`${associationDistributions.length} association distributions (not in the DwC export): ${associationRecords} records`)
if (skippedAssociationOtus.length) console.warn(`association OTUs not found in TaxonWorks: ${skippedAssociationOtus.join(', ')}`)

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
// The areas a test picks (`direct`), plus their children (TDWG level 4 under
// level 3, a commune under its department), as far as distributions use
// them. Records are matched against all of them; an outline is only ever
// taken from a direct one (never a commune drawn as its department).
function areaIds(test) {
  const direct = new Set([...areaById.values()].filter(test).map((area) => area.id))
  const ids = new Set(direct)
  for (let grew = true; grew;) {
    grew = false
    for (const area of areaById.values()) {
      if (!ids.has(area.id) && ids.has(area.parent_id)) { ids.add(area.id); grew = true }
    }
  }
  ids.direct = direct
  return ids
}
const cachedArea = (ids) => [...ids].find((id) => existsSync(`${SHAPE_DIR}GeographicArea/${id}.json`))

// Point-in-outline tests against the cached TaxonWorks outlines
// (public/map-shapes/, the same files the maps draw) or the fallback file.
const outlineCache = new Map()
const fallbackShapes = new Map(JSON.parse(readFileSync(FALLBACK_FILE, 'utf8')).features
  .map((feature) => [feature.properties.name, feature.geometry]))
// Memoized per ids set (the department, part and country sets never change),
// so the per-row tests do not probe the disk again.
const outlineByIds = new Map()
function outline(ids, fallbackName = '') {
  const memoKey = ids
  if (outlineByIds.has(memoKey) && !fallbackName) return outlineByIds.get(memoKey)
  const shape = outlineFor(ids, fallbackName)
  if (!fallbackName) outlineByIds.set(memoKey, shape)
  return shape
}
function outlineFor(ids, fallbackName) {
  const id = cachedArea(ids)
  const key = id ? `GeographicArea/${id}` : `fallback/${fallbackName}`
  if (!outlineCache.has(key)) {
    const geometry = id
      ? JSON.parse(readFileSync(`${SHAPE_DIR}GeographicArea/${id}.json`, 'utf8'))
      : fallbackShapes.get(fallbackName) || null
    outlineCache.set(key, geometry && { geometry, box: boundingBox(geometry) })
  }
  return outlineCache.get(key)
}
function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates]
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates
  return []
}
function boundingBox(geometry) {
  const box = [180, 90, -180, -90]
  for (const polygon of polygonsOf(geometry)) {
    for (const [lng, lat] of polygon[0]) {
      box[0] = Math.min(box[0], lng); box[1] = Math.min(box[1], lat)
      box[2] = Math.max(box[2], lng); box[3] = Math.max(box[3], lat)
    }
  }
  return box
}
function inRing(ring, lng, lat) {
  let inside = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [x1, y1] = ring[a]
    const [x2, y2] = ring[b]
    if ((y1 > lat) !== (y2 > lat) && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside
  }
  return inside
}
function pointOf(row) {
  const lat = Number.parseFloat(row.decimalLatitude)
  const lng = Number.parseFloat(row.decimalLongitude)
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null
}
function contains(shape, point) {
  if (!shape || !point) return false
  const [lng, lat] = point
  const [west, south, east, north] = shape.box
  if (lng < west || lng > east || lat < south || lat > north) return false
  return polygonsOf(shape.geometry).some(([outer, ...holes]) => (
    inRing(outer, lng, lat) && !holes.some((hole) => inRing(hole, lng, lat))
  ))
}
const inBox = (point, box) => Boolean(point) && point[0] >= box[0] && point[1] >= box[1] && point[0] <= box[2] && point[1] <= box[3]

// Overseas departments TaxonWorks files under France, though each has an
// ISO 3166-1 code of its own: they get a checklist of their own and are cut
// out of France's outline. Any record goes to one when its area is one of the
// department's areas (named like it, or a child of one) or a gazetteer carries
// its ISO code. A record placed in France, or placed nowhere, also goes to one
// when its DwC country, province or place names it, or its coordinates fall
// in the department's outline (`box` where no outline is cached). Records of
// other countries are never moved by name or coordinates (Suriname, Amapá).
// The page lists them under France (ASSOCIATED_AREAS_BY_SOVEREIGN).
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
  const outlineId = cachedArea(area.ids.direct)
  if (!merged.has(key)) merged.set(key, { id: outlineId || [...area.ids.direct][0] || area.iso2, name: area.name, iso2: area.iso2, ids: [] })
  const entry = merged.get(key)
  Object.assign(entry, { name: area.name, iso2: area.iso2, separate: area })
  entry.outlineIds = [...entry.ids, ...area.ids.direct]
  for (const id of area.ids) if (!entry.ids.includes(id)) entry.ids.push(id)
  checklistOf.set(entry.id, entry)
  for (const id of entry.ids) checklistOf.set(id, entry)
}
function separateOf(row, ad, placedChecklist) {
  const shape = ad?.asserted_distribution_shape
  const onArea = ad?.asserted_distribution_shape_type === 'GeographicArea' && shape
  // Placed nowhere counts as loose only without a DwC country text: a record
  // whose country ("Brasil", "Surinam") just matched no checklist belongs to
  // that country, never to an overseas department.
  const loose = placedChecklist
    ? Boolean(placedChecklist.separate) || SEPARATE.some((area) => area.of === placedChecklist.name)
    : !row.country
  const text = [shape?.name, row.country, row.stateProvince, row.county].filter(Boolean).join(' | ')
  const point = pointOf(row)
  const area = SEPARATE.find((candidate) => (
    (onArea && candidate.ids.has(shape.id)) ||
    shape?.iso_3166_a2?.toUpperCase() === candidate.iso2 ||
    (loose && (
      candidate.match.test(text) ||
      (outline(candidate.ids.direct) ? contains(outline(candidate.ids.direct), point) : inBox(point, candidate.box))
    ))
  ))
  return area ? merged.get(normalize(area.name)) : null
}

// Parts of a country that can be selected on their own (the page shows them
// like states). Their records stay in the country's checklist and carry
// `part`. A part takes a record whose area is one of its areas, whose
// province or place names it, or whose coordinates fall in its outline
// (`box` where none is cached or the point misses the simplified outline).
// The `rest` part takes every other record placed below the country level:
// an asserted distribution on any area but the whole country, a specimen
// with a province or coordinates. Records on the whole country (France's
// political area) or without province or coordinates count for the country
// only.
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
  const point = pointOf(row)
  const part = parts.find((candidate) => onArea && candidate.ids.has(shape.id))
    || parts.find((candidate) => candidate.match?.test(text))
    || parts.find((candidate) => contains(outline(candidate.ids.direct), point))
    || parts.find((candidate) => inBox(point, candidate.box))
  if (part) return part.name
  const rest = parts.find((candidate) => candidate.rest)
  const belowCountry = ad
    ? !(onArea && checklist.ids.includes(shape.id))
    : Boolean(row.stateProvince || point)
  return rest && belowCountry ? rest.name : ''
}

// Coordinates of a specimen whose collecting event has no area: the country
// whose outline contains the point, when exactly one does.
let countryOutlines = null
function countryByPoint(point) {
  countryOutlines ??= [...new Set(merged.values())]
    .filter((entry) => !entry.separate)
    .map((entry) => ({ entry, shape: outline(entry.outlineIds || entry.ids, entry.name) }))
    .filter(({ shape }) => shape)
  const hits = countryOutlines.filter(({ shape }) => contains(shape, point))
  if (hits.length) return hits.length === 1 ? { entry: hits[0].entry, rule: 'coordinates' } : 'several'
  // A coastal point often falls just outside the simplified outline (0.5 km):
  // the nearest country within NEAR degrees, if no other is nearly as close.
  const near = countryOutlines
    .map(({ entry, shape }) => ({ entry, distance: distanceTo(shape, point) }))
    .filter(({ distance }) => distance <= NEAR)
    .sort((a, b) => a.distance - b.distance)
  if (!near.length) return null
  if (near.length > 1 && near[1].distance - near[0].distance < NEAR / 2) return 'several'
  return { entry: near[0].entry, rule: 'coordinates, nearest coast' }
}

const NEAR = 0.05 // degrees, about 5 km
// Distance in degrees from a point to an outline's edges (only for outlines
// whose box, widened by NEAR, holds the point).
function distanceTo(shape, [lng, lat]) {
  const [west, south, east, north] = shape.box
  if (lng < west - NEAR || lng > east + NEAR || lat < south - NEAR || lat > north + NEAR) return Infinity
  let best = Infinity
  for (const polygon of polygonsOf(shape.geometry)) {
    for (const ring of polygon) {
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [x1, y1] = ring[b]
        const [x2, y2] = ring[a]
        const dx = x2 - x1
        const dy = y2 - y1
        const t = dx || dy ? Math.max(0, Math.min(1, ((lng - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy))) : 0
        best = Math.min(best, Math.hypot(lng - (x1 + t * dx), lat - (y1 + t * dy)))
      }
    }
  }
  return best
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
const failedLookups = []
await forEachLimited(missing, PARALLEL, async (otuId) => {
  try {
    const { parents } = await (await request(`/otus/${otuId}`, [['extend[]', 'parents']])).json()
    const classification = {}
    for (const name of Object.keys(parents || {})) {
      for (const [rank, ending] of RANK_ENDINGS) if (ending.test(name)) classification[rank] = name
    }
    parentClassification.set(otuId, classification)
  } catch (error) {
    // A server or network failure (after retries) stops the build: a cache
    // missing those taxa must not be written. A permanent client error (404,
    // 403: a stale or hidden OTU) does not; the OTU's records are listed under
    // Left out in the overview ("classification lookup failed").
    if (!/^4\d\d /.test(error.message)) throw error
    parentClassification.set(otuId, null)
    failedLookups.push(`${otuId} (${error.message})`)
  }
})
console.log(`${missing.length - failedLookups.length} OTUs classified from their parents`)
if (failedLookups.length) console.warn(`classification lookup failed for ${failedLookups.length} OTUs: ${failedLookups.join(', ')}`)

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
// Exactly as the page's speciesKey (each part trimmed), so the cached counts
// and the page's list always agree.
const taxonKey = (record) => `${String(record.scientificName || '').trim()} ${String(record.scientificNameAuthorship || '').trim()}`.trim().toLocaleLowerCase() || String(record.otu_id)
const unplaced = { records: 0, taxa: new Set() }

// For overview.html: what each checklist is made of, by source place.
const contributions = new Map() // checklist id -> Map(source key -> tally)
const unplacedSources = new Map()

function sourceOf(row, ad) {
  if (ad) {
    const shape = ad.asserted_distribution_shape
    return {
      place: shape?.name || `(area ${ad.asserted_distribution_shape_id})`,
      kind: `${ad.asserted_distribution_shape_type} ${ad.asserted_distribution_shape_id}`,
      shapeType: ad.asserted_distribution_shape_type,
      shapeId: ad.asserted_distribution_shape_id
    }
  }
  const kind = row.dwc_occurrence_object_type === 'FieldOccurrence' ? 'Field occurrence' : 'Collection object'
  return { place: row.country ? `${row.country}${row.stateProvince ? `: ${row.stateProvince}` : ''}` : '(no DwC country)', kind }
}

const SAMPLES = 30 // records listed per row of the overview
function tally(map, source, rule, row) {
  const key = `${source.kind}|${source.place}|${rule}`
  if (!map.has(key)) map.set(key, { ...source, rule, records: 0, taxa: new Set(), samples: [] })
  const entry = map.get(key)
  entry.records++
  entry.taxa.add(taxonKey(row))
  // Every left-out record is listed (it is the to-do list); elsewhere a sample.
  if (map === unplacedSources || entry.samples.length < SAMPLES) {
    entry.samples.push({
      type: row.dwc_occurrence_object_type,
      id: row.dwc_occurrence_object_id,
      otu: row.otu_id,
      name: row.scientificName,
      note: row.dwc_occurrence_object_type === 'AssertedDistribution' ? '' : [row.verbatimLocality, row.decimalLatitude && `${row.decimalLatitude}, ${row.decimalLongitude}`].filter(Boolean).join('; ')
    })
  }
}

// Why a record no rule placed has no country (for the overview).
function unplacedReason(row, ad, byPoint) {
  if (ad) return 'area has no country'
  if (row.country) return `DwC country "${row.country}" matches no checklist (name alias missing)`
  if (byPoint === 'several') return 'coordinates on the outlines of several countries'
  if (pointOf(row)) return 'coordinates outside every country outline'
  if (row.verbatimLocality) return 'locality text only, no area on the collecting event'
  return 'no locality at all'
}

function countryOf(row) {
  if (row.dwc_occurrence_object_type === 'AssertedDistribution') {
    const ad = distributions.get(String(row.dwc_occurrence_object_id))
    const shape = ad?.asserted_distribution_shape
    if (shape?.level0_id && countries.has(shape.level0_id)) return { ad, id: shape.level0_id, region: subdivisionNames.get(shape.level1_id) || '', rule: 'area country' }
    // "TAAF: Île Saint-Paul": a gazetteer named after its territory, which
    // can differ from its ISO code (FR).
    const prefix = shape?.name?.includes(':') ? shape.name.split(':')[0] : ''
    // TaxonWorks spelling first ("Korea"), then the canonical name.
    const prefixed = prefix && (countryByName.get(normalize(prefix)) || merged.get(normalize(canonicalName(prefix)))?.id)
    if (prefixed) return { ad, id: prefixed, region: '', rule: 'gazetteer name' }
    const iso = shape?.iso_3166_a2?.toUpperCase()
    if (iso && countryByIso.has(iso)) return { ad, id: countryByIso.get(iso), region: '', rule: 'ISO code' }
    const id = countryByName.get(normalize(row.country))
    return id ? { ad, id, region: '', rule: 'DwC country' } : { ad }
  }
  const id = countryByName.get(normalize(row.country))
  return id ? { id, region: '', rule: 'DwC country' } : {}
}

// "is absent" distributions, by taxon and area: they refute a present
// distribution of the same taxon and area.
const shapeKeyOf = (ad) => `${ad.asserted_distribution_shape_type}/${ad.asserted_distribution_shape_id}`
const absentPairs = new Map() // "taxon|GeographicArea/12" -> [{ note, sources }]
for (const row of rows) {
  if (row.dwc_occurrence_object_type !== 'AssertedDistribution') continue
  const ad = distributions.get(String(row.dwc_occurrence_object_id))
  if (!ad?.is_absent) continue
  const key = `${taxonKey(row)}|${shapeKeyOf(ad)}`
  if (!absentPairs.has(key)) absentPairs.set(key, [])
  absentPairs.get(key).push({
    note: `Recorded as absent from ${ad.asserted_distribution_shape?.name || 'this area'}`,
    sources: (ad.citations || []).map((citation) => citation.source?.name || '').filter(Boolean)
  })
}

for (const row of rows) {
  if (!RANKS.has(row.taxonRank) || !row.otu_id) continue
  if (normalize(row.occurrenceStatus) === 'absent') continue
  const lookupFailed = !row.superfamily && parentClassification.get(row.otu_id) === null
  const classification = row.superfamily ? row : { ...row, ...parentClassification.get(row.otu_id) }
  if (!classification.genus) classification.genus = String(row.scientificName || '').split(' ')[0]
  if (classification.superfamily !== SUPERFAMILY && !lookupFailed) continue

  const placed = countryOf(row)
  const { ad } = placed
  if (ad?.is_absent) continue
  const separate = separateOf(row, ad, placed.id && checklistOf.get(placed.id))
  let id = separate ? separate.id : placed.id
  let rule = separate ? `overseas ${separate.iso2}` : placed.rule
  let byPoint = null
  if (!id && !ad && pointOf(row)) {
    byPoint = countryByPoint(pointOf(row))
    if (byPoint && byPoint !== 'several') { id = byPoint.entry.id; rule = byPoint.rule }
  }
  const { region } = placed
  const source = sourceOf(row, ad)
  if (!id || lookupFailed) {
    // Unclassified records may not be weevils: listed in the overview, but
    // not counted as left-out weevil records.
    if (!lookupFailed) {
      unplaced.records++
      unplaced.taxa.add(taxonKey(row))
    }
    const kind = row.dwc_occurrence_object_type === 'FieldOccurrence' ? 'Field occurrence' : 'Collection object'
    const place = ad ? source : { place: row.country || '(no DwC country)', kind }
    tally(unplacedSources, place, lookupFailed ? 'classification lookup failed' : unplacedReason(row, ad, byPoint), row)
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
  const reassessed = ad && [
    ...(reassessmentsByDistribution.get(String(ad.id)) || []),
    ...(absentPairs.get(`${taxonKey(row)}|${shapeKeyOf(ad)}`) || [])
  ]
  if (reassessed?.length) record.reassessed = reassessed
  const tags = tagsByObject.get(`${row.dwc_occurrence_object_type}:${row.dwc_occurrence_object_id}`)
  if (tags?.has('adventive')) record.adventive = true
  if (tags?.has('endemic')) record.endemic = true
  const status = [record.reassessed && 'reassessed', record.adventive && 'adventive', record.endemic && 'endemic'].filter(Boolean)
  if (!contributions.has(checklist.id)) contributions.set(checklist.id, new Map())
  tally(contributions.get(checklist.id), source, [PARTS[checklist.name] ? `${rule}; ${part || 'no part'}` : rule, ...status].join('; '), row)
  if (row.association) record.association = row.association
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
// taxa.json, counted in the same pass as index.json (one rule for what
// counts): for every higher taxon (family, subfamily, tribe, subtribe, genus)
// its number of taxa in each checklist and over all of them. The page loads
// it only when someone filters by taxon, to colour the map and the country
// list for that taxon.
const HIGHER_RANKS = ['family', 'subfamily', 'tribe', 'subtribe', 'genus']
const higherTaxa = new Map() // "rank:name" -> { index, rank, name, all: Set(taxon keys) }
const countsByChecklist = {}
const index = []
for (const [id, records] of byCountry) {
  const { name, iso2, ids } = checklistOf.get(id)
  writeFileSync(`${COUNTRY_DIR}${id}.json`, JSON.stringify(records))
  // Reassessed records do not count; a taxon known only from them is shown on
  // the page (as reassessed) but counted nowhere.
  const counted = records.filter((record) => !record.reassessed)
  const perTaxon = new Map() // higher-taxon index -> Set(taxon keys)
  for (const record of counted) {
    for (const rank of HIGHER_RANKS) {
      const taxonName = record[rank]
      if (!taxonName) continue
      const key = `${rank}:${taxonName}`
      if (!higherTaxa.has(key)) higherTaxa.set(key, { index: higherTaxa.size, rank, name: taxonName, all: new Set() })
      const higher = higherTaxa.get(key)
      higher.all.add(taxonKey(record))
      if (!perTaxon.has(higher.index)) perTaxon.set(higher.index, new Set())
      perTaxon.get(higher.index).add(taxonKey(record))
    }
  }
  countsByChecklist[id] = Object.fromEntries([...perTaxon].map(([taxonIndex, keys]) => [taxonIndex, keys.size]))
  // The map draws the country from the species map's shape cache
  // (public/map-shapes/, npm run map-shapes).
  const entry = checklistOf.get(id)
  const shapeId = cachedArea(entry.outlineIds || ids)
  // The country's outline without the parts that have a checklist of their own.
  const exclude = SEPARATE.filter((area) => area.of === name).map((area) => area.box)
  index.push({
    id, name, iso2: iso2 || EXTRA_ISO[name] || '', areas: ids,
    shape: shapeId ? `GeographicArea/${shapeId}` : null,
    ...(exclude.length ? { exclude } : {}),
    ...(PARTS[name] ? {
      parts: PARTS[name].map((part) => {
        const partShape = cachedArea(part.ids.direct)
        return { name: part.name, shape: partShape ? `GeographicArea/${partShape}` : null }
      })
    } : {}),
    taxa: new Set(counted.map(taxonKey)).size,
    records: records.length
  })
}
index.sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(`${OUT_DIR}taxa.json`, JSON.stringify({
  taxa: [...higherTaxa.values()].map(({ rank, name, all }) => [rank, name, all.size]),
  counts: countsByChecklist
}))
console.log(`taxa.json: ${higherTaxa.size} higher taxa`)
writeFileSync(`${OUT_DIR}index.json`, JSON.stringify({
  // The local date of the build (toISOString is UTC: a build after midnight
  // in Europe was stamped with the day before).
  updated: BUILD_DATE,
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
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`
  const recordUrl = (sample) => ({
    AssertedDistribution: twEditUrl.assertedDistribution,
    CollectionObject: twEditUrl.collectionObject,
    FieldOccurrence: twEditUrl.fieldOccurrence
  })[sample.type]?.(sample.id)
  const SHORT = { AssertedDistribution: 'AD', CollectionObject: 'CO', FieldOccurrence: 'FO' }
  const sourceCell = (entry) => {
    if (!entry.shapeId) return esc(entry.kind)
    const page = entry.shapeType === 'Gazetteer' ? `/gazetteers/${entry.shapeId}` : `/geographic_areas/${entry.shapeId}`
    const filter = `${TW_BASE}/tasks/asserted_distributions/filter?geo_shape_id[]=${entry.shapeId}&geo_shape_type[]=${entry.shapeType}`
    return `${link(twRecordUrl(page), entry.kind)}<br><span class="soft">${link(filter, 'its distributions')}</span>`
  }
  const samplesCell = (entry) => {
    const items = entry.samples.map((sample) => `<li>${link(recordUrl(sample), `${SHORT[sample.type] || sample.type} ${sample.id}`)} ${sample.otu ? link(twOtuUrl(sample.otu), sample.name) : esc(sample.name)}${sample.note ? ` <span class="soft">${esc(sample.note)}</span>` : ''}</li>`).join('')
    const more = entry.records > entry.samples.length ? `<li class="soft">and ${num(entry.records - entry.samples.length)} more</li>` : ''
    return `<details class="rec"><summary>${num(entry.records)}</summary><ul>${items}${more}</ul></details>`
  }
  const rows = (map) => [...map.values()]
    .sort((a, b) => b.records - a.records || a.place.localeCompare(b.place))
    .map((entry) => `<tr><td>${esc(entry.place)}</td><td>${sourceCell(entry)}</td><td>${esc(entry.rule)}</td><td class="n">${samplesCell(entry)}</td><td class="n">${num(entry.taxa.size)}</td></tr>`)
    .join('')
  const table = (map, ruleHeader = 'Placed by') => `<div class="scroll"><table><thead><tr><th>Place</th><th>Source</th><th>${ruleHeader}</th><th class="n">Records</th><th class="n">Taxa</th></tr></thead><tbody>${rows(map)}</tbody></table></div>`
  const areaName = (areaId) => countries.get(areaId)?.name || ''
  const sections = index.map((country) => {
    const entry = checklistOf.get(country.id)
    const areas = country.areas.map((areaId) => `${esc(areaName(areaId) || country.name)} (${link(twRecordUrl(`/geographic_areas/${areaId}`), `GeographicArea ${areaId}`)})`).join(', ') || 'none'
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
a { color:var(--accent) } .soft { color:var(--soft) }
details.rec summary { padding:0; display:inline; font-variant-numeric:tabular-nums; color:var(--accent) }
details.rec ul { text-align:left; margin:6px 0 4px; padding-left:1.1em; min-width:22rem; font-size:12.5px; display:grid; gap:2px }
details.rec[open] summary { border:0 }
</style></head><body><main>
<h1>Checklist sources</h1>
<p class="soft">Built ${esc(BUILD_DATE)} by <code>scripts/build-checklists.mjs</code> together with the cache it documents. ${num(index.length)} checklists, ${num(unplaced.records)} records of ${num(unplaced.taxa.size)} taxa left out.</p>
<h2>How a record is placed</h2>
<ul class="rules">
<li><b>area country</b>: an asserted distribution whose TaxonWorks area carries a country (<code>level0_id</code>; a subdivision carries its country's).</li>
<li><b>ISO code</b>: an asserted distribution on a gazetteer, by the gazetteer's ISO 3166 code.</li>
<li><b>DwC country</b>: the DwC <code>country</code> text matched to a country by name; the only rule for collection objects and field occurrences.</li>
<li><b>coordinates</b>: a specimen whose collecting event has no area, by the one country outline (cached TaxonWorks shape) that contains its coordinates; <b>coordinates, nearest coast</b>: the point lies just outside every outline (coasts are simplified to about 0.5 km), and one country is within about 5 km.</li>
<li><b>gazetteer name</b>: a gazetteer named after its territory ("TAAF: Île Saint-Paul"), which can differ from its ISO code.</li>
<li><b>overseas GF, GP, MQ, RE, YT</b>: an overseas department TaxonWorks files under France, by its areas, ISO code, name or coordinates; it has a checklist of its own.</li>
<li><b>; reassessed</b>: the distribution has a Reassessment data attribute or an "is absent" record for the same taxon and area; it does not count. <b>; adventive</b>, <b>; endemic</b>: tagged with that keyword.</li>
<li><b>; part</b>: for a country with selectable parts, the part the record counts for (by area, name, or coordinates in the part's outline), or "no part".</li>
</ul>
<p class="soft">Only Curculionoidea at species and subspecies rank, present records. Several TaxonWorks country areas of one country are merged into one checklist.</p>
<h2>Checklists</h2>
${sections}
<h2 id="left-out">Left out</h2>
<p class="soft">Records no rule places in a country, by place and reason. Collection objects get a DwC country only from the geographic area of their collecting event; "locality text only" and "coordinates" can be fixed by giving the collecting event an area in TaxonWorks.</p>
<p class="soft">Links open TaxonWorks (login needed): area and gazetteer pages, the asserted distribution filter for an area, the editor of each record (AD asserted distribution, CO collection object, FO field occurrence) and the OTU. Up to ${SAMPLES} records are listed per row of a checklist, every record under Left out.</p>
${table(unplacedSources, 'Reason')}
</main></body></html>
`
}
