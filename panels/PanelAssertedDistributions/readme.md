# PanelAssertedDistributions

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.5.4 (npm package setup)

Table panel (`panel:asserted-distributions`) displaying all asserted distributions for an OTU, its descendants, and its synonyms, grouped by country/parent area, with structured citations.

## Setup

Place this directory (`PanelAssertedDistributions`) in the `panels/` folder on the setup branch. Add the panel to your `taxa_page.yml` layout under a **SpeciesGroup** tab:

```yaml
taxa_page:
  asserted_distributions:
    label: 'Asserted Distributions (List)'
    rank_group: ['SpeciesGroup']
    panels:
      - - - id: panel:asserted-distributions
```

> **Note:** Using `rank_group: SpeciesGroup` ensures the panel only appears on species and subspecies pages. It is not useful at genus or family level.

## Display

### Tabs

When distributions span multiple OTUs (e.g. a species, its subspecies, and its synonyms), tabs appear:

- **All**: merged view, one row per geographic area, with a Taxa column listing all taxa recorded there. Synonym taxa are marked with ❌.
- **Per-taxon tabs**: filters to a single OTU, one row per distribution record. Synonym tabs are marked with ❌ before the name.

Tabs are hidden on pages with a single OTU (e.g. subspecies pages with no synonyms).

### Grouping

Records are grouped by parent area:

- Areas whose parent is `"Earth"` (countries and top-level territories) appear under **"Countries & Territories"**.
- Sub-national areas (states, provinces, etc.) are grouped under their parent country name.

Groups and areas within groups are sorted alphabetically.

### Table columns

| Column | Notes |
|---|---|
| Area | Geographic area name with type label |
| Taxa | *(All tab only)* Taxa recorded for this area, in italic, separated by `; `. Synonyms marked with ❌. |
| Absent | "Absent" label when `is_absent` is true |
| Citation | Short reference (e.g. `Smith, 2020:45`); click to expand full reference in a modal. 3+ authors truncated to `First et al., Year`. Multiple citations separated by `; `. |

## API calls

**Step 1:**

1. **`/otus`**: `taxon_name_id[]=X&descendants=true&coordinatify=true`. Resolves the full OTU set: the valid taxon, its descendants (subspecies/varieties), and every coordinate OTU (true synonym sharing the same valid taxon name), all decided by TaxonWorks itself via `coordinatify`, not by this panel walking `taxon_name_relationships` (an earlier version did that, filtering by `type.includes('Invalidating')`, which also matched Misapplication/Homonym relationships and could pull in an unrelated taxon's distributions). Result is deduplicated. `/otus` has no id-only/lean response mode, but `rank_group: ['SpeciesGroup']` (below) keeps the resolved OTU set, and so this payload, small in practice.

**Step 2:**

2. **`/asserted_distributions`**: `otu_id[]=OTU1&otu_id[]=OTU2&...`, one batch for every OTU resolved in step 1.

**Step 3, one batch each, in parallel, for all records:**

3. **`/citations`**: `citation_object_type=AssertedDistribution&citation_object_id[]=...&extend[]=source`. Returns citation records with the full source object embedded, no separate `/sources` call needed.
4. Tags and data attributes, one batch each.

Steps 1, 2, and every fetch in step 3 go through the shared `fetchAllPages()` (`panels/_shared/fetchAllPages.js`), which follows the `pagination-total-pages` response header instead of assuming everything fits in one `per`-sized page: a widely-distributed, heavily-synonymized species can exceed 500 records at any of these steps, not just step 2. Remaining pages run through a small concurrency-capped worker pool (default 4) rather than one unbounded burst of requests. A failure at any step sets an error state (see Notes) instead of silently rendering as "no records."

## Map modal

Clicking an area name opens a modal with a Leaflet map showing the polygon for that geographic area.

- Polygon data comes from `/otus/:otuId/inventory/distribution.geojson`. This endpoint is pre-fetched in the background after the table loads so that modals open instantly.
- GeoJSON features are indexed by `properties.shape.id` (geographic area ID) in `shapeIdMap`.
- Features with null geometry are skipped. TaxonWorks includes null-geometry entries for synonym distributions inside a valid OTU's inventory GeoJSON; without this guard the null entry can overwrite a real polygon for a shared area.
- The GeoJSON promise cache (`geoPromiseCache`) deduplicates concurrent fetches for the same OTU.
- `VMap` receives `properties.base` as an array (`[fp.base]`) as required by `geojsonDefaultOptions`.

## Notes

- Synonym detection uses `asserted_distribution_object.object_tag`: TaxonWorks embeds `&#10060;` (❌) for synonyms and `&#10003;` (✓) for valid taxa. No extra API call needed.
- Default `per=500` is the page size, not a hard cap: `fetchAllPages()` follows `pagination-total-pages` to load every page. Configurable as a prop in `taxa_page.yml`.
- `useOtuPageRequest` key `panel:asserted-distributions` (page 1 of the asserted-distributions fetch) feeds the package's "view JSON used to build this page" debug link. Later pages register under `panel:asserted-distributions:page2`, `:page3`, ... so a multi-page species still shows its full request set there, not just page 1.
- A thrown error during load (any step, including a transient failure on any one page of a multi-page fetch) shows a distinct "Something went wrong loading distributions." message with a retry button, rather than the same "No records found." an empty-but-successful result shows. The load is still all-or-nothing (a failed page still aborts the whole load), but the failure is never silently misread as "this taxon has no distributions."
