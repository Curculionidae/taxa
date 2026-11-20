// Live lookups for the curator page: one record or area from TaxonWorks, in
// the form the placement engine takes, and whether the cache lists it.
//
// Purpose: a curator types 'AD 556796' and sees where that record lands now.
// lookupLive fetches it from TaxonWorks and returns what placeRecord needs
// (engine.js): the RecordInput, and for an asserted distribution or an area
// the Area (areas.js, toArea), built from the same JSON the build downloads,
// so the engine decides as the build did. cacheStatus says whether the cache
// (public/checklists/) lists the record and, if not, why.
//
// Requests (through `request`, makeAPIRequest by default: an axios instance
// with the TaxonWorks base URL and project token)
//   AD       GET /asserted_distributions/:id, extend[]=asserted_distribution_shape
//            (a distribution without area is returned without one; placeLive
//            then gives the build's 'distribution has no area')
//   CO       GET /collection_objects/:id/dwc
//   FO       GET /field_occurrences/:id/dwc
//   GA, GZ   GET /asserted_distributions, geo_shape_id[]=<id>, geo_shape_type[]=
//            GeographicArea|Gazetteer, per=1, extend[]=asserted_distribution_shape:
//            TaxonWorks has no area endpoint, so an area is read from any
//            distribution on it; an area no distribution uses cannot be looked up.
// Output: { subject, area?, record, ... } or { error } (see lookupLive).
// For the curator page's lists: fromDistribution and fromDwcRow turn fetched
// records into the same form, placeLive places any of them as the build does,
// fetchOtuDistributions, fetchOtuSpecimens and fetchDistributionsByIds fetch
// in bulk (requests in their JSDoc).
// The label of a specimen is its DwC scientificName, as in the build. The
// label of a distribution is the name of its OTU (or association) from its
// object_tag; the build takes the DwC scientificName of the same OTU, which
// is normally the same text.
import { toArea } from './areas.js'
import { placeRecord } from './engine.js'
import { parseTsv } from '../data/tsv.js'

const SUPERFAMILY = 'Curculionoidea'
const RANKS = new Set(['species', 'subspecies'])
const TYPE_OF_KIND = { AD: 'AssertedDistribution', CO: 'CollectionObject', FO: 'FieldOccurrence' }
const KIND_OF_TYPE = { AssertedDistribution: 'AD', CollectionObject: 'CO', FieldOccurrence: 'FO' }

/**
 * @typedef {{ get: (url: string, config?: { params?: Object }) => Promise<{ data: any }> }} Request
 *   an axios-like client; rejects with error.response.status on HTTP errors
 *
 * @typedef {Object} LiveResult
 * @property {{ kind: string, id: number, label: string, area?: import('./areas.js').Area }} subject
 *   what formatPlacement prints first
 * @property {import('./areas.js').Area} [area]  the area of a distribution, or the area looked up
 * @property {import('./engine.js').RecordInput} record  what placeRecord takes
 * @property {Object} [dwc]       the DwC record of a CO or FO
 * @property {boolean} [absent]   the distribution is marked absent
 * @property {number} [otuId]     the OTU of a distribution on an OTU, or of a DwC record
 */

// makeAPIRequest, loaded only when no request is given (keeps this module
// loadable in Node tests, where the framework's '@/' alias does not exist).
const defaultRequest = {
  async get(url, config) {
    const { makeAPIRequest } = await import('@/utils/request')
    return makeAPIRequest.get(url, config)
  }
}

/**
 * Fetch one record or area from TaxonWorks.
 * @param {{ kind: 'GA'|'GZ'|'AD'|'CO'|'FO', id: number }} lookup  from parseLookup
 * @param {Request} [request]  makeAPIRequest by default
 * @param {{ areas?: Array<{ key: string, name: string, parentId: number|null, placement?: any }> }} [options]
 *   areas: the rows of areas.json, to name a parent area that no distribution uses
 * @returns {Promise<LiveResult | { error: string, stub?: { name: string, children: { key: string, name: string }[] } }>}
 *   errors: 'TaxonWorks has no AD 999999' (404), 'used by no record' (an area no
 *   distribution uses, with `stub` when areas.json knows it as a parent),
 *   'could not reach TaxonWorks: ...', 'TaxonWorks answered 500 for AD 1'
 * @example
 *   await lookupLive({ kind: 'AD', id: 556796 })
 *   // { subject: { kind: 'AD', id: 556796, label: 'Phaedropus candidus (Fabricius, 1775)', area }, area: { key: 'GA 8837', ... }, ... }
 */
export async function lookupLive({ kind, id }, request = defaultRequest, { areas = [] } = {}) {
  try {
    if (kind === 'AD') {
      const { data: ad } = await request.get(`/asserted_distributions/${id}`, { params: { extend: ['asserted_distribution_shape'] } })
      return fromDistribution(ad)
    }
    if (kind === 'CO' || kind === 'FO') {
      const path = kind === 'CO' ? `/collection_objects/${id}/dwc` : `/field_occurrences/${id}/dwc`
      const { data: dwc } = await request.get(path)
      return {
        subject: { kind, id, label: dwc.scientificName || '' },
        record: recordFromDwc(TYPE_OF_KIND[kind], id, dwc),
        dwc,
        ...(dwc.otu_id ? { otuId: dwc.otu_id } : {})
      }
    }
    if (kind === 'GA' || kind === 'GZ') {
      const shapeType = kind === 'GZ' ? 'Gazetteer' : 'GeographicArea'
      const { data } = await request.get('/asserted_distributions', {
        params: { geo_shape_id: [id], geo_shape_type: [shapeType], per: 1, extend: ['asserted_distribution_shape'] }
      })
      const ad = Array.isArray(data) ? data[0] : null
      if (!ad?.asserted_distribution_shape) return usedByNoRecord(kind, id, areas)
      const area = toArea(shapeType, ad.asserted_distribution_shape)
      return { subject: { kind, id, label: area.name, area }, area, record: { type: 'AssertedDistribution', id: 0 } }
    }
    return { error: `unknown kind ${kind}` }
  } catch (error) {
    const status = error?.response?.status
    if (status === 404) return { error: `TaxonWorks has no ${kind} ${id}` }
    if (status) return { error: `TaxonWorks answered ${status} for ${kind} ${id}` }
    return { error: `could not reach TaxonWorks: ${error?.message || error}` }
  }
}

/**
 * A distribution as TaxonWorks returns it (with extend[]=asserted_distribution_shape),
 * in the form lookupLive returns. Without an area the subject has none and
 * placeLive gives the build's 'distribution has no area'.
 * @param {Object} ad  one asserted distribution
 * @returns {LiveResult}
 */
export function fromDistribution(ad) {
  const id = Number(ad.id)
  const label = plainLabel(ad.asserted_distribution_object?.object_tag) || `AD ${id}`
  const area = ad.asserted_distribution_shape ? toArea(ad.asserted_distribution_shape_type, ad.asserted_distribution_shape) : null
  return {
    subject: { kind: 'AD', id, label, ...(area ? { area } : {}) },
    ...(area ? { area } : {}),
    record: { type: 'AssertedDistribution', id },
    absent: Boolean(ad.is_absent),
    ...(ad.asserted_distribution_object_type === 'Otu' ? { otuId: ad.asserted_distribution_object_id } : {})
  }
}

/** The build's placement of a distribution without area (buildContext.mjs, placementOf). */
const NO_AREA = Object.freeze({ checklist: null, part: null, state: null, shape: null, reason: 'distribution has no area', steps: Object.freeze([]) })

/**
 * Place what lookupLive (or fromDistribution, fromDwcRow) returned, as the
 * build does: placeRecord, except for a distribution without area, which is
 * 'not placeable: distribution has no area' with no steps.
 * @param {LiveResult} live
 * @param {import('./engine.js').Context} ctx
 * @returns {Promise<import('./engine.js').Placement>}
 */
export async function placeLive(live, ctx) {
  if (live.record.type === 'AssertedDistribution' && !live.area) return { ...NO_AREA, steps: [] }
  return placeRecord(live.record, ctx, live.area)
}

/**
 * A specimen or field occurrence from its DwC row, in the form lookupLive returns.
 * @param {Object} dwc  a DwC row with dwc_occurrence_object_type and _id
 * @returns {LiveResult}
 */
export function fromDwcRow(dwc) {
  const type = dwc.dwc_occurrence_object_type
  const kind = KIND_OF_TYPE[type]
  const id = Number(dwc.dwc_occurrence_object_id)
  return { subject: { kind, id, label: dwc.scientificName || '' }, record: recordFromDwc(type, id, dwc), dwc }
}

/**
 * Why the build leaves a DwC record out of every checklist (buildContext.mjs,
 * screenRow): 'rank genus', 'recorded as absent', 'not in Curculionoidea (X)';
 * null when it counts.
 * @param {Object} dwc
 * @returns {string|null}
 */
export function leftOutReason(dwc) {
  if (!RANKS.has(dwc.taxonRank)) return `rank ${dwc.taxonRank || 'none'}`
  if (String(dwc.occurrenceStatus ?? '').trim().toLowerCase() === 'absent') return 'recorded as absent'
  if (dwc.superfamily && dwc.superfamily !== SUPERFAMILY) return `not in ${SUPERFAMILY} (${dwc.superfamily})`
  return null
}

/**
 * Why the build leaves out the asserted distributions of an OTU, from the OTU
 * itself (the build reads taxonRank and superfamily from the DwC row of each
 * distribution, which TaxonWorks fills from the OTU's taxon name): 'rank
 * family', 'not in Curculionoidea', or null when they count.
 * @param {{ rank: string|null, parentNames: string[] }} otu  the rank of its taxon name
 *   (GET /taxon_names/:id `rank`) and the names of its parents
 *   (GET /otus/:id?extend[]=parents, the keys of `parents`)
 * @returns {string|null}
 */
export function otuLeftOut({ rank, parentNames }) {
  if (!RANKS.has(rank)) return `rank ${rank || 'none'}`
  if (!parentNames.includes(SUPERFAMILY)) return `not in ${SUPERFAMILY}`
  return null
}

/**
 * Why the build leaves a record of an OTU out of every checklist: the
 * record's own DwC reason (leftOutReason), else 'absent' for an absent
 * distribution, else the OTU's reason (otuLeftOut). The OTU's reason also
 * covers a specimen whose DwC row has no superfamily: the build then takes the
 * classification of the OTU's parents and leaves it out when that is not
 * Curculionoidea (buildContext.mjs, screenRow).
 * @param {{ dwc?: Object|null, absent?: boolean }} live  what lookupLive, fromDistribution or fromDwcRow returned
 * @param {string|null} otuReason  otuLeftOut of the record's OTU, null when it counts or is unknown
 * @returns {string|null}
 */
export function recordLeftOut({ dwc = null, absent = false }, otuReason) {
  if (dwc) return leftOutReason(dwc) ?? otuReason ?? null
  if (absent) return 'absent'
  return otuReason ?? null
}

/**
 * Every asserted distribution of one OTU (its own only: no synonyms, no
 * subordinate taxa; distributions of an association it is part of included,
 * as TaxonWorks returns them for otu_id), page by page.
 * GET /asserted_distributions, otu_id[]=<id>, extend[]=asserted_distribution_shape,
 * per, page; stops when a page is short or pagination-total-pages is reached.
 * @param {number} otuId
 * @param {Request} [request]
 * @param {{ per?: number, onProgress?: (loaded: number, total: number|null) => void }} [options]
 * @returns {Promise<Object[]>}  the distributions as TaxonWorks returns them
 */
export async function fetchOtuDistributions(otuId, request = defaultRequest, { per = 500, onProgress = () => {} } = {}) {
  const all = []
  for (let page = 1; ; page++) {
    const response = await request.get('/asserted_distributions', {
      params: { otu_id: [otuId], extend: ['asserted_distribution_shape'], per, page }
    })
    const data = Array.isArray(response.data) ? response.data : []
    all.push(...data)
    const total = Number(response.headers?.['pagination-total']) || null
    const pages = Number(response.headers?.['pagination-total-pages']) || null
    onProgress(all.length, total)
    if (data.length < per || (pages && page >= pages)) return all
  }
}

/**
 * Asserted distributions by id, in batches of 50 (one request each):
 * GET /asserted_distributions, asserted_distribution_id[]=..., per=50,
 * extend[]=asserted_distribution_shape.
 * @param {number[]} ids
 * @param {Request} [request]
 * @returns {Promise<Map<number, Object>>}  by id; ids TaxonWorks no longer has are missing
 */
export async function fetchDistributionsByIds(ids, request = defaultRequest) {
  const byId = new Map()
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50)
    const { data } = await request.get('/asserted_distributions', {
      params: { asserted_distribution_id: batch, per: batch.length, extend: ['asserted_distribution_shape'] }
    })
    for (const ad of data ?? []) byId.set(Number(ad.id), ad)
  }
  return byId
}

/**
 * The specimens and field occurrences of one OTU, from the DwC index, as the
 * build reads them. The DwC index has no OTU filter that works
 * (/dwc_occurrences?otu_id[] returns nothing), so the rows are asked for by the
 * OTU's taxon name, which includes its subordinate taxa, and only the rows
 * whose otu_id is this OTU are kept. Per kind:
 *   GET /dwc_occurrences, taxon_name_id[]=<id>, dwc_occurrence_object_type=
 *       CollectionObject|FieldOccurrence, per=500
 *   and when that has more than one page, GET /dwc_occurrences.csv with the
 *   same filter (tab separated, every row in one answer; the paged list can
 *   repeat and miss rows, as it has no fixed order).
 * @param {{ id: number, taxonNameId: number|null }} otu  an OTU without taxon name has no DwC rows
 * @param {Request} [request]
 * @returns {Promise<Object[]>}  DwC rows (CSV rows carry strings, '' for empty)
 */
export async function fetchOtuSpecimens({ id, taxonNameId }, request = defaultRequest) {
  if (!taxonNameId) return []
  const rows = []
  for (const type of ['CollectionObject', 'FieldOccurrence']) {
    const params = { taxon_name_id: [taxonNameId], dwc_occurrence_object_type: type }
    const response = await request.get('/dwc_occurrences', { params: { ...params, per: 500 } })
    const pages = Number(response.headers?.['pagination-total-pages']) || 1
    let found = Array.isArray(response.data) ? response.data : []
    if (pages > 1) {
      const csv = await request.get('/dwc_occurrences.csv', { params, responseType: 'text' })
      found = parseTsv(String(csv.data ?? ''))
    }
    rows.push(...found.filter((row) => Number(row.otu_id) === Number(id) && row.dwc_occurrence_object_type === type))
  }
  return rows
}

// 'used by no record', with the children when areas.json lists the area as a
// parent known only by name (French Guiana, the parent of Cayenne).
function usedByNoRecord(kind, id, areas) {
  const key = `${kind} ${id}`
  const own = areas.find((row) => row.key === key)
  if (kind !== 'GA' || !own) return { error: 'used by no record' }
  const children = areas.filter((row) => row.parentId === id).map((row) => ({ key: row.key, name: row.name }))
  return { error: 'used by no record', stub: { name: own.name, children } }
}

/**
 * The RecordInput of a specimen or field occurrence, exactly as the build
 * makes it from a DwC row (buildContext.mjs, recordInput).
 * @param {'CollectionObject'|'FieldOccurrence'} type
 * @param {number} id
 * @param {Object} dwc  DwC fields (the JSON of /collection_objects/:id/dwc or a CSV row)
 * @returns {import('./engine.js').RecordInput}
 */
export function recordFromDwc(type, id, dwc) {
  return {
    type,
    id,
    country: dwc.country,
    stateProvince: dwc.stateProvince,
    county: dwc.county,
    locality: dwc.verbatimLocality || dwc.locality,
    lat: dwc.decimalLatitude,
    lng: dwc.decimalLongitude
  }
}

/**
 * Plain text of a TaxonWorks label: tags removed, the common entities decoded.
 * @param {string|null|undefined} html
 * @returns {string}
 */
export function plainLabel(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code) => {
      if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
      return entities[code.toLowerCase()] ?? match
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Does the cache list the record? Looked up in the checklist file of the live
 * result, else in unplaced.json; when it is in neither, the build's filters
 * (buildContext.mjs, screenRow) are checked on the DwC fields at hand.
 * @param {{ kind: string, id: number, dwc?: Object, absent?: boolean }} record
 * @param {Object} cache
 * @param {string|null} cache.checklistName  the checklist of the live result
 * @param {Object[]|null} cache.records  its records (data/compact.js expandChecklist), null when not loaded
 * @param {Object<string, Array<[string, number]>>} cache.unplaced  unplaced.json
 * @returns {{ listed: boolean, text: string }}  'listed in Ukraine (state Kyiv)',
 *   'not listed: locality text only', 'not listed: rank genus', 'not listed in the cache'
 */
export function cacheStatus({ kind, id, dwc = null, absent = false }, { checklistName, records, unplaced }) {
  const type = TYPE_OF_KIND[kind]
  const found = (records ?? []).find((row) => row.dwc_occurrence_object_type === type && String(row.dwc_occurrence_object_id) === String(id))
  if (found) {
    const extra = [found.part && `part ${found.part}`, found.state && `state ${found.state}`].filter(Boolean)
    return { listed: true, text: `listed in ${checklistName ?? found.country}${extra.length ? ` (${extra.join(', ')})` : ''}` }
  }
  for (const [reason, ids] of Object.entries(unplaced ?? {})) {
    if (ids.some(([k, i]) => k === kind && Number(i) === Number(id))) return { listed: false, text: `not listed: ${reason}` }
  }
  const leftOut = dwc && leftOutReason(dwc)
  if (leftOut) return { listed: false, text: `not listed: ${leftOut}` }
  if (absent) return { listed: false, text: 'not listed: distribution is absent' }
  return { listed: false, text: 'not listed in the cache' }
}
