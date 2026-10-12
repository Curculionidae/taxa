// Several GBIF panels ask for the same taxon's synonyms on one page load —
// memoise the promise per taxon-name id.
const cache = new Map()

// Loaded lazily so this file stays importable under `node --test`, which can't
// resolve the `@/` alias (the tests inject their own `request`).
const apiGet = (url, config) =>
  import('@/utils/request').then((m) => m.makeAPIRequest.get(url, config))

// TaxonWorks' own answer to "which names are synonyms of this one":
// `/taxon_names?taxon_name_id[]=X&synonymify=true` returns X plus every name
// whose valid name is X, in one request.
//
// This replaces a hand-rolled walk over `/taxon_name_relationships` that kept
// getting the question wrong, because a relationship alone doesn't decide
// validity:
// - Misapplication is an Invalidating relationship but not synonymy (confirmed
//   live 2026-09-12: "Rhinoncus pericarpius" misapplied to "Rhinoncus
//   leucostigma" leaked pericarpius's own GBIF syntypes into the leucostigma
//   gallery).
// - A Synonym relationship can be overridden by an `Iczn::Available::Valid`
//   status, a name synonymised in one work and reinstated since (confirmed live
//   2026-10-12: "Himatium conicum" → "Himatium errans" leaked the conicum
//   holotype into the errans gallery).
// - A name with an old Synonym relationship to X whose valid name is now a
//   third taxon is not a synonym of X either.
// synonymify gets all three right. It also returns misspellings of X, which the
// walk left out; those are the same taxon, so they belong in the scope.
//
// Returns the full rows (`cached`, `cached_author_year`,
// `cached_original_combination`, …) without X itself. Rejects on failure, and a
// failure is never cached: a memoised empty list would silently strip every
// synonym from the GBIF panels until a full reload.
export function fetchTwSynonymRows(taxonId, { request = apiGet } = {}) {
  if (!taxonId) return Promise.resolve([])
  const key = String(taxonId)
  if (!cache.has(key)) {
    const pending = fetchTwSynonymRowsUncached(Number(taxonId), request)
    cache.set(key, pending)
    pending.catch(() => cache.delete(key))
  }
  return cache.get(key)
}

async function fetchTwSynonymRowsUncached(id, request) {
  const { data } = await request('/taxon_names', {
    params: { 'taxon_name_id[]': id, synonymify: true, per: 500 }
  })
  // Belt and braces on the server's answer: never X itself, and never a row
  // that says its valid name is something other than X.
  return (data || []).filter(
    (n) => n.id !== id && (n.cached_valid_taxon_name_id ?? id) === id
  )
}

// The same set as plain name strings. Returns [] on any failure.
export async function fetchTwSynonymNames(taxonId, opts) {
  try {
    return synonymNameStrings(await fetchTwSynonymRows(taxonId, opts))
  } catch {
    return []
  }
}

export function synonymNameStrings(rows) {
  return (rows || []).map((n) => n.cached || n.name).filter(Boolean)
}
