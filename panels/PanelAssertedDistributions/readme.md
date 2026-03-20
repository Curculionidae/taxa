# PanelAssertedDistributions

Table panel (`panel:asserted-distributions`) displaying all asserted distributions for an OTU, grouped by country/parent area, with geographic area details and structured citations.

## Setup

Place this directory (`PanelAssertedDistributions`) in the `panels/` folder on the setup branch. Add the panel to your `taxa_page.yml` layout:

```yaml
- panel:asserted-distributions
```

## Display

Records are **grouped by parent area**:

- Areas whose parent is `"Earth"` (i.e. countries and top-level territories) appear under a **"Countries & Territories"** header.
- Sub-national areas (states, provinces, etc.) are grouped under their **parent country name** as a section header.

Groups and areas within groups are sorted alphabetically. This hierarchy is derived from `asserted_distribution_shape.parent.name`, which is included in the standard API response without any extra `extend` parameter.

### Table columns

| Column | Source |
|---|---|
| Area | `asserted_distribution_shape.name` (indented under group header) |
| Type | `asserted_distribution_shape.geographic_area_type.name` (Country, State, Unknown, …) |
| Absent | "Absent" label when `is_absent` is true |
| Citation | Short reference (e.g. "Smith, 2020:45"); click to expand full reference in a modal |

## API calls

1. `/asserted_distributions?otu_id[]=X&per=500`
   Returns distribution records. Each record includes `asserted_distribution_shape` (geographic area with name, parent, type) and `is_absent`. No `extend` parameter needed.

2. `/citations?citation_object_type=AssertedDistribution&citation_object_id[]=...`
   Returns citation records with `source_id` and `citation_source_body` (short form).

3. `/sources?source_id[]=...`
   Returns full source records (`cached` field, full HTML reference) for unique sources.

## Links

URLs in the full reference modal are made clickable via `convertUrlsToLinks` from `@/modules/bibliography/utils/convertUrlsToLinks.js`.

## Notes

- Default `per=500` loads all records at once, which is appropriate for the grouped display (pagination would split groups across pages). Configurable as a prop via `taxa_page.yml` if needed.
- No `rankGroup` restriction — asserted distributions exist at any taxonomic rank.
- `useOtuPageRequest` key is `panel:asserted-distributions` to avoid cache collisions with other panels.
