// The placement context of the build, made from the TaxonWorks data: the
// records (DwC rows plus the records of distributions asserted for a
// biological association), the areas, the rules, the checklists and the
// engine context, with the helpers that place one record.
//
// Purpose: one place that turns the downloaded data into placements, shared by
// build.mjs (which writes the cache) and compare.mjs (which compares two
// caches and explains every change with exactly the build's code). Moved out
// of build.mjs (its steps 3 to 5 and the --explain text) without changing
// what it does.
//
// Input:  the data of download.mjs (downloadData or loadData), the project root
//         (for rules/placement.yml, public/map-shapes/, the outline files of
//         public/checklists/ and scripts/data/country-iso.json).
// Output: createBuildContext returns the parsed rows, the asserted
//         distributions by id, the areas, the compiled rules, the checklists
//         and their keys, the outlines, the engine context and the helpers
//         placeAreaRecord, recordInput, subjectOf, screenRow (which rows the
//         build counts), rowsOf, placementOf (one record's placement) and
//         explainOne (the text the build's --explain prints). loadBuildContext does the same from a
//         saved data folder.
// Side effects: none besides reading files and the log and warn calls.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileRules } from '../placement/rules.js'
import { toArea, normalizeName } from '../placement/areas.js'
import { deriveChecklists } from '../placement/checklists.js'
import { createContext, placeRecord } from '../placement/engine.js'
import { formatPlacement, formatExplanation } from '../placement/format.js'
import { createNodeGeometry, listShapes } from './geometry-node.mjs'
import { loadData, parseTsv, level0NamesFrom, beetleSides } from './download.mjs'
import { assignKeys } from './cacheFiles.mjs'

export const KIND = { AssertedDistribution: 'AD', CollectionObject: 'CO', FieldOccurrence: 'FO' }
const SUPERFAMILY = 'Curculionoidea'
const RANKS = new Set(['species', 'subspecies'])
const normalize = (name) => String(name || '').trim().toLocaleLowerCase()

/**
 * The paths the build reads besides the TaxonWorks data.
 * @param {string} root  the project root, ending in a slash
 */
export function buildPaths(root) {
  const module = join(root, 'modules/checklists/')
  const outDir = join(root, 'public/checklists/')
  return {
    module,
    outDir,
    shapeDir: join(root, 'public/map-shapes/'),
    fallbackFile: join(outDir, 'fallback-shapes.geojson'),
    subdivisionsFile: join(outDir, 'subdivisions.geojson'),
    rulesFile: join(module, 'rules/placement.yml'),
    defaultDataDir: join(module, '.cache/data')
  }
}

/**
 * The placement context from downloaded or saved TaxonWorks data.
 * @param {import('./download.mjs').Data} data
 * @param {{ root: string, log?: Function, warn?: Function, fromDir?: string|null }} options
 *   fromDir only names the folder in the first log line
 */
export async function createBuildContext(data, { root, log = console.log, warn = console.warn, fromDir = null }) {
  const { module: MODULE, shapeDir: SHAPE_DIR, fallbackFile: FALLBACK_FILE, subdivisionsFile: SUBDIVISIONS_FILE, rulesFile: RULES_FILE } = buildPaths(root)
  const rows = parseTsv(data.csv)
  const distributions = new Map(data.distributions.map((ad) => [String(ad.id), ad]))
  log(`${rows.length} occurrences, ${distributions.size} asserted distributions${fromDir ? ` (from ${fromDir})` : ''}`)

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
  if (skippedAssociationOtus.length) warn(`association OTUs not found in TaxonWorks: ${skippedAssociationOtus.join(', ')}`)

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
  if (failedLookups.length) warn(`classification lookup failed for ${failedLookups.length} OTUs: ${failedLookups.join(', ')}`)

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

  // Which rows the build counts. screenRow gives the row's classification
  // (field occurrences take theirs from the OTU's parents) or, for a row the
  // build leaves out, `left` with the reason: only taxa of Curculionoidea at
  // species rank and below, present (not absent) records. A failed parents
  // lookup is not left out: the build lists it as unplaced.
  function screenRow(row) {
    if (!RANKS.has(row.taxonRank)) return { left: `rank ${row.taxonRank || 'none'}` }
    if (!row.otu_id) return { left: 'no OTU' }
    if (normalize(row.occurrenceStatus) === 'absent') return { left: 'recorded as absent' }
    const lookupFailed = !row.superfamily && parentClassification.get(row.otu_id) === null
    const classification = row.superfamily ? row : { ...row, ...parentClassification.get(row.otu_id) }
    if (!classification.genus) classification.genus = String(row.scientificName || '').split(' ')[0]
    if (classification.superfamily !== SUPERFAMILY && !lookupFailed) return { left: `not in ${SUPERFAMILY} (${classification.superfamily || 'no superfamily'})` }
    const ad = row.dwc_occurrence_object_type === 'AssertedDistribution' ? distributions.get(String(row.dwc_occurrence_object_id)) : null
    if (ad?.is_absent) return { left: 'distribution is absent' }
    return { classification, lookupFailed, ad }
  }

  // The rows by "<KIND> <id>" (an association distribution has one per beetle side).
  let rowsByKey = null
  function rowsOf(kind, id) {
    if (!rowsByKey) {
      rowsByKey = new Map()
      for (const row of rows) {
        const key = `${KIND[row.dwc_occurrence_object_type] ?? row.dwc_occurrence_object_type} ${Number(row.dwc_occurrence_object_id)}`
        if (!rowsByKey.has(key)) rowsByKey.set(key, [])
        rowsByKey.get(key).push(row)
      }
    }
    return rowsByKey.get(`${kind} ${id}`) ?? []
  }

  // The subject and placement of one record ({ kind: 'AD', id: 556796 }), as
  // the build places it; `missing` instead when there is nothing to place.
  // `row` picks one row of an association distribution (default the first).
  async function placementOf({ kind, id }, row = rowsOf(kind, id)[0]) {
    if (kind === 'AD') {
      const ad = distributions.get(String(id))
      if (!ad) return { missing: `AD ${id}: not among the downloaded asserted distributions` }
      const area = areaOf(ad)
      const subject = { kind, id, label: row?.scientificName || '', ...(area ? { area } : {}) }
      if (!area) return { subject, placement: { checklist: null, part: null, state: null, shape: null, reason: 'distribution has no area', steps: [] } }
      return { subject, placement: await placeAreaRecord(area) }
    }
    if (!row) return { missing: `${kind} ${id}: not in the DwC export` }
    return { subject: subjectOf(row, null), placement: await placeRecord(recordInput(row), ctx) }
  }

  // The text of one record or area for --explain.
  async function explainOne({ kind, id }) {
    if (kind === 'GA' || kind === 'GZ') {
      const area = areas.get(`${kind} ${id}`)
      if (!area) return `${kind} ${id}: no asserted distribution uses this area`
      return formatPlacement({ kind, id, label: area.name, area }, await placeAreaRecord(area))
    }
    const { missing, subject, placement } = await placementOf({ kind, id })
    if (missing) return missing
    return formatExplanation(subject, placement)
  }

  return {
    rows, distributions, areas, areaOf, areasById, rules, level0Names, checklists, warnings, keys,
    checklistById, shapes, geometry, ctx, placeAreaRecord, recordInput, subjectOf, explainOne,
    parentClassification, screenRow, rowsOf, placementOf
  }
}

/**
 * createBuildContext from a folder saved with --save.
 * @param {string} dir
 * @param {{ root: string, log?: Function, warn?: Function }} options
 */
export async function loadBuildContext(dir, options) {
  return createBuildContext(loadData(dir), { ...options, fromDir: dir })
}
