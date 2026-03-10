# PaneliNaturalist

Displays research-grade iNaturalist observation photos for a taxon, with pagination.

Adapted from the Orthoptera Species File repository. See `PaneliNaturalist.vue` for full inline documentation. Adapting it to only show research-grade observations and adapting the size, shape and grid layout for the images was done with assistance of ChatGPT. Fixing the taxon matching problem and extending support to all taxonomic ranks was done by Claude AI without human coding input. The code for the GBIF panel was uploaded to Claude as inspiration, as it resolved API requests more accurately.

## Changes from the original

- Images open in a new tab (`target="_blank" rel="noopener noreferrer"`)
- Hover opacity on image links
- Only research-grade observations shown (`quality_grade: 'research'`) for better photo quality
- Improved image grid layout: `grid-cols-[repeat(auto-fill,minmax(400px,1fr))]`
- Image size changed from `square` to `medium` for better resolution
- Panel is no longer restricted to genus and species group ranks — it now works at any rank (family, subfamily, tribe, genus, subgenus, species, etc.)

## Taxon matching fix (documentation written by Claude AI)

The original code passed `taxon_name` directly to the iNaturalist observations
API, which does a fuzzy text search. This caused two problems:

1. A subgenus like *Otiorhynchus (Nihus)* would match the whole genus
   *Otiorhynchus* on iNaturalist, returning observations that don't belong to
   the subgenus.
2. Taxa with similar names in unrelated groups could also be matched.

The fix is a two-step lookup:

1. Parse `expanded_name` to detect the rank and name components (genus,
   subgenus, epithet).
2. Query the iNaturalist `/v1/taxa` endpoint for an **exact taxon ID**, passing
   the rank from `props.taxon.rank` directly — TaxonWorks and iNaturalist use
   the same rank name strings, so this works for any rank. For subgenera, the
   parent genus is also verified via the ancestors list to avoid false matches.
3. Use `taxon_id` (exact) instead of `taxon_name` (fuzzy) for the observations
   query.

If a taxon is not found on iNaturalist (e.g. a subgenus that iNat doesn't
recognise), a "No iNaturalist taxon found" message is shown instead of silently
falling back to a broader taxon.
