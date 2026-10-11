# PanelMapV2

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.5.4 (npm package setup)

This panel is a fork of the vanilla TaxonPages map panel, branched from the state of the codebase on **2026-03-21**. It is a drop-in replacement and accepts the same props (`otuId`, `otu`, `taxon`, `cluster`).

## Key improvements over the original

### More informative popup windows (`components/MapPopup.vue`)

The original popup showed bare item labels for all feature types. This version renders each type differently:

**Collection Object / Field Occurrence**
- Type label ("Collection object" / "Field occurrence") displayed as a muted heading
- Species name on a second line: epithet in italics, author in plain text
- Entire row is a clickable link (blue, hover underline) that opens the full DarwinCore record

**Type Material**
- A type specimen usually has no taxon determination (the type status is the identification), so TaxonWorks does not list it under the OTU. The geojson then carries a type of the page's own valid name only as a `TypeMaterial` entry (TypeMaterial id, not the specimen id), and a type of a synonym not at all
- `../_shared/typeMaterialSpecimen.js` finds the type specimens of the name and all its synonyms (cached per OTU, shared by the store and the popup)
- Popup: a `TypeMaterial` row resolves its specimen on open and then renders like a Collection Object row, without a determined name, clickable into the same DarwinCore record. If the specimen can't be resolved the row stays plain text; if the same popup already has a Collection Object row showing that type status, the Type Material row is dropped as a duplicate
- Store (`addMissingTypeSpecimens`, after the tag / type-status styling has been applied): type specimens the geojson lacks become features in `store.typeSpecimenFeatures` (`utils/typeSpecimenFeatures.js`). `PanelMapV2.vue` adds them to the layer group VMap already built (`addTypeSpecimenLayers`, again after every `geojson:ready`). They are deliberately not merged into `distribution.geojson`: VMap deep-watches it and would clear all layers and refit the view under the user
- They are `CollectionObject` entries flagged `undetermined` (no name line in the popup), coloured through `typeStatusByCoId` like any other type. Specimens at exactly the same place share one feature and one popup
- Where such a specimen is drawn: its georeference, from the DwC record (`footprintWKT`, else `decimalLatitude`/`decimalLongitude`). A type located only by geographic area is not drawn (TaxonWorks has no public route for an area's shape, and repainting an asserted-distribution polygon as a type would be wrong); it still appears in the specimen records list. In dev the console lists those ids

**Asserted Distribution / Asserted Absent**
- Type label as a muted heading
- Geographic area name in bold (extracted from the feature label)
- Species name the distribution refers to (italic epithet, plain author)
- Short citations fetched lazily on popup open and displayed as clickable links
- Clicking a citation opens the full reference in a modal overlay
- Citations are cached at the module level so repeated opens are instant

### Full DarwinCore record modal (`../_shared/DwcTable.vue`)

Clicking a Collection Object or Field Occurrence row in the popup opens a structured modal with all available DwC fields, grouped into sections:

- Record
- Identification
- Collection event
- Location
- Elevation
- Coordinates (with OpenStreetMap link)
- Other
- Specimen (shown last)

Empty fields are hidden. All labels share a single grid column so values align cleanly across sections.

> This component lives in `panels/_shared/DwcTable.vue` so `PanelGallery` (via `ImageLightbox`), `PanelBiologicalAssociationsV2`, `PanelSpecimenOccurrences`, and this panel (`PanelMapV2.vue` + `Search/OtuSearch.vue`) all use the one modal instead of duplicate copies. See [`../_shared/readme.md`](../_shared/readme.md) for the full list of dependents.

## Directory layout

```
PanelMapV2/
  PanelMapV2.vue          # Root component; handles map, popup, citation modal
  main.js                 # Panel entry point
  clusters/               # Leaflet cluster icon logic
  components/
    CachedMap.vue         # Fallback cached-map image
    MapPopup.vue          # Popup rendered into the Leaflet popup element
    Search/               # OTU search overlay
  composables/
    useGeojsonOptions.js  # Wires Leaflet popup events to popupItem ref
  constants/              # Legend definitions
  store/
    useDistributionStore.js  # Pinia store; fetches GeoJSON distribution data
  utils/
    removeDuplicateShapes.js  # Deduplicates features sharing the same geographic shape
    makeGeoJSONFeature.js
    makeSegmentedCircle.js
    isRankGroup.js
```
