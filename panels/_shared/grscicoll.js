/**
 * grscicoll.js
 *
 * GRSciColl (GBIF) institution/collection full-name lookups: resolves a DwC
 * institutionCode/collectionCode abbreviation (e.g. "ZMUH") to a full name
 * (e.g. "Zoologisches Institut..."). Institution and collection are separate
 * GRSciColl record types, e.g. code "NHRS" resolves to the institution
 * "Swedish Museum of Natural History" but is also, confusingly, the code of
 * its "Department of Entomology" collection, so they're cached separately.
 *
 * Module-level caches are shared across every caller: two panels showing the
 * same specimen no longer independently re-hit the GBIF API for the same
 * institution code.
 *
 * Depended on by:
 *   - ./DwcTable.vue
 *   - ../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue
 *     (resolveInstitutionName + getCachedInstitutionName only, this panel
 *     doesn't resolve collectionCode separately)
 *
 * If you change this file, sanity-check both call sites.
 */

const instNameCache = new Map()
const collNameCache = new Map()

/**
 * Resolves a DwC institutionCode to its full GRSciColl institution name.
 * Precise: institutionID (a GRBio/GRSciColl identifier URL) resolves to
 * exactly one institution when registered. Falls back to a code search,
 * which may return multiple results, in that case there's no single
 * unambiguous match, so the caller falls back to the raw code.
 * @param {string} code
 * @param {string} [institutionID]
 * @returns {Promise<string|null>}
 */
export async function resolveInstitutionName(code, institutionID) {
  if (!code) return null
  if (instNameCache.has(code)) return instNameCache.get(code)
  try {
    if (institutionID) {
      const r = await fetch(`https://api.gbif.org/v1/grscicoll/institution?identifier=${encodeURIComponent(institutionID)}`)
      if (r.ok) {
        const j = await r.json()
        if (j.results?.length === 1) {
          instNameCache.set(code, j.results[0].name)
          return j.results[0].name
        }
      }
    }
    const r = await fetch(`https://api.gbif.org/v1/grscicoll/institution?code=${encodeURIComponent(code)}`)
    if (r.ok) {
      const j = await r.json()
      if (j.results?.length === 1) {
        instNameCache.set(code, j.results[0].name)
        return j.results[0].name
      }
    }
  } catch {}
  instNameCache.set(code, null)
  return null
}

/**
 * Synchronous read of whatever resolveInstitutionName has already cached for
 * this code (undefined if it hasn't been resolved yet). For a caller that
 * pre-fetches institution names in bulk (see SingleSpeciesOccurrences.vue's
 * loadDwc) and only needs to read the result back later, synchronously,
 * while building display HTML for many rows.
 * @param {string} code
 * @returns {string|null|undefined}
 */
export function getCachedInstitutionName(code) {
  return instNameCache.get(code)
}

/**
 * Resolves a DwC collectionCode to its full GRSciColl collection name. Only
 * meaningful when collectionCode differs from institutionCode, i.e. it names
 * a sub-collection, pass institutionCode to disambiguate the search.
 * @param {string} code
 * @param {string} [institutionCode]
 * @returns {Promise<string|null>}
 */
export async function resolveCollectionName(code, institutionCode) {
  if (!code) return null
  const cacheKey = `${institutionCode || ''}|${code}`
  if (collNameCache.has(cacheKey)) return collNameCache.get(cacheKey)
  try {
    const params = new URLSearchParams({ code })
    if (institutionCode) params.set('institutionCode', institutionCode)
    const r = await fetch(`https://api.gbif.org/v1/grscicoll/collection?${params}`)
    if (r.ok) {
      const j = await r.json()
      if (j.results?.length === 1) {
        collNameCache.set(cacheKey, j.results[0].name)
        return j.results[0].name
      }
    }
  } catch {}
  collNameCache.set(cacheKey, null)
  return null
}
