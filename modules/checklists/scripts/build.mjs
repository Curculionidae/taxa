#!/usr/bin/env node
// Builds public/checklists/: the data of the country checklists page
// (modules/checklists/ChecklistsPage.vue), so a visitor loads one small file per
// country instead of paging through the project's 80,000 DwC occurrences.
//
// Usage
//   npm run checklists -- [--save <dir>] [--from <dir>] [--verbose] [--explain "AD 556796"]
//   --save <dir>   after downloading, keep the TaxonWorks data in <dir> (default
//                  modules/checklists/.cache/data when the flag has no folder)
//   --from <dir>   read the TaxonWorks data from <dir> instead of downloading
//                  (default modules/checklists/.cache/data); fully offline, seconds
//   --verbose      print every record's placement (placement/format.js)
//   --explain <x>  print the placement of one record or area and stop: "AD 556796",
//                  "co 12", "GA 8837", "GZ10453" (any form parseLookup reads)
// Without --from it downloads (scripts/download.mjs, about 2 minutes).
//
// What it reads besides TaxonWorks: rules/placement.yml (the placement rules),
// public/map-shapes/ (cached outlines), public/checklists/fallback-shapes.geojson
// and subdivisions.geojson (Natural Earth outlines, never written here),
// scripts/data/country-iso.json (ISO codes TaxonWorks does not give).
//
// What it writes to public/checklists/ (see the module README, "Building the cache"):
//   index.json             build date, every checklist (key, file, name, iso2, of,
//                          outline, bbox, parts, states, taxon and record counts)
//                          and the unplaced totals
//   countries/<key>.json   one checklist: a `checklist` header (what it is made
//                          of and how its records got there), then its records in
//                          the compact form of data/compact.js
//   taxa.json              per higher taxon, its number of taxa in each checklist
//   rules.json             the compiled rules file (placement/rules.js)
//   areas.json             every area a distribution uses, with its placement
//   unplaced.json          the records no rule places, by reason
// Country files of checklists that no longer exist are removed.
//
// How records are placed: by the placement engine (placement/engine.js), the
// same code the curator page runs. Asserted distributions (also those asserted
// for a biological association) by their area, specimens and field occurrences
// by their DwC country, else by their coordinates; then the part (France) and
// the state (six countries). The checklists themselves come from
// placement/checklists.js (deriveChecklists). See the README, "How checklists
// are formed" and "How a record is placed".
//
// Which records: only taxa of Curculionoidea at species rank and below, present
// (not absent) records. Field occurrences come without classification in the
// DwC export, so their classification is taken from the OTU's parents.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compactChecklist } from '../data/compact.js'
import { compileRules } from '../placement/rules.js'
import { toArea, normalizeName } from '../placement/areas.js'
import { deriveChecklists } from '../placement/checklists.js'
import { createContext, placeRecord } from '../placement/engine.js'
import { formatPlacement, parseLookup } from '../placement/format.js'
import { createNodeGeometry, listShapes } from './geometry-node.mjs'
import { downloadData, saveData, loadData, parseTsv, level0NamesFrom, beetleSides } from './download.mjs'
import {
  assignKeys, groupUnplaced, bboxOf, definedBy, areasUsed, specimensSummary, checklistHeader,
  indexEntry, publicPlacement, decidingSource
} from './cacheFiles.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MODULE = join(ROOT, 'modules/checklists/')
const OUT_DIR = join(ROOT, 'public/checklists/')
const COUNTRY_DIR = join(OUT_DIR, 'countries/')
const SHAPE_DIR = join(ROOT, 'public/map-shapes/')
const FALLBACK_FILE = join(OUT_DIR, 'fallback-shapes.geojson')
const SUBDIVISIONS_FILE = join(OUT_DIR, 'subdivisions.geojson')
const RULES_FILE = join(MODULE, 'rules/placement.yml')
const DEFAULT_DATA_DIR = join(MODULE, '.cache/data')
const SUPERFAMILY = 'Curculionoidea'
const RANKS = new Set(['species', 'subspecies'])
const KIND = { AssertedDistribution: 'AD', CollectionObject: 'CO', FieldOccurrence: 'FO' }
const BUILD_DATE = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD, local time

// Flags. A folder flag followed by another flag (or nothing) takes the default.
const args = process.argv.slice(2)
const folderOption = (name) => {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  return resolve(value && !value.startsWith('--') ? value : DEFAULT_DATA_DIR)
}
const fromDir = folderOption('--from')
const saveDir = folderOption('--save')
const verbose = args.includes('--verbose')
const explainIndex = args.indexOf('--explain')
const explain = explainIndex >= 0 ? parseLookup(args[explainIndex + 1]) : null
if (explainIndex >= 0 && !explain) {
  console.error(`--explain needs a record or area like "AD 556796", "CO 12" or "GA 8837", not "${args[explainIndex + 1] ?? ''}"`)
  process.exit(1)
}
const log = explain ? () => {} : console.log

// 1. The TaxonWorks data: downloaded, or read from a saved folder.
const data = fromDir ? loadData(fromDir) : await downloadData({ root: ROOT, log })
if (saveDir && !fromDir) {
  saveData(saveDir, data)
  log(`TaxonWorks data saved to ${saveDir}`)
}
const rows = parseTsv(data.csv)
const distributions = new Map(data.distributions.map((ad) => [String(ad.id), ad]))
log(`${rows.length} occurrences, ${distributions.size} asserted distributions${fromDir ? ` (from ${fromDir})` : ''}`)

// 2. Status, following the project's conventions for asserted distributions
// (curculionidae.github.io/docs/TutorialAssertedDistributions/):
// - refuted or doubted: the distribution carries a "Reassessment" data
//   attribute, or an "is absent" distribution exists for the same taxon and
//   area. It is kept in TaxonWorks so nobody adds it again; here it no longer
//   counts and is shown as reassessed, with the note and the refuting source.
// - the keywords "Adventive" and "Endemic", as tags on a distribution (and
//   "Adventive" also on a specimen).
const normalize = (name) => String(name || '').trim().toLocaleLowerCase()
const tagsByObject = new Map() // "AssertedDistribution:12" -> Set of lowercase keywords
for (const tag of data.statusTags) {
  const key = `${tag.tag_object_type}:${tag.tag_object_id}`
  if (!tagsByObject.has(key)) tagsByObject.set(key, new Set())
  tagsByObject.get(key).add(normalize(tag.keyword?.name))
}
const attributeSources = new Map() // data attribute id -> [source label]
for (const citation of data.reassessmentCitations) {
  const label = citation.source?.cached || citation.citation_source_body || ''
  if (!label) continue
  const id = String(citation.citation_object_id)
  if (!attributeSources.has(id)) attributeSources.set(id, [])
  attributeSources.get(id).push(label.replace(/<[^>]+>/g, ''))
}
const reassessmentsByDistribution = new Map() // AD id -> [{ note, sources }]
for (const attribute of data.reassessments) {
  const id = String(attribute.attribute_subject_id)
  if (!reassessmentsByDistribution.has(id)) reassessmentsByDistribution.set(id, [])
  reassessmentsByDistribution.get(id).push({ note: attribute.value || '', sources: attributeSources.get(String(attribute.id)) || [] })
}
log(`${data.statusTags.length} adventive/endemic tags, ${data.reassessments.length} reassessments`)

// 3. Distributions asserted for a biological association ("egg of Lixus bidens
// collected from stem of Opopanax", in Greece) are never in TaxonWorks' DwC
// export. Each becomes a record here for every beetle side of the association,
// with the name and classification from that OTU's other DwC records, or from
// TaxonWorks when it has none. `association` keeps the reading. They are
// asserted distributions on an area, so they are placed like any other.
const associations = new Map(data.associations.map((association) => [association.id, association]))
const rowByOtu = new Map()
for (const row of rows) if (row.otu_id && row.scientificName && !rowByOtu.has(row.otu_id)) rowByOtu.set(row.otu_id, row)
const TAXON_FIELDS = ['scientificName', 'scientificNameAuthorship', 'taxonRank', 'kingdom', 'superfamily', 'family', 'subfamily', 'tribe', 'subtribe', 'genus', 'nomenclaturalCode']
const skippedAssociationOtus = []
function otuTaxonRow(otuId) {
  if (rowByOtu.has(otuId)) return rowByOtu.get(otuId)
  // Not in the DwC export at all: the OTU's taxon name (classification comes
  // later from the parents lookup, as for field occurrences). A stale or
  // hidden OTU (4xx at download) is skipped and reported.
  const found = data.associationOtus[otuId]
  let row = null
  if (found?.error) skippedAssociationOtus.push(`${otuId} (${found.error})`)
  else if (found?.taxonName) {
    const name = found.taxonName
    row = {
      otu_id: otuId,
      scientificName: [name.cached, name.cached_author_year].filter(Boolean).join(' '),
      scientificNameAuthorship: name.cached_author_year || '',
      taxonRank: name.rank || ''
    }
  }
  rowByOtu.set(otuId, row)
  return row
}
let associationRecords = 0
const associationDistributions = data.distributions.filter((ad) => ad.asserted_distribution_object_type === 'BiologicalAssociation')
for (const ad of associationDistributions) {
  const association = associations.get(ad.asserted_distribution_object_id)
  if (!association) continue
  const reading = [association.subject?.label, association.relationship, association.object?.label].filter(Boolean).join(' ')
  for (const otuId of beetleSides(association)) {
    const taxonRow = otuTaxonRow(otuId)
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
log(`${associationDistributions.length} association distributions (not in the DwC export): ${associationRecords} records`)
if (skippedAssociationOtus.length) console.warn(`association OTUs not found in TaxonWorks: ${skippedAssociationOtus.join(', ')}`)

// 4. Classification of OTUs the DwC export leaves without one (field
// occurrences): from the OTU's parents, by name endings. null marks a failed
// lookup (a stale or hidden OTU): its records are not counted anywhere.
const RANK_ENDINGS = [
  ['superfamily', /oidea$/], ['family', /idae$/], ['subfamily', /inae$/],
  ['tribe', /ini$/], ['subtribe', /ina$/]
]
const parentClassification = new Map()
const failedLookups = []
for (const [otuId, parents] of Object.entries(data.otuParents)) {
  if (parents?.error) {
    parentClassification.set(otuId, null)
    failedLookups.push(`${otuId} (${parents.error})`)
    continue
  }
  const classification = {}
  for (const name of Object.keys(parents || {})) {
    for (const [rank, ending] of RANK_ENDINGS) if (ending.test(name)) classification[rank] = name
  }
  parentClassification.set(otuId, classification)
}
log(`${parentClassification.size - failedLookups.length} OTUs classified from their parents`)
if (failedLookups.length) console.warn(`classification lookup failed for ${failedLookups.length} OTUs: ${failedLookups.join(', ')}`)

// 5. The placement engine: areas, rules, checklists, outlines.
const areas = new Map() // area key -> Area, every area a distribution uses
for (const ad of data.distributions) {
  if (!ad.asserted_distribution_shape) continue
  const area = toArea(ad.asserted_distribution_shape_type, ad.asserted_distribution_shape)
  if (!areas.has(area.key)) areas.set(area.key, area)
}
const areaOf = (ad) => (ad?.asserted_distribution_shape
  ? areas.get(`${ad.asserted_distribution_shape_type === 'Gazetteer' ? 'GZ' : 'GA'} ${ad.asserted_distribution_shape.id}`)
  : null)
const areasById = new Map([...areas.values()].filter((area) => area.kind === 'GA').map((area) => [area.id, area]))
const rules = compileRules(readFileSync(RULES_FILE, 'utf8'))
const level0Names = level0NamesFrom(rows, data.distributions)
const isoByName = new Map(Object.entries(JSON.parse(readFileSync(join(MODULE, 'scripts/data/country-iso.json'), 'utf8')))
  .map(([name, iso]) => [normalizeName(name), iso]))
const { checklists, warnings } = deriveChecklists([...areas.values()], rules, level0Names, isoByName)
const keys = assignKeys(checklists) // stops on two checklists with one key
const checklistById = new Map(checklists.map((checklist) => [checklist.id, checklist]))
const shapes = listShapes(SHAPE_DIR)
const geometry = createNodeGeometry({ shapeDir: SHAPE_DIR, fallbackFile: FALLBACK_FILE, subdivisionsFile: SUBDIVISIONS_FILE, checklists, rules })
const ctx = createContext({ checklists, rules, geometry, shapes })

// An area's placement, the same for every distribution on it.
const areaPlacements = new Map()
async function placeAreaRecord(area) {
  if (!areaPlacements.has(area.key)) areaPlacements.set(area.key, await placeRecord({ type: 'AssertedDistribution', id: 0 }, ctx, area))
  return areaPlacements.get(area.key)
}
// A specimen or field occurrence, by its DwC fields.
const recordInput = (row) => ({
  type: row.dwc_occurrence_object_type,
  id: Number(row.dwc_occurrence_object_id),
  country: row.country,
  stateProvince: row.stateProvince,
  county: row.county,
  locality: row.verbatimLocality || row.locality,
  lat: row.decimalLatitude,
  lng: row.decimalLongitude
})
// What formatPlacement prints first: kind, id, label and the area behind it.
const subjectOf = (row, area) => ({
  kind: KIND[row.dwc_occurrence_object_type] ?? row.dwc_occurrence_object_type,
  id: row.dwc_occurrence_object_id,
  label: row.scientificName || '',
  ...(area ? { area } : {})
})

// --explain: one record or area, then stop.
if (explain) {
  console.log(await explainOne(explain))
  process.exit(0)
}

// 6. Place, filter and collect.
const KEEP = [
  'id', 'dwc_occurrence_object_type', 'dwc_occurrence_object_id', 'otu_id', 'country',
  'stateProvince', 'county', 'municipality', 'verbatimLocality', 'scientificName',
  'scientificNameAuthorship', 'taxonRank', 'basisOfRecord', 'institutionCode',
  // Only what the page shows: collector, date and occurrenceID were CSV-only
  // and made up most of the files (occurrenceID UUIDs hardly compress).
  'catalogNumber', 'associatedReferences', 'superfamily', 'family', 'subfamily', 'tribe', 'subtribe', 'genus'
]
// A taxon is its name: several OTUs of one name count once (as on the page).
// Exactly as the page's speciesKey (each part trimmed), so the cached counts
// and the page's list always agree.
const taxonKey = (record) => `${String(record.scientificName || '').trim()} ${String(record.scientificNameAuthorship || '').trim()}`.trim().toLocaleLowerCase() || String(record.otu_id)
const subdivisionNames = new Map() // level1 id -> name (the `region` of a record)
for (const area of areasById.values()) if (area.level1 === area.id) subdivisionNames.set(area.id, area.name)

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

const byChecklist = new Map() // checklist id -> [{ record, area, placement }]
const unplacedEntries = [] // { reason, kind, id }
const unplaced = { records: 0, taxa: new Set() }
const recordsByArea = new Map() // area key -> number of records on it (placed or not)
const placedBy = new Map() // 'AD [TaxonWorks]' -> count
for (const row of rows) {
  if (!RANKS.has(row.taxonRank) || !row.otu_id) continue
  if (normalize(row.occurrenceStatus) === 'absent') continue
  const lookupFailed = !row.superfamily && parentClassification.get(row.otu_id) === null
  const classification = row.superfamily ? row : { ...row, ...parentClassification.get(row.otu_id) }
  if (!classification.genus) classification.genus = String(row.scientificName || '').split(' ')[0]
  if (classification.superfamily !== SUPERFAMILY && !lookupFailed) continue

  const type = row.dwc_occurrence_object_type
  const kind = KIND[type] ?? type
  const id = Number(row.dwc_occurrence_object_id)
  const ad = type === 'AssertedDistribution' ? distributions.get(String(row.dwc_occurrence_object_id)) : null
  if (ad?.is_absent) continue
  const area = ad ? areaOf(ad) : null
  if (area) recordsByArea.set(area.key, (recordsByArea.get(area.key) ?? 0) + 1)

  let placement
  if (type === 'AssertedDistribution') {
    placement = area ? await placeAreaRecord(area)
      : { checklist: null, reason: ad ? 'distribution has no area' : 'distribution not downloaded', steps: [] }
  } else {
    placement = await placeRecord(recordInput(row), ctx)
  }
  if (verbose && placement.steps.length) console.log(formatPlacement(subjectOf(row, area), placement))

  // Unclassified records may not be weevils: listed in unplaced.json, but not
  // counted as left-out weevil records.
  if (lookupFailed) { unplacedEntries.push({ reason: 'classification lookup failed', kind, id }); continue }
  if (!placement.checklist) {
    unplacedEntries.push({ reason: placement.reason, kind, id })
    unplaced.records++
    unplaced.taxa.add(taxonKey(row))
    continue
  }
  const source = `${kind} [${decidingSource(placement)}]`
  placedBy.set(source, (placedBy.get(source) ?? 0) + 1)

  const record = {}
  for (const key of KEEP) {
    const value = classification[key]
    if (value !== '' && value != null) record[key] = value
  }
  const checklist = checklistById.get(placement.checklist.id)
  record.country = checklist.name
  const region = ad?.asserted_distribution_shape_type === 'GeographicArea' && subdivisionNames.get(area?.level1)
  if (region) record.region = region
  if (placement.part) record.part = placement.part
  if (placement.state) record.state = placement.state
  const reassessed = ad && [
    ...(reassessmentsByDistribution.get(String(ad.id)) || []),
    ...(absentPairs.get(`${taxonKey(row)}|${shapeKeyOf(ad)}`) || [])
  ]
  if (reassessed?.length) record.reassessed = reassessed
  const tags = tagsByObject.get(`${type}:${row.dwc_occurrence_object_id}`)
  if (tags?.has('adventive')) record.adventive = true
  if (tags?.has('endemic')) record.endemic = true
  if (row.association) record.association = row.association
  if (ad) {
    record.place = ad.asserted_distribution_shape?.name || ''
    record.citations = (ad.citations || [])
      .map((citation) => ({ id: String(citation.id), full: citation.source?.name || '', pages: citation.pages || '' }))
      .filter((citation) => citation.full)
    delete record.associatedReferences
  }
  if (!byChecklist.has(checklist.id)) byChecklist.set(checklist.id, [])
  byChecklist.get(checklist.id).push({ record, area, placement })
}

// 7. Write. Files are overwritten in place and only stale ones removed
// (recreating the folder makes a running dev server lose track of them).
mkdirSync(COUNTRY_DIR, { recursive: true })
const written = new Set([...byChecklist.keys()].map((id) => `${keys.get(id)}.json`))
for (const file of readdirSync(COUNTRY_DIR)) if (!written.has(file)) rmSync(join(COUNTRY_DIR, file))
// The debugging overview of the old build is replaced by the curator page.
if (existsSync(join(OUT_DIR, 'overview.html'))) rmSync(join(OUT_DIR, 'overview.html'))

// Every used GA area, plus the parents known only by their name (GA 78 French
// Guiana, the parent of Cayenne), for the names in `defined_by`.
const knownAreas = new Map(areasById)
for (const area of areasById.values()) {
  if (area.parentId != null && !knownAreas.has(area.parentId)) {
    knownAreas.set(area.parentId, { key: `GA ${area.parentId}`, kind: 'GA', id: area.parentId, name: area.parentName, parentName: null, stub: true })
  }
}

// The outline of a checklist: its first cached area, else the fallback file.
const targets = new Map(geometry.checklistTargets().map((target) => [target.id, target]))
const fallbackNames = new Set(JSON.parse(readFileSync(FALLBACK_FILE, 'utf8')).features.map((feature) => feature.properties.name))
const cachedGa = (ids) => ids.find((id) => shapes.has(`GeographicArea/${id}`))
function outlineOf(checklist) {
  const id = cachedGa(checklist.areaIds)
  if (id != null) return { shape: `GeographicArea/${id}`, outline: `GeographicArea/${id}` }
  return { shape: null, outline: fallbackNames.has(checklist.name) ? `fallback/${checklist.name}` : null }
}

// taxa.json, counted in the same pass as index.json (one rule for what
// counts): for every higher taxon (family, subfamily, tribe, subtribe, genus)
// its number of taxa in each checklist and over all of them. The page loads it
// only when someone filters by taxon, to colour the map and the country list.
const HIGHER_RANKS = ['family', 'subfamily', 'tribe', 'subtribe', 'genus']
const higherTaxa = new Map() // "rank:name" -> { index, rank, name, all: Set(taxon keys) }
const countsByChecklist = {}
const index = []
for (const [id, entries] of byChecklist) {
  const checklist = checklistById.get(id)
  const key = keys.get(id)
  const records = entries.map((entry) => entry.record)
  const { shape, outline } = outlineOf(checklist)
  const header = checklistHeader({
    key,
    name: checklist.name,
    iso2: checklist.iso2,
    outline,
    definedBy: definedBy(checklist, { areasById: knownAreas, level0Names, rules }),
    areasUsed: areasUsed(entries.filter((entry) => entry.area)),
    specimens: specimensSummary(entries.filter((entry) => !entry.area).map((entry) => entry.placement)),
    built: BUILD_DATE
  })
  // Compact form (data/compact.js), expanded again by the page; the header first.
  writeFileSync(join(COUNTRY_DIR, `${key}.json`), JSON.stringify({ checklist: header, ...compactChecklist(records) }))

  // Reassessed records do not count; a taxon known only from them is shown on
  // the page (as reassessed) but counted nowhere.
  const counted = records.filter((record) => !record.reassessed)
  const perTaxon = new Map() // higher-taxon index -> Set(taxon keys)
  for (const record of counted) {
    for (const rank of HIGHER_RANKS) {
      const taxonName = record[rank]
      if (!taxonName) continue
      const higherKey = `${rank}:${taxonName}`
      if (!higherTaxa.has(higherKey)) higherTaxa.set(higherKey, { index: higherTaxa.size, rank, name: taxonName, all: new Set() })
      const higher = higherTaxa.get(higherKey)
      higher.all.add(taxonKey(record))
      if (!perTaxon.has(higher.index)) perTaxon.set(higher.index, new Set())
      perTaxon.get(higher.index).add(taxonKey(record))
    }
  }
  countsByChecklist[key] = Object.fromEntries([...perTaxon].map(([taxonIndex, set]) => [taxonIndex, set.size]))
  const parts = rules.parts[checklist.name]?.map((part) => {
    const partId = cachedGa(part.areas.filter((areaKey) => areaKey.startsWith('GA ')).map((areaKey) => Number(areaKey.slice(3))))
    return { name: part.name, shape: partId != null ? `GeographicArea/${partId}` : null }
  })
  index.push(indexEntry({
    key,
    name: checklist.name,
    iso2: checklist.iso2,
    of: rules.checklists.find((entry) => entry.name === checklist.name)?.of,
    shape,
    bbox: bboxOf(targets.get(id)?.polygons),
    parts,
    states: Boolean(checklist.states),
    taxa: new Set(counted.map(taxonKey)).size,
    records: records.length
  }))
}
index.sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(join(OUT_DIR, 'taxa.json'), JSON.stringify({
  taxa: [...higherTaxa.values()].map(({ rank, name, all }) => [rank, name, all.size]),
  counts: countsByChecklist
}))
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({
  // The local date of the build (toISOString is UTC: a build after midnight
  // in Europe was stamped with the day before).
  updated: BUILD_DATE,
  countries: index,
  unplaced: { records: unplaced.records, taxa: unplaced.taxa.size }
}, null, 1))
writeFileSync(join(OUT_DIR, 'rules.json'), JSON.stringify(rules))
writeFileSync(join(OUT_DIR, 'unplaced.json'), JSON.stringify(groupUnplaced(unplacedEntries)))

// areas.json: every area a distribution uses, then the parents known only as
// parents (records 0, no placement), for the curator page's area tree.
// `records` counts the build's records on the area (after the filters above).
const areaRows = []
for (const area of areas.values()) {
  const { key, name, origin, type, tdwg, iso2, parentId, parentName } = area
  const placement = publicPlacement(await placeAreaRecord(area), keys)
  areaRows.push({ key, name, origin, type, tdwg, iso2, parentId, parentName, records: recordsByArea.get(key) ?? 0, placement })
}
const stubs = new Map()
for (const area of areas.values()) {
  if (area.parentId == null || areasById.has(area.parentId) || stubs.has(area.parentId)) continue
  stubs.set(area.parentId, {
    key: `GA ${area.parentId}`, name: area.parentName, origin: null, type: null, tdwg: null, iso2: null,
    parentId: null, parentName: null, records: 0, placement: null
  })
}
writeFileSync(join(OUT_DIR, 'areas.json'), JSON.stringify([...areaRows, ...stubs.values()]))

// 8. Summary.
const total = (map) => [...map.values()].reduce((sum, n) => sum + n, 0)
console.log(`taxa.json: ${higherTaxa.size} higher taxa`)
console.log(`${checklists.length} checklists derived, ${index.length} with records written`)
console.log(`placed: ${total(placedBy)} records; by deciding source: ${[...placedBy].sort().map(([source, n]) => `${source} ${n}`).join(', ')}`)
const unplacedGroups = groupUnplaced(unplacedEntries)
console.log(`unplaced: ${unplaced.records} records of ${unplaced.taxa.size} taxa; by reason:`)
for (const [reason, ids] of Object.entries(unplacedGroups)) console.log(`  ${String(ids.length).padStart(6)}  ${reason}`)
if (warnings.length) console.log(`deriveChecklists warnings (${warnings.length}):\n  ${warnings.join('\n  ')}`)
const noIso = index.filter((entry) => !entry.iso2).map((entry) => entry.name)
console.log(`checklists without iso2: ${noIso.length ? noIso.join(', ') : 'none'}`)
const noOutline = index.filter((entry) => !entry.shape && !fallbackNames.has(entry.name)).map((entry) => entry.name)
if (noOutline.length) console.log(`not on the map (no cached or fallback outline): ${noOutline.join(', ')}`)

// The text of one record or area for --explain.
async function explainOne({ kind, id }) {
  if (kind === 'GA' || kind === 'GZ') {
    const area = areas.get(`${kind} ${id}`)
    if (!area) return `${kind} ${id}: no asserted distribution uses this area`
    return formatPlacement({ kind, id, label: area.name, area }, await placeAreaRecord(area))
  }
  const type = Object.keys(KIND).find((name) => KIND[name] === kind)
  const row = rows.find((candidate) => candidate.dwc_occurrence_object_type === type && Number(candidate.dwc_occurrence_object_id) === id)
  if (kind === 'AD') {
    const ad = distributions.get(String(id))
    if (!ad) return `AD ${id}: not among the downloaded asserted distributions`
    const area = areaOf(ad)
    const subject = { kind, id, label: row?.scientificName || '', ...(area ? { area } : {}) }
    if (!area) return `${subject.kind} ${id}  ${subject.label}\n  result   not placeable: distribution has no area`
    return formatPlacement(subject, await placeAreaRecord(area))
  }
  if (!row) return `${kind} ${id}: not in the DwC export`
  return formatPlacement(subjectOf(row, null), await placeRecord(recordInput(row), ctx))
}
