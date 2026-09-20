/**
 * inatObservation.js
 *
 * Resolves specimens (CollectionObject / FieldOccurrence) that were imported
 * from iNaturalist to their iNaturalist observation, so a panel can link out
 * to the original observation.
 *
 * Why this exists: TaxonWorks records the import as a typed Identifier, and
 * the DwC payload gives you no reliable way to recognise it. Every record
 * gets an `occurrenceID`, including AssertedDistributions. For an imported
 * record that value happens to BE the iNaturalist observation uuid (FO 5022's
 * `occurrenceID` equals its InaturalistObservation identifier); for every
 * other record it mirrors the record's `TaxonworksDwcOccurrence` GUID
 * instead (FO 5024, FO 5025). The two are indistinguishable by inspection,
 * so `occurrenceID` cannot tell you which kind you are holding, and
 * linkifying it blindly would produce dead links for most records.
 * `georeferenceSources: "iNaturalist"` hints at the importer but yields no
 * id. The identifier is the only structured signal:
 *
 *   GET /identifiers?identifier_object_type=FieldOccurrence
 *                   &identifier_object_id[]=…        (repeatable)
 *   → [{ type: "Identifier::Global::Uuid::InaturalistObservation",
 *        identifier: "974a95e8-…" }]
 *
 * That one call is both the detection and the payload: a specimen with no
 * iNaturalist identifier is simply absent from the returned Map, so callers
 * never need a separate "is this from iNaturalist" test.
 *
 * The stored value is the observation UUID, not the numeric observation id.
 * That is enough: https://www.inaturalist.org/observations/<uuid> resolves
 * to the observation (confirmed in a browser, 2026-09-20). So nothing here
 * touches the iNaturalist API, and iNaturalist being unreachable cannot
 * affect a page that uses this. Resolving the numeric id would need
 * `GET api.inaturalist.org/v1/observations?uuid=a,b,c` (batched, returns a
 * canonical `uri` per observation) — deliberately not done, since no caller
 * displays the number.
 *
 * Note the `type[]` query parameter is ignored by `/identifiers` (it returns
 * every type regardless), so the filtering happens client-side.
 *
 * Depended on by:
 *   - ./DwcTable.vue — the "Source: iNaturalist observation by …" row
 *
 * Batched and keyed by specimenKey() (`Type:id`) so a list view can resolve
 * a whole page in one request, the same way PanelBiologicalAssociationsV2
 * already indexes specimens — it is the intended consumer of the linkified
 * collector name in its Citations column once that panel's rework lands.
 *
 * If you change this file, sanity-check DwcTable's Source row.
 */

import { specimenKey } from './specimenRef.js'

// `@/utils/request` is imported dynamically inside fetchInatObservations so
// that unit tests importing only the pure helpers don't have to resolve the
// `@/` build alias (node --test can't).

/** The identifier type TaxonWorks writes when importing an iNaturalist observation. */
export const INAT_OBSERVATION_IDENTIFIER =
  'Identifier::Global::Uuid::InaturalistObservation'

// identifier_object_id[] values per request (URL length guard) and rows per page.
const ID_CHUNK = 80
const PER = 500
const MAX_PAGES = 20

/**
 * The public observation URL for an observation UUID.
 * @param {string} uuid
 * @returns {string|null}
 */
export function observationUrl(uuid) {
  const clean = String(uuid || '').trim()
  return clean ? `https://www.inaturalist.org/observations/${clean}` : null
}

/**
 * Index raw `/identifiers` rows by specimenKey(), keeping only iNaturalist
 * observation identifiers. Pure — no network. Exported for unit testing.
 *
 * Keyed on `${type}:${id}` because CollectionObject and FieldOccurrence ids
 * come from independent sequences and collide as bare numbers.
 *
 * @param {Array<object>} rows
 * @returns {Map<string, {uuid: string, url: string}>}
 */
export function indexInatIdentifiers(rows) {
  const bySpecimen = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.type !== INAT_OBSERVATION_IDENTIFIER) continue

    const id = Number(row.identifier_object_id)
    const type = row.identifier_object_type
    const uuid = String(row.identifier || row.cached || '').trim()
    if (!id || !type || !uuid) continue

    const key = specimenKey({ type, id })
    // First row wins — a record should only ever carry one of these.
    if (!bySpecimen.has(key)) bySpecimen.set(key, { uuid, url: observationUrl(uuid) })
  }
  return bySpecimen
}

/**
 * Render a DwC `recordedBy` for display. TaxonWorks joins multiple collectors
 * with a pipe (e.g. "Jiří Krátký | P. Kresl"), which reads as a stray glyph
 * mid-sentence.
 * @param {string} recordedBy
 * @returns {string}
 */
export function formatRecordedBy(recordedBy) {
  return String(recordedBy || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * The link text for an iNaturalist-imported specimen, parallel to the short
 * citation text in the row above it ("Skuhrovec, 2012").
 *
 * Reads `recordedBy` as the observer. That holds for the FieldOccurrence
 * imports this serves today (the importer writes the iNaturalist observer
 * there), but recordedBy is strictly the collector — if a CollectionObject
 * ever carries an InaturalistObservation identifier, its collector need not
 * be the person who uploaded the observation.
 *
 * @param {string} recordedBy  DwC recordedBy, raw
 * @returns {string}
 */
export function inatSourceLabel(recordedBy) {
  const who = formatRecordedBy(recordedBy)
  return who ? `iNaturalist observation by ${who}` : 'iNaturalist observation'
}

/**
 * Fetch iNaturalist observation identifiers for the given specimen refs.
 * Never throws — a failed request just leaves those specimens unresolved,
 * which renders as "not imported from iNaturalist" (the row is omitted).
 *
 * @param {Array<{type: string, id: number|string}>} refs
 * @returns {Promise<Map<string, {uuid: string, url: string}>>} specimenKey -> observation
 */
export async function fetchInatObservations(refs) {
  // Group by object type: /identifiers takes one identifier_object_type per
  // request, so a mixed list costs one request per distinct type (max two).
  const idsByType = new Map()
  for (const ref of Array.isArray(refs) ? refs : []) {
    const id = Number(ref?.id)
    const type = ref?.type
    if (!id || !type) continue
    if (!idsByType.has(type)) idsByType.set(type, new Set())
    idsByType.get(type).add(id)
  }
  if (!idsByType.size) return new Map()

  const { makeAPIRequest } = await import('@/utils/request')
  const all = []

  for (const [type, idSet] of idsByType) {
    const ids = [...idSet]
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      for (let page = 1; page <= MAX_PAGES; page++) {
        const qs = new URLSearchParams()
        qs.set('identifier_object_type', type)
        qs.set('per', String(PER))
        qs.set('page', String(page))
        chunk.forEach((id) => qs.append('identifier_object_id[]', id))

        let rows
        try {
          const { data } = await makeAPIRequest.get(`/identifiers?${qs.toString()}`)
          rows = Array.isArray(data) ? data : []
        } catch {
          break // this chunk's specimens simply get no iNaturalist link
        }
        all.push(...rows)
        if (rows.length < PER) break
      }
    }
  }

  return indexInatIdentifiers(all)
}
