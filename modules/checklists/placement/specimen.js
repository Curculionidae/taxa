// A specimen or field occurrence as the engine sees it, made once for the
// cache build and the curator page.
//
// Purpose: the build (scripts/buildContext.mjs, build.mjs) and the curator
// page (placement/live.js) must place a specimen exactly alike, so everything
// between "the DwC row and its collecting event area are known" and
// "placeRecord" lives here and nowhere else. Only how the data is fetched
// differs (the build in bulk, scripts/download.mjs; the page per record,
// live.js).
//
// Input:  a DwC row (CSV strings or the JSON of /collection_objects/:id/dwc),
//         already completed by typeStatus.js typeRow for an undetermined type,
//         and the collecting event area id with a lookup for its Area.
// Output: recordFromDwc: the RecordInput; eventAreaOf: the Area or { key };
//         specimenLabel: the label of explanations; typeReasonPlacement: the
//         Placement of a type whose type status cannot be resolved.
// Purity: no network, no file system.

/**
 * The RecordInput of a specimen or field occurrence from its DwC fields.
 * @param {'CollectionObject'|'FieldOccurrence'} type
 * @param {number} id
 * @param {Object} dwc  DwC fields (the JSON of /collection_objects/:id/dwc or a CSV row)
 * @param {import('./areas.js').Area|{ key: string }|null} [eventArea]  the collecting
 *   event's area (eventAreaOf); the engine uses it only without coordinates
 * @returns {import('./engine.js').RecordInput}
 */
export function recordFromDwc(type, id, dwc, eventArea = null) {
  return {
    type,
    id,
    country: dwc.country,
    stateProvince: dwc.stateProvince,
    county: dwc.county,
    locality: dwc.verbatimLocality || dwc.locality,
    lat: dwc.decimalLatitude,
    lng: dwc.decimalLongitude,
    ...(dwc.footprintWKT ? { footprint: dwc.footprintWKT } : {}),
    ...(eventArea ? { eventArea } : {})
  }
}

/**
 * A collecting event's area for RecordInput.eventArea: the Area a distribution
 * on it gives (its levels and parent known), else only its key.
 * @param {number|string|null|undefined} areaId  the collecting event's geographic_area_id
 * @param {import('./areas.js').Area|null|undefined} area  the Area of that id, when known
 * @returns {import('./areas.js').Area|{ key: string }|null}
 */
export function eventAreaOf(areaId, area) {
  if (!areaId) return null
  return area ?? { key: `GA ${Number(areaId)}` }
}

/**
 * The label of a specimen in explanations: its name, and for an undetermined
 * type its type status ("Phaeopholus vietnamensis Legalov, 2026 (paratype, no determination)").
 * @param {Object} dwc  a DwC row, completed by typeRow
 * @returns {string}
 */
export function specimenLabel(dwc) {
  const name = dwc.scientificName || ''
  return dwc.typeLabel ? `${name} (${dwc.typeLabel})` : name
}

/**
 * The Placement of a type specimen whose type status cannot be resolved
 * (typeRow gave `{ unplaced }`): not placeable with that reason, one step
 * quoting the type status.
 * @param {Object} dwc  the DwC row (typeStatus)
 * @param {string} reason  from typeRow
 * @returns {import('./engine.js').Placement}
 */
export function typeReasonPlacement(dwc, reason) {
  const quoted = `the type status "${String(dwc.typeStatus ?? '').trim()}"`
  const text = reason === 'type status names no single taxon' ? `${quoted} names no single taxon` : `${quoted}: ${reason}`
  return { checklist: null, part: null, state: null, shape: null, reason, steps: [{ text, source: 'TaxonWorks', stage: 'checklist' }] }
}
