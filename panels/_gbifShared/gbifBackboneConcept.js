// GBIF's TAXONOMY-BACKBONE view of a name: its accepted name plus the synonym
// names the backbone records for that accepted taxon. This is a taxonomy fact,
// not derived from any occurrence sample — used to build the TaxonWorks / GBIF
// name-overlap diagram in PanelGbifTaxon.
//
// The backbone (integer keys) is used deliberately, NOT the CoL v2 match:
// /v1/species/{key}/synonyms only exists on the backbone, and the backbone
// integrates CoL with other checklists into one synonymy.

const MATCH = 'https://api.gbif.org/v1/species/match'
const SPECIES = 'https://api.gbif.org/v1/species'

/**
 * @param {string} name
 * @returns {Promise<{ acceptedName: string, synonymNames: string[] } | null>}
 */
export async function fetchGbifBackboneConcept(name) {
  if (!name) return null
  try {
    const m = await (
      await fetch(`${MATCH}?name=${encodeURIComponent(name)}`)
    ).json()
    const key = m?.acceptedUsageKey || m?.usageKey
    if (!key) return null

    const [accRes, synRes] = await Promise.all([
      fetch(`${SPECIES}/${key}`),
      fetch(`${SPECIES}/${key}/synonyms?limit=200`)
    ])
    const acc = accRes.ok ? await accRes.json() : null
    const syn = synRes.ok ? await synRes.json() : null

    return {
      acceptedName:
        acc?.canonicalName || acc?.scientificName || m?.canonicalName || name,
      synonymNames: (syn?.results || [])
        .map((r) => r.canonicalName || r.scientificName)
        .filter(Boolean)
    }
  } catch {
    return null
  }
}
