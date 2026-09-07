// One place for the "synonym -> valid taxon_name" rule so it can't drift
// between call sites. Pure — no Vue, no network.
//
// A TaxonWorks /taxon_names row for a synonym carries cached_is_valid: false
// and cached_valid_taxon_name_id pointing at the accepted name. Everything
// that needs to treat a key terminal (or any other taxon_name reference) as
// "whichever taxon_name actually carries the data" — descendant walks,
// dwc_occurrences flat-column probes, out-of-scope checks — should redirect
// through this before using the id, or it silently operates on a name with
// no data of its own. There is no package-level ("TaxonPages") utility for
// this (checked node_modules/@sfgrp/taxonpages/src, 2026-09-07): the OTU page
// itself never redirects a synonym OTU to its valid taxon, it loads whatever
// taxon_name_id the OTU points to as-is.

// row: a /taxon_names API row (or null/undefined). Returns the id to treat
// this taxon_name as: its own id if valid (or the flag/target is missing),
// else cached_valid_taxon_name_id.
export function effectiveTaxonNameId(row) {
  if (row?.cached_is_valid === false && row.cached_valid_taxon_name_id) {
    return row.cached_valid_taxon_name_id
  }
  return row?.id ?? null
}
