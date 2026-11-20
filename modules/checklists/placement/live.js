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
//   CO       GET /collection_objects/:id/dwc
//   FO       GET /field_occurrences/:id/dwc
//   GA, GZ   GET /asserted_distributions, geo_shape_id[]=<id>, geo_shape_type[]=
//            GeographicArea|Gazetteer, per=1, extend[]=asserted_distribution_shape:
//            TaxonWorks has no area endpoint, so an area is read from any
//            distribution on it; an area no distribution uses cannot be looked up.
// Output: { subject, area?, record, ... } or { error } (see lookupLive).
// The label of a specimen is its DwC scientificName, as in the build. The
// label of a distribution is the name of its OTU (or association) from its
// object_tag; the build takes the DwC scientificName of the same OTU, which
// is normally the same text.
import { toArea } from './areas.js'

const SUPERFAMILY = 'Curculionoidea'
const RANKS = new Set(['species', 'subspecies'])
const TYPE_OF_KIND = { AD: 'AssertedDistribution', CO: 'CollectionObject', FO: 'FieldOccurrence' }

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
      const label = plainLabel(ad.asserted_distribution_object?.object_tag) || `AD ${id}`
      if (!ad.asserted_distribution_shape) return { error: `AD ${id} has no area` }
      const area = toArea(ad.asserted_distribution_shape_type, ad.asserted_distribution_shape)
      return {
        subject: { kind, id, label, area },
        area,
        record: { type: 'AssertedDistribution', id },
        absent: Boolean(ad.is_absent),
        ...(ad.asserted_distribution_object_type === 'Otu' ? { otuId: ad.asserted_distribution_object_id } : {})
      }
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
  if (dwc) {
    if (!RANKS.has(dwc.taxonRank)) return { listed: false, text: `not listed: rank ${dwc.taxonRank || 'none'}` }
    if (String(dwc.occurrenceStatus ?? '').trim().toLowerCase() === 'absent') return { listed: false, text: 'not listed: recorded as absent' }
    if (dwc.superfamily && dwc.superfamily !== SUPERFAMILY) return { listed: false, text: `not listed: not in ${SUPERFAMILY} (${dwc.superfamily})` }
  }
  if (absent) return { listed: false, text: 'not listed: distribution is absent' }
  return { listed: false, text: 'not listed in the cache' }
}
