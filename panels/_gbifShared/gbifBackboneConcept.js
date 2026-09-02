// GBIF's TAXONOMY-BACKBONE view of a name: its accepted name plus the synonym
// names the backbone records for that accepted taxon. This is a taxonomy fact,
// not derived from any occurrence sample.
//
// The backbone (integer keys) is used deliberately, NOT the CoL v2 match:
// /v1/species/{key}/synonyms only exists on the backbone, and the backbone
// integrates CoL with other checklists into one synonymy.
//
// NO LONGER USED BY PanelGbifTaxon as of 2026-08-31. The old panel matched a
// name against the backbone by its bare canonical string to get a "second
// opinion" on lumping; for this project's taxa the backbone lumps exactly as
// Catalogue of Life does, and the bare-name match silently hit homonyms (bare
// "Lixus cardui" matches the accepted Aurivillius 1921 homonym), so the concept
// alignment redesign dropped it. PanelGbifMap still calls fetchGbifBackboneConcept
// for its density-tile gate (signal (b): does the backbone list a synonym whose
// epithetKey is outside the TaxonWorks name set).

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
