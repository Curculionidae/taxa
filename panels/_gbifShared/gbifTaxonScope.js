import { matchGbifKey } from './useGbifMatch'
import { fetchTwSynonymNames } from './twSynonymNames'

/**
 * The full GBIF scope for a TaxonWorks taxon: its accepted name **and every one
 * of its TaxonWorks synonyms**. A weevil species often carries several synonyms,
 * each of which may resolve to its own GBIF/CoL usage with its own occurrence
 * and type records that the accepted name's `taxonKey` rollup doesn't reach.
 *
 * @returns {Promise<{ names: string[], keys: string[] }>}
 *   `names` — accepted + synonym name strings, for the result name-filter
 *             (`makeGbifNameFilter`).
 *   `keys`  — the distinct CoL usage keys to OR together as `taxonKey` params.
 *
 * Options pass straight to `matchGbifKey`:
 * - `speciesGroupOnly` — keep only species-group matches (type-material panels).
 * - `rejectHigherRank` — drop only `matchType: HIGHERRANK` (name absent from CoL
 *   → silently upgraded to its genus); a genuine genus/family match is kept, so
 *   genus and family pages still work.
 */
// 4–5 GBIF panels resolve the same scope on one page load — memoise the promise.
const cache = new Map()

export function resolveGbifTaxonScope(primaryName, taxonId, opts = {}) {
  const { speciesGroupOnly = false, rejectHigherRank = false } = opts
  const key = `${taxonId}|${primaryName}|${speciesGroupOnly ? 1 : 0}${rejectHigherRank ? 1 : 0}`
  if (!cache.has(key)) {
    cache.set(key, resolveUncached(primaryName, taxonId, { speciesGroupOnly, rejectHigherRank }))
  }
  return cache.get(key)
}

async function resolveUncached(primaryName, taxonId, { speciesGroupOnly, rejectHigherRank }) {
  const synonymNames = await fetchTwSynonymNames(taxonId)
  const names = [...new Set([primaryName, ...synonymNames].filter(Boolean))]
  const keys = [...new Set(
    (await Promise.all(
      names.map((n) =>
        matchGbifKey(n, { speciesGroupOnly, rejectHigherRank }).catch(() => null)
      )
    )).filter(Boolean)
  )]
  return { names, keys }
}
