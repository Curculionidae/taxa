// Which distribution passes a key-geography terminal needs, by taxonomic rank.
// Pure — no Vue, no network. Used by composables/useKeyGeography.js.
//
// Background (see docs/feasibility_key_geography_filter.md):
//   - A terminal coarser than species carries its distributions on its species,
//     so it needs the descendant asserted-distribution pass.
//   - The /otus/:id/inventory/dwc.json specimen pass rebuilds the whole DWC set
//     server-side on every request (no cheap probe), so for a family/tribe or a
//     giant genus it means tens of thousands of rows / ~100 MB for a handful of
//     specimen-only countries. Restrict it to terminals where it is cheap:
//     species, small informal OTUs, and genus/subgenus terminals that aren't
//     huge. Everything above genus is covered by the descendant-AD pass alone.

import { rankIndex, RANK_ORDER } from './completeness.js'

const SPECIES_IDX = RANK_ORDER.indexOf('species')
const GENUS_IDX = RANK_ORDER.indexOf('genus')

// Default: a genus/subgenus terminal with more curated ADs than this is treated
// as a large taxon and skips the specimen pass.
export const LARGE_TAXON_AD_TOTAL = 2000

// A terminal above species rank — its species hold the distributions, so it
// needs the descendant asserted-distribution query.
export function needsDescendantAd(rank) {
  const i = rankIndex(rank)
  return i >= 0 && i < SPECIES_IDX
}

// Whether to run the /inventory/dwc.json specimen-country pass for a terminal.
// `hasName` is false for an OTU with no taxon name (a small informal grouping —
// the call is cheap, so allow it). `adTotal` is the terminal's descendant-AD
// Pagination-Total from step 2 (0 when not applicable).
export function needsSpecimenPass(
  { rank, hasName, adTotal = 0 },
  largeTaxonAdTotal = LARGE_TAXON_AD_TOTAL
) {
  if (!hasName) return true
  const i = rankIndex(rank)
  if (i < 0) return true // unknown rank — don't over-filter
  if (i >= SPECIES_IDX) return true // species / subspecies / ...
  if (i < GENUS_IDX) return false // tribe, family, superfamily — AD-only
  return adTotal <= largeTaxonAdTotal // genus / subgenus — only if not huge
}
