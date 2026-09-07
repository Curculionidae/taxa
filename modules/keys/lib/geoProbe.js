// Pure. Resolve a key terminal (or a completeness target taxon) to the flat
// dwc_occurrences presence-probe params + a canonical cache signature, or the
// inventory/dwc.json fallback when no flat column applies.
//
// `name` must be the VALID taxon-name string (caller redirects synonyms through
// effectiveTaxonNameId first). See the design spec section 4.

import { fieldForRank } from './geoScope.js'
import { normRank } from './completeness.js'

export const PRESENCE_PARAMS = { occurrenceStatus: 'present', per: 1 }

export function probeSig(params) {
  return Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export function probeParams(term) {
  const rank = normRank(term?.rank)
  const name = String(term?.name || '').trim()
  if (!name) return { fallback: 'inventory' }

  const field = fieldForRank(rank) // 'family' | 'subfamily' | 'tribe' | 'genus' | null
  if (field) {
    const params = { [field]: name }
    return { params, sig: probeSig(params) }
  }

  if (rank === 'species') {
    const parts = name.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/)
    const genus = parts[0]
    const epithet = parts[parts.length - 1]
    if (!genus || !epithet || genus === epithet) return { fallback: 'inventory' }
    const params = { genus, specificEpithet: epithet }
    return { params, sig: probeSig(params) }
  }

  // subgenus (0% flat-column population), unranked, anything above family
  return { fallback: 'inventory' }
}
