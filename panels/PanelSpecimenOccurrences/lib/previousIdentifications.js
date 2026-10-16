import { makeAPIRequest } from '@/utils'
import { fetchAllPages } from '../../_shared/fetchAllPages.js'
import { mapPool } from '../../_shared/concurrencyPool.js'

// /otus/:id/inventory/dwc.json also returns specimens that are listed only
// because an EARLIER determination pointed at this taxon: a specimen once
// identified as Exechesops leucopis and since redetermined as E. foliatus
// still turns up on the leucopis page. This finds those records so the list
// can hide them by default.
//
// A record is hidden only when it is proven to be out of scope, never on a
// guess:
// - it carries no type status (type material is always shown, its type
//   status is the identification that matters here),
// - it has previousIdentifications at all (cheap gate: when no record has
//   one, no request is made; a record without one is listed through its
//   current determination, so it is in scope by definition),
// - its current OTU is neither this taxon nor a descendant, and the valid
//   name of its current OTU's taxon name is not either (a specimen
//   determined under a synonym is a current record of the valid taxon; the
//   OTU filter's descendants=true does not follow synonyms). A valid name
//   with no OTU of its own cannot be checked, so the record stays visible.
//
// `taxonNameId` is the page OTU's taxon name when the caller already has it
// (saves one request). Returns a Set of record ids (dwc row `id`). Any failed
// request returns an empty Set, which shows every record.
export async function findPreviousIdentificationOnly(otuId, records, taxonNameId = null) {
  const candidates = records.filter(
    (r) => !r.typeStatus && r.previousIdentifications && r.otu_id && r.otu_id !== otuId
  )
  if (!candidates.length) return new Set()

  try {
    const candidateOtuIds = [...new Set(candidates.map((r) => r.otu_id))]
    const [pageTaxonNameId, candidateOtus] = await Promise.all([
      taxonNameId ?? makeAPIRequest.get(`/otus/${otuId}`).then(({ data }) => data?.taxon_name_id),
      fetchInChunks('/otus', 'otu_id', candidateOtuIds)
    ])
    if (!pageTaxonNameId) return new Set()

    const taxonNameByOtu = new Map(candidateOtus.map((o) => [o.id, o.taxon_name_id]))
    const taxonNames = await fetchInChunks(
      '/taxon_names',
      'taxon_name_id',
      [...new Set([...taxonNameByOtu.values()].filter(Boolean))]
    )
    const validByTaxonName = new Map(
      taxonNames.map((t) => [t.id, t.cached_valid_taxon_name_id || t.id])
    )

    // OTUs of the valid names of synonym determinations, to test those
    // against the subtree together with the candidates themselves.
    const synonymValidIds = [
      ...new Set(
        [...validByTaxonName.entries()].filter(([id, valid]) => id !== valid).map(([, valid]) => valid)
      )
    ]
    const validOtus = await fetchInChunks('/otus', 'taxon_name_id', synonymValidIds)
    const otusByValidName = new Map()
    validOtus.forEach((o) => {
      if (!otusByValidName.has(o.taxon_name_id)) otusByValidName.set(o.taxon_name_id, [])
      otusByValidName.get(o.taxon_name_id).push(o.id)
    })

    // Which of these OTUs sit at or below this taxon (self included).
    const inScopeOtus = await fetchInChunks(
      '/otus',
      'otu_id',
      [...new Set([...candidateOtuIds, ...validOtus.map((o) => o.id)])],
      { taxon_name_id: [pageTaxonNameId], descendants: true }
    )
    const inScope = new Set(inScopeOtus.map((o) => o.id))

    const isOutOfScope = (candidateOtuId) => {
      if (inScope.has(candidateOtuId)) return false
      const candidateTaxonNameId = taxonNameByOtu.get(candidateOtuId)
      // an OTU without a taxon name, or one the lookup missed: unknown
      if (!candidateTaxonNameId || !validByTaxonName.has(candidateTaxonNameId)) return false
      const validId = validByTaxonName.get(candidateTaxonNameId)
      if (validId === candidateTaxonNameId) return true
      if (validId === pageTaxonNameId) return false
      const validNameOtus = otusByValidName.get(validId)
      if (!validNameOtus?.length) return false
      return !validNameOtus.some((id) => inScope.has(id))
    }

    const outOfScopeOtus = new Set(candidateOtuIds.filter(isOutOfScope))
    return new Set(candidates.filter((r) => outOfScopeOtus.has(r.otu_id)).map((r) => r.id))
  } catch {
    return new Set()
  }
}

// Ids per request: keeps the query string far below URL length limits on a
// large genus. Each chunk follows pagination (fetchAllPages), so a result
// set is never silently cut off at `per`.
const CHUNK_SIZE = 100

async function fetchInChunks(url, idParam, ids, params = {}) {
  if (!ids.length) return []
  const chunks = []
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE))
  const results = []
  await mapPool(chunks, 4, async (chunk) => {
    results.push(...(await fetchAllPages(url, { ...params, [idParam]: chunk })))
  })
  return results
}
