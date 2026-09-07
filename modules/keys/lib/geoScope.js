// Rank-to-DWC-field mapping for the per-country flat-column probe.
// Pure — no Vue, no network. Used by composables/useKeyGeography.js.

import { rankIndex, RANK_ORDER } from './completeness.js'

// Ranks `dwc_occurrences` carries as its own flat, indexed column, restricted to
// the ones confirmed well populated on this project (checked live, 2026-09-05):
// family 99.7%, subfamily 99.3%, genus 98.2%, tribe 95.5%. Notably NOT subgenus
// (0% populated, the column exists but nobody in this project uses it), so a
// terminal at that rank must keep using the descendant-AD / inventory passes.
// See docs/feasibility_key_geography_filter.md, "2026-09-05 update".
const RANK_TO_DWC_FIELD = {
  family: 'family',
  subfamily: 'subfamily',
  tribe: 'tribe',
  genus: 'genus'
}

export function fieldForRank(rank) {
  const i = rankIndex(rank)
  return i < 0 ? null : RANK_TO_DWC_FIELD[RANK_ORDER[i]] || null
}
