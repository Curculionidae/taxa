import { makeAPIRequest } from '@/utils/request'

// Several GBIF panels ask for the same taxon's synonyms on one page load —
// memoise the promise per taxon-name id.
const cache = new Map()

// TaxonWorks synonym name strings for a taxon-name id: Invalidating::Synonym
// relationships whose *object* is this name → their subject names. Same
// two-step PanelAssertedDistributions uses. Returns [] on any failure.
//
// Deliberately narrower than "any Invalidating type": TaxonWorks' Invalidating
// category also covers Misapplication ("this name was historically misapplied
// to specimens of that species" — NOT synonymy) and Homonym/Usage (misspelling,
// incorrect original spelling — a naming accident, not a shared concept).
// Widening this back to a bare `.includes('Invalidating')` check pulls an
// unrelated species' own type material into the GBIF/iNat scope for this taxon
// (confirmed live 2026-09-12: a Misapplication relationship linking "Rhinoncus
// pericarpius" to "Rhinoncus leucostigma" leaked pericarpius's own GBIF
// syntypes into the leucostigma gallery).
export function fetchTwSynonymNames(taxonId) {
  if (!taxonId) return Promise.resolve([])
  const key = String(taxonId)
  if (!cache.has(key)) cache.set(key, fetchTwSynonymNamesUncached(taxonId))
  return cache.get(key)
}

async function fetchTwSynonymNamesUncached(taxonId) {
  try {
    const { data: rels } = await makeAPIRequest.get('/taxon_name_relationships', {
      params: { 'object_taxon_name_id[]': taxonId, per: 500 }
    })
    const synIds = [...new Set(
      (rels || [])
        .filter((r) => r.type?.includes('Invalidating::Synonym'))
        .map((r) => r.subject_taxon_name_id)
        .filter(Boolean)
    )]
    if (!synIds.length) return []

    const p = new URLSearchParams()
    synIds.forEach((id) => p.append('taxon_name_id[]', id))
    p.append('per', '500')
    const { data: names } = await makeAPIRequest.get(`/taxon_names?${p.toString()}`)
    return (names || []).map((n) => n.cached || n.name).filter(Boolean)
  } catch {
    return []
  }
}
