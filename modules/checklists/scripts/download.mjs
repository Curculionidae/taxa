// Downloads from TaxonWorks everything the checklist build needs, and saves or
// reads it as plain files for offline runs.
//
// Purpose: the build (build.mjs) places records and writes the cache; this
// module only talks to TaxonWorks. With `--save <dir>` the build writes what
// was downloaded into <dir>, with `--from <dir>` it reads it from there and
// never touches the network, so placement can be rerun and compared in
// seconds. measure-overlap.mjs reads the same folder (distributions.json and
// dwc_occurrences.csv).
//
// What is downloaded (about 3 minutes), and the file it is saved as:
//   dwc_occurrences.csv          GET /dwc_occurrences.csv, every DwC occurrence
//                                in one request, as TaxonWorks sends it (tab
//                                separated). Not paged: /dwc_occurrences has no
//                                ORDER BY, so pages overlap and about 5% of the
//                                rows are missed or doubled (measured 2026-11-17).
//   distributions.json           GET /asserted_distributions with
//                                extend[]=asserted_distribution_shape, every page
//                                (ordered by id, so paging is safe), as an array
//                                in the order the API returns it
//   status_tags.json             the tags with the keywords "Adventive" and
//                                "Endemic" (GET /controlled_vocabulary_terms, then
//                                GET /tags), on any kind of record
//   reassessments.json           the "Reassessment" data attributes of asserted
//                                distributions (GET /data_attributes)
//   reassessment_citations.json  the citations of those data attributes, with
//                                their source (GET /citations, extend[]=source)
//   associations.json            the biological associations that asserted
//                                distributions are asserted for
//                                (GET /biological_associations/basic)
//   association_otus.json        { [otuId]: { otu, taxonName } | { error } } for
//                                association OTUs with no row in the DwC export
//                                (GET /otus/:id, GET /taxon_names/:id)
//   otu_parents.json             { [otuId]: parents | { error } } for OTUs the
//                                DwC export leaves without classification (field
//                                occurrences), GET /otus/:id?extend[]=parents
//   type_names.json              { [name and authorship]: { taxonName, valid,
//                                otuId } | { error } }: the names in the
//                                typeStatus of undetermined type specimens
//                                (collection objects without otu_id),
//                                resolved by placement/typeStatus.js
//                                resolveTypeName (about 45 s); their OTUs are
//                                added to the otu_parents.json lookups
//   specimen_areas.json          { [collectionObjectId]: geographicAreaId }, the
//                                area of each specimen's collecting event, for
//                                the specimens whose collecting event has one:
//                                GET /collecting_events, every page (ordered by
//                                id), then GET /collection_objects with
//                                collecting_event_id[] for those with an area
//                                (about 15 s). The DwC export has no collecting
//                                event id, and field occurrences have no index
//                                route, so they are not covered.
// A client error (404, 403: a stale or hidden OTU) is kept as { error } and
// reported by the build; a server or network failure after retries stops the
// download, so a cache missing data is never written.

import { typeStatusName, typeNameKey, resolveTypeName } from '../placement/typeStatus.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTsv } from '../data/tsv.js'

const PER = 500
const PARALLEL = 6
const SPECIES_RANKS = new Set(['species', 'subspecies'])
const STATUS_KEYWORDS = ['adventive', 'endemic']

/** The file names of a saved download, by part. */
export const FILES = {
  csv: 'dwc_occurrences.csv',
  distributions: 'distributions.json',
  statusTags: 'status_tags.json',
  reassessments: 'reassessments.json',
  reassessmentCitations: 'reassessment_citations.json',
  associations: 'associations.json',
  associationOtus: 'association_otus.json',
  otuParents: 'otu_parents.json',
  specimenAreas: 'specimen_areas.json',
  typeNames: 'type_names.json'
}

/**
 * @typedef {Object} TaxonWorksData  everything the build reads from TaxonWorks
 * @property {string} csv  the DwC occurrences, tab separated, as TaxonWorks exports them
 * @property {Object[]} distributions  asserted distributions with asserted_distribution_shape
 * @property {Object[]} statusTags  tags with the keywords Adventive or Endemic
 * @property {Object[]} reassessments  Reassessment data attributes of distributions
 * @property {Object[]} reassessmentCitations  citations of those attributes, with source
 * @property {Object[]} associations  biological associations behind distributions
 * @property {Object<string, { otu: Object, taxonName: Object|null } | { error: string }>} associationOtus
 * @property {Object<string, Object | { error: string }>} otuParents  OTU id to its `parents`
 */

const normalize = (name) => String(name || '').trim().toLocaleLowerCase()

export { parseTsv }

/**
 * Names of countries TaxonWorks uses only through their subdivisions (Spain):
 * the DwC country text of the distributions on areas with that level0 id. The
 * build and the measuring script pass it to deriveChecklists, so both get the
 * same checklists.
 * @param {Object<string, string>[]} rows  parsed DwC rows
 * @param {Object[]} distributions
 * @returns {Map<number, string>}  level0 id to country name, the first DwC country seen
 */
export function level0NamesFrom(rows, distributions) {
  const countryById = new Map()
  for (const row of rows) {
    if (row.dwc_occurrence_object_type === 'AssertedDistribution' && row.country) countryById.set(String(row.dwc_occurrence_object_id), row.country)
  }
  const names = new Map()
  for (const ad of distributions) {
    const level0 = ad.asserted_distribution_shape?.level0_id
    if (ad.asserted_distribution_shape_type !== 'GeographicArea' || level0 == null || names.has(level0)) continue
    const name = countryById.get(String(ad.id))
    if (name) names.set(level0, name)
  }
  return names
}

/**
 * Which OTUs need a lookup, from the DwC rows and the associations: the
 * association OTUs on the beetle side without a DwC row, and every OTU of a
 * species or subspecies row without superfamily (field occurrences). The build
 * uses the same function to read the saved answers, so both agree.
 * @param {Object[]} rows  parsed DwC rows
 * @param {Object[]} distributions
 * @param {Object[]} associations
 * @returns {{ associationOtus: string[], parentOtus: string[] }}
 */
export function otusToLookUp(rows, distributions, associations) {
  const withRow = new Set(rows.filter((row) => row.otu_id && row.scientificName).map((row) => row.otu_id))
  const byId = new Map(associations.map((association) => [association.id, association]))
  const associationOtus = new Set()
  for (const ad of distributions) {
    if (ad.asserted_distribution_object_type !== 'BiologicalAssociation') continue
    const association = byId.get(ad.asserted_distribution_object_id)
    if (!association) continue
    for (const otuId of beetleSides(association)) if (!withRow.has(otuId)) associationOtus.add(otuId)
  }
  const parentOtus = new Set(rows
    .filter((row) => !row.superfamily && row.otu_id && SPECIES_RANKS.has(row.taxonRank))
    .map((row) => row.otu_id))
  return { associationOtus: [...associationOtus], parentOtus: [...parentOtus] }
}

/**
 * The OTU ids of the beetle side(s) of an association: a side counts when it
 * has an OTU and its order is Coleoptera or unknown (a plant side would be
 * looked up for nothing).
 * @param {Object} association  from /biological_associations/basic
 * @returns {string[]}  distinct OTU ids as text
 */
export function beetleSides(association) {
  const sides = [[association.subject_otu_id, association.subject], [association.object_otu_id, association.object]]
    .filter(([otuId, side]) => otuId && (!side?.order || side.order === 'Coleoptera'))
    .map(([otuId]) => String(otuId))
  return [...new Set(sides)]
}

/**
 * Download everything from TaxonWorks (needs config/api.yml).
 * @param {{ root: string, log?: (text: string) => void }} options  root: the project folder
 * @returns {Promise<TaxonWorksData>}
 */
export async function downloadData({ root, log = console.log }) {
  const apiConfig = readFileSync(join(root, 'config/api.yml'), 'utf8')
  const base = apiConfig.match(/^\s*url:\s*['"]?([^'"\s]+)/m)[1]
  const token = apiConfig.match(/^\s*project_token:\s*['"]?([^'"\s]+)/m)[1]

  // Retries server errors, rate limits and network failures; after the last
  // try it throws. A client error (404, 403) is final and throws at once.
  async function request(path, params = []) {
    const query = new URLSearchParams([['project_token', token], ...params])
    for (let attempt = 1; ; attempt++) {
      let failure
      try {
        const response = await fetch(`${base}${path}?${query}`)
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
  // Small lists (hundreds) come in one page; checked.
  async function getOnePage(path, params) {
    const response = await request(path, [...params, ['per', 5000]])
    const total = Number(response.headers.get('pagination-total'))
    const list = await response.json()
    if (Number.isFinite(total) && total > list.length) throw new Error(`${path}: ${total} rows, only ${list.length} in one page`)
    return list
  }
  // A 4xx answer is kept as { error }, anything else stops the download.
  async function jsonOrError(path, params) {
    try {
      return await (await request(path, params)).json()
    } catch (error) {
      if (!/^4\d\d /.test(error.message)) throw error
      return { error: error.message }
    }
  }

  // 1. Every DwC occurrence, in one request.
  log('Downloading /dwc_occurrences.csv …')
  const csv = await (await request('/dwc_occurrences.csv')).text()

  // 2. Every asserted distribution with its area and citations.
  const shapeParams = (page) => [['per', PER], ['page', page], ['extend[]', 'asserted_distribution_shape']]
  const first = await request('/asserted_distributions', shapeParams(1))
  const pages = Number(first.headers.get('pagination-total-pages')) || 1
  const byPage = new Map([[1, await first.json()]])
  await forEachLimited(Array.from({ length: pages - 1 }, (_, i) => i + 2), PARALLEL, async (page) => {
    byPage.set(page, await (await request('/asserted_distributions', shapeParams(page))).json())
  })
  const seen = new Map()
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) for (const ad of byPage.get(page)) seen.set(String(ad.id), ad)
  const distributions = [...seen.values()]
  const expected = Number(first.headers.get('pagination-total'))
  if (distributions.length !== expected) throw new Error(`got ${distributions.length} of ${expected} distributions`)
  log(`${distributions.length} asserted distributions`)

  // 3. Status tags (Adventive, Endemic) and Reassessment data attributes.
  const keywordIds = (await getOnePage('/controlled_vocabulary_terms', [['type[]', 'Keyword']]))
    .filter((term) => STATUS_KEYWORDS.includes(normalize(term.name)))
    .map((term) => term.id)
  const statusTags = keywordIds.length ? await getOnePage('/tags', keywordIds.map((id) => ['keyword_id[]', id])) : []
  const reassessments = (await getOnePage('/data_attributes', [['attribute_subject_type', 'AssertedDistribution']]))
    .filter((attribute) => normalize(attribute.predicate_name || attribute.import_predicate) === 'reassessment')
  const reassessmentCitations = []
  // In batches of 100 ids, to stay under the server's URL length limit.
  for (let i = 0; i < reassessments.length; i += 100) {
    reassessmentCitations.push(...await getOnePage('/citations', [
      ['citation_object_type', 'DataAttribute'],
      ...reassessments.slice(i, i + 100).map((attribute) => ['citation_object_id[]', attribute.id]),
      ['extend[]', 'source']
    ]))
  }
  log(`${statusTags.length} adventive/endemic tags, ${reassessments.length} reassessments`)

  // 4. Biological associations behind distributions.
  const associationIds = [...new Set(distributions
    .filter((ad) => ad.asserted_distribution_object_type === 'BiologicalAssociation')
    .map((ad) => ad.asserted_distribution_object_id))]
  const associations = []
  for (let i = 0; i < associationIds.length; i += 100) {
    associations.push(...await getOnePage('/biological_associations/basic',
      associationIds.slice(i, i + 100).map((id) => ['biological_association_id[]', id])))
  }

  // 5. OTU lookups: association OTUs without DwC row, classification by parents.
  const rows = parseTsv(csv)
  const { associationOtus: otuIds, parentOtus } = otusToLookUp(rows, distributions, associations)
  const associationOtus = {}
  for (const otuId of otuIds) {
    const otu = await jsonOrError(`/otus/${otuId}`)
    if (otu.error) { associationOtus[otuId] = otu; continue }
    const taxonName = otu.taxon_name_id ? await jsonOrError(`/taxon_names/${otu.taxon_name_id}`) : null
    associationOtus[otuId] = taxonName?.error ? { error: taxonName.error } : { otu, taxonName }
    // Such an OTU has no DwC classification either: look up its parents too.
    if (SPECIES_RANKS.has(taxonName?.rank)) parentOtus.push(otuId)
  }
  // The names in the type status of undetermined type specimens, and their OTUs' parents.
  const getJson = async (path, params = {}) => {
    const pairs = Object.entries(params).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map((item) => [`${key}[]`, item]) : [[key, value]])
    return (await request(path, pairs)).json()
  }
  const typeNames = {}
  const typeParsed = new Map()
  for (const row of rows) {
    if (row.dwc_occurrence_object_type !== 'CollectionObject' || row.otu_id || !row.typeStatus) continue
    const parsed = typeStatusName(row.typeStatus)
    if (parsed) typeParsed.set(typeNameKey(parsed), parsed)
  }
  await forEachLimited([...typeParsed.keys()], PARALLEL, async (key) => {
    typeNames[key] = await resolveTypeName(typeParsed.get(key), getJson)
  })
  for (const resolved of Object.values(typeNames)) {
    if (resolved.otuId && !parentOtus.includes(resolved.otuId)) parentOtus.push(resolved.otuId)
  }
  log(`${typeParsed.size} type status names, ${Object.values(typeNames).filter((resolved) => !resolved.error).length} resolved`)

  const otuParents = {}
  await forEachLimited(parentOtus, PARALLEL, async (otuId) => {
    const otu = await jsonOrError(`/otus/${otuId}`, [['extend[]', 'parents']])
    otuParents[otuId] = otu.error ? otu : (otu.parents || {})
  })
  log(`${associations.length} associations, ${otuIds.length} association OTUs and ${parentOtus.length} OTU classifications looked up`)

  // 6. The areas of the specimens' collecting events.
  const eventParams = (page) => [['per', PER], ['page', page]]
  const firstEvents = await request('/collecting_events', eventParams(1))
  const eventPages = Number(firstEvents.headers.get('pagination-total-pages')) || 1
  const events = new Map((await firstEvents.json()).map((event) => [event.id, event]))
  await forEachLimited(Array.from({ length: eventPages - 1 }, (_, i) => i + 2), PARALLEL, async (page) => {
    for (const event of await (await request('/collecting_events', eventParams(page))).json()) events.set(event.id, event)
  })
  const expectedEvents = Number(firstEvents.headers.get('pagination-total'))
  if (events.size !== expectedEvents) throw new Error(`got ${events.size} of ${expectedEvents} collecting events`)
  const areaOfEvent = new Map([...events.values()].filter((event) => event.geographic_area_id).map((event) => [event.id, event.geographic_area_id]))
  const specimenAreas = {}
  const eventIds = [...areaOfEvent.keys()]
  for (let i = 0; i < eventIds.length; i += 50) {
    const batch = eventIds.slice(i, i + 50).map((id) => ['collecting_event_id[]', id])
    let total = null
    const seenInBatch = new Set()
    for (let page = 1, pages = 1; page <= pages; page++) {
      const response = await request('/collection_objects', [...batch, ['per', PER], ['page', page]])
      pages = Number(response.headers.get('pagination-total-pages')) || 1
      total = Number(response.headers.get('pagination-total'))
      for (const object of await response.json()) {
        seenInBatch.add(object.id)
        const area = areaOfEvent.get(object.collecting_event_id)
        if (!area) throw new Error(`collection object ${object.id} has collecting event ${object.collecting_event_id}, which was not asked for`)
        specimenAreas[object.id] = area
      }
    }
    if (Number.isFinite(total) && seenInBatch.size !== total) {
      throw new Error(`got ${seenInBatch.size} of ${total} collection objects of collecting events ${i + 1} to ${i + batch.length}`)
    }
  }
  log(`${events.size} collecting events, ${areaOfEvent.size} with an area, ${Object.keys(specimenAreas).length} specimens on them`)

  return { csv, distributions, statusTags, reassessments, reassessmentCitations, associations, associationOtus, otuParents, specimenAreas, typeNames }
}

/**
 * Write a download into a folder (created when missing), one file per part (FILES).
 * @param {string} dir
 * @param {TaxonWorksData} data
 */
export function saveData(dir, data) {
  mkdirSync(dir, { recursive: true })
  for (const [part, file] of Object.entries(FILES)) {
    writeFileSync(join(dir, file), part === 'csv' ? data.csv : JSON.stringify(data[part]))
  }
}

/**
 * Read a saved download (see FILES); every file must be there.
 * @param {string} dir
 * @returns {TaxonWorksData}
 * @throws {Error} naming the first missing file
 */
export function loadData(dir) {
  const data = {}
  for (const [part, file] of Object.entries(FILES)) {
    const path = join(dir, file)
    if (!existsSync(path)) {
      const older = Object.values(FILES).some((name) => existsSync(join(dir, name)))
      throw new Error(older
        ? `no ${path}: this folder was saved before ${file} was part of the download; save a new one (npm run checklists -- --save ${dir})`
        : `no ${path}: save a download first (npm run checklists -- --save ${dir})`)
    }
    const text = readFileSync(path, 'utf8')
    data[part] = part === 'csv' ? text : JSON.parse(text)
  }
  return data
}

async function forEachLimited(list, limit, fn) {
  let next = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < list.length) await fn(list[next++])
  }))
}
