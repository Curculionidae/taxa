# PanelAssertedDistributions

Table panel (`panel:asserted-distributions`) displaying all asserted distributions for an OTU, its descendants, and its synonyms — grouped by country/parent area, with structured citations.

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

- **All** — merged view: one row per geographic area, with a Taxa column listing all taxa recorded there. Synonym taxa are marked with ❌.
- **Per-taxon tabs** — filters to a single OTU, one row per distribution record. Synonym tabs are marked with ❌ before the name.

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

Loading completes in ~1–2 seconds. The sequence is optimised: step 1 runs in parallel, steps 2–3 are only as sequential as the data dependencies require.

**Step 1 — parallel (~300ms):**

1. **`/asserted_distributions`** — `taxon_name_id[]=X&descendants=true&per=500`. Covers the valid OTU and all its subspecies/varieties.
2. **`/taxon_name_relationships`** — `object_taxon_name_id[]=X`. Returns Invalidating relationships → synonym `taxon_name_id`s.

**Step 2 — only when synonyms exist (~150ms):**

3. **`/asserted_distributions`** — `taxon_name_id[]=SYN1&taxon_name_id[]=SYN2&...`. OTUs already covered by step 1 are excluded to prevent duplication.

**Step 3 — one batch for all records (~500ms):**

4. **`/citations`** — `citation_object_type=AssertedDistribution&citation_object_id[]=...`
5. **`/sources`** — `source_id[]=...`

## Map modal

Clicking an area name opens a modal with a Leaflet map showing the polygon for that geographic area.

- Polygon data comes from `/otus/:otuId/inventory/distribution.geojson`. This endpoint is pre-fetched in the background after the table loads so that modals open instantly.
- GeoJSON features are indexed by `properties.shape.id` (geographic area ID) in `shapeIdMap`.
- Features with null geometry are skipped. TaxonWorks includes null-geometry entries for synonym distributions inside a valid OTU's inventory GeoJSON; without this guard the null entry can overwrite a real polygon for a shared area.
- The GeoJSON promise cache (`geoPromiseCache`) deduplicates concurrent fetches for the same OTU.
- `VMap` receives `properties.base` as an array (`[fp.base]`) as required by `geojsonDefaultOptions`.

## Notes

- Synonym detection uses `asserted_distribution_object.object_tag`: TaxonWorks embeds `&#10060;` (❌) for synonyms and `&#10003;` (✓) for valid taxa. No extra API call needed.
- Default `per=500` loads all records at once. Configurable as a prop in `taxa_page.yml`.
- `useOtuPageRequest` key is `panel:asserted-distributions` to cache the main AD fetch across navigation.
