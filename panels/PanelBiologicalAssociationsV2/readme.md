# PanelBiologicalAssociationsV2

New experimental panel (`panel:biological-associations-v2`) displaying biological associations for a taxon. Based on the built-in `panel:biological-associations` panel.

Added features: with inline depictions, asserted distributions, and citations that can be clicked to show the full reference. URLs in references are clickable both in the citation popup and the image popup. 

> This panel was developed by vibe coding with [Claude.ai](https://claude.ai).

## Setup

Put this directory (PanelBiologicalAssociationsV2) into the panels folder on the setup branch of your TaxonPages. Add the panel to your `taxa_page.yml` layout:

```yaml
- panel:biological-associations-v2
```

## Differences from the built-in panel

- **Depictions** shown as thumbnails inline in the table; clicking opens the full `ImageViewer` lightbox with figure label, attribution, and source reference
- **Asserted distributions** shown as a list of area names per row (absent records struck through)
- **Citations** shown as clickable short references (e.g. "Masur & Wartmann, 2025:93"); clicking opens a modal with the full formatted reference, with URLs rendered as clickable links
- Order and Genus columns removed to reduce horizontal clutter
- Object Family column left blank for non-OTU objects (e.g. FieldOccurrence) and when family data is missing in TaxonWorks

## API calls

The `/biological_associations/basic` endpoint does not return depictions, distributions, or structured citations. After loading the associations page, four additional batch requests are fired in parallel:

1. `/depictions?depiction_object_type=BiologicalAssociation&depiction_object_id[]=...`  
   Returns depiction records for associations on the current page.

2. `/depictions/gallery?depiction_id[]=...`  
   Returns full image data in one call: thumb/original URLs, figure label, and attribution. This is the same endpoint used by the gallery panel internally (`useGallery.js`).  
   After this, one additional request per image is made to `/images/:id?extend[]=source` to fetch the publication source.

3. `/asserted_distributions?biological_association_id[]=...`  
   Returns asserted distribution records grouped by association ID.

4. `/citations?citation_object_type=BiologicalAssociation&citation_object_id[]=...`  
   Returns citation records with `source_id` and `citation_source_body` (short form).  
   Followed by one batch call to `/sources?source_id[]=...` to get the full `cached` reference HTML for each unique source.

## ImageViewer

The lightbox reuses the global `ImageViewer` component. Images are shaped to match its expected format:

- `depictions[0].label` — figure label (caption line)
- `attribution.label` — copyright and license
- `source.label` — full publication reference with clickable URLs

## Notes

- `useOtuPageRequest` is called with key `panel:biological-associations-v2` to avoid cache collisions with the built-in panel
- The `citations` plain string from the basic endpoint is kept as a fallback for rows where no structured citations are found via `/citations`
