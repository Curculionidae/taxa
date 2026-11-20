#!/usr/bin/env node
// Builds public/checklists/: the data of the country checklists page
// (modules/checklists/ChecklistsPage.vue), so a visitor loads one small file per
// country instead of paging through the project's 80,000 DwC occurrences.
//
// Usage
//   npm run checklists -- [--save <dir> | --from <dir>] [--verbose] [--explain "AD 556796"]
//   (--save and --from exclude each other)
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
//   context.json           the engine checklists, their outlines and the cached
//                          outline keys: with rules.json, all the curator page
//                          needs to place a record exactly as this build does
//   areas.json             every area a distribution uses, with its placement
//   unplaced.json          the records no rule places, by reason
// Country files of checklists that no longer exist are removed.
//
// How records are placed: by the placement engine (placement/engine.js), the
// same code the curator page runs. Asserted distributions (also those asserted
// for a biological association) by their area, specimens and field occurrences
// by their DwC country, else by their coordinates; then the part (France) and
// the state (rules file state_countries). The checklists themselves come from
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
import { placeRecord } from '../placement/engine.js'
import { formatPlacement, parseLookup } from '../placement/format.js'
import { downloadData, saveData, loadData } from './download.mjs'
import { createBuildContext, buildPaths, KIND } from './buildContext.mjs'
import {
  groupUnplaced, bboxOf, definedBy, areasUsed, specimensSummary, checklistHeader,
  indexEntry, publicPlacement, decidingSource, partShapes, cacheContext
} from './cacheFiles.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const { outDir: OUT_DIR, defaultDataDir: DEFAULT_DATA_DIR } = buildPaths(ROOT)
const COUNTRY_DIR = join(OUT_DIR, 'countries/')
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
if (fromDir && saveDir) {
  console.error('--save and --from do not go together: --from reads saved data, --save keeps a new download')
  process.exit(1)
}
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
if (saveDir) {
  saveData(saveDir, data)
  log(`TaxonWorks data saved to ${saveDir}`)
}
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

// 3. to 5. The records, areas, rules, checklists and the engine context
// (buildContext.mjs, shared with compare.mjs).
const {
  rows, distributions, areas, areaOf, areasById, rules, level0Names, checklists, warnings, keys,
  checklistById, shapes, unusable, stateAreas, geometry, ctx, placeAreaRecord, recordInput, subjectOf, explainOne,
  screenRow
} = await createBuildContext(data, { root: ROOT, log, fromDir })

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
  const { left, classification, lookupFailed, ad } = screenRow(row)
  if (left) continue

  const type = row.dwc_occurrence_object_type
  const kind = KIND[type] ?? type
  const id = Number(row.dwc_occurrence_object_id)
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

// Parents known only by their name (GA 78 French Guiana, the parent of
// Cayenne, no distribution uses it), once: for the names in `defined_by` and
// as stubs at the end of areas.json.
const parentStubs = new Map() // GA id -> { key, kind, id, name, parentName, stub }
for (const area of areas.values()) {
  if (area.parentId == null || areasById.has(area.parentId) || parentStubs.has(area.parentId)) continue
  parentStubs.set(area.parentId, { key: `GA ${area.parentId}`, kind: 'GA', id: area.parentId, name: area.parentName, parentName: null, stub: true })
}
const knownAreas = new Map([...areasById, ...parentStubs])

// The outline of a checklist, the Node geometry's own choice
// (placement/geometry.js checklistOutline): its first cached area, else the
// fallback feature named like the checklist or one of its synonyms
// ("Saint Barthelemy" for Saint Barthélemy); a rules entry with
// `outline: natural_earth` takes the fallback first (Norfolk Island).
const targets = new Map(geometry.checklistTargets().map((target) => [target.id, target]))
function outlineOf(checklist) {
  const { key, fallback } = geometry.outlineOf(checklist)
  return { shape: fallback == null ? key : null, fallback, outline: key }
}

// taxa.json, counted in the same pass as index.json (one rule for what
// counts): for every higher taxon (family, subfamily, tribe, subtribe, genus)
// its number of taxa in each checklist and over all of them. The page loads it
// only when someone filters by taxon, to colour the map and the country list.
const HIGHER_RANKS = ['family', 'subfamily', 'tribe', 'subtribe', 'genus']
const higherTaxa = new Map() // "rank:name" -> { index, rank, name, all: Set(taxon keys) }
const countsByChecklist = {}
const partsWithoutShape = []
const index = []
for (const [id, entries] of byChecklist) {
  const checklist = checklistById.get(id)
  const key = keys.get(id)
  const records = entries.map((entry) => entry.record)
  const { shape, fallback, outline } = outlineOf(checklist)
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
  const parts = rules.parts[checklist.name] && partShapes(rules.parts[checklist.name], shapes)
  // The page skips a part without outline, so each one must have a cached area.
  for (const part of parts ?? []) if (!part.shape) partsWithoutShape.push(`${checklist.name}: ${part.name}`)
  index.push(indexEntry({
    key,
    name: checklist.name,
    iso2: checklist.iso2,
    of: rules.checklists.find((entry) => entry.name === checklist.name)?.of,
    shape,
    fallback,
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
writeFileSync(join(OUT_DIR, 'context.json'), JSON.stringify(cacheContext({
  built: BUILD_DATE, checklists, targets: geometry.checklistTargets(), shapes, unusable, stateAreas
})))
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
const stubRows = [...parentStubs.values()].map(({ key, name }) => ({
  key, name, origin: null, type: null, tdwg: null, iso2: null, parentId: null, parentName: null, records: 0, placement: null
}))
writeFileSync(join(OUT_DIR, 'areas.json'), JSON.stringify([...areaRows, ...stubRows]))

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
const noOutline = index.filter((entry) => !entry.shape && !entry.fallback).map((entry) => entry.name)
if (noOutline.length) console.log(`not on the map (no cached or fallback outline): ${noOutline.join(', ')}`)
if (partsWithoutShape.length) console.warn(`warning: parts without a cached outline (give them a cached GA area in the rules file): ${partsWithoutShape.join(', ')}`)
