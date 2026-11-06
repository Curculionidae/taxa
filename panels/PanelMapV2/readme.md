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

**Synonym pages**
- On a synonym's page (`taxon.is_valid === false`) the map asks TaxonWorks for the name's own records only (`coordinate_otus=false` on `distribution.geojson` and `distribution_is_absent.geojson`, the switch the package's map uses since taxonpages PR 380). By default TaxonWorks adds the valid name's and every synonym's records. A synonym with no records of its own gets an empty map. The valid name's page stays merged

**Type Material**
- A type specimen usually has no taxon determination (the type status is the identification), so TaxonWorks does not list it under the OTU. The geojson then carries a type of the page's own valid name only as a `TypeMaterial` entry (TypeMaterial id, not the specimen id), and a type of a synonym not at all
- `../_shared/typeMaterialSpecimen.js` finds the type specimens of the name and all its synonyms (cached per OTU, shared by the store and the popup)
- Popup: a `TypeMaterial` row resolves its specimen on open and then renders like a Collection Object row, without a determined name, clickable into the same DarwinCore record. If the specimen can't be resolved the row stays plain text; if the same popup already has a Collection Object row showing that type status, the Type Material row is dropped as a duplicate
- Store (`addMissingTypeSpecimens`, after the tag / type-status styling has been applied): type specimens the geojson lacks become features in `store.typeSpecimenFeatures` (`utils/typeSpecimenFeatures.js`). `PanelMapV2.vue` adds them to the layer group VMap already built (`addTypeSpecimenLayers`, again after every `geojson:ready`). They are deliberately not merged into `distribution.geojson`: VMap deep-watches it and would clear all layers and refit the view under the user
- They are `CollectionObject` entries flagged `undetermined` (no name line in the popup), coloured through `typeStatusByCoId` like any other type. Specimens at exactly the same place share one feature and one popup
- Only types of the page's own name are coloured as type material (`fetchTypeSpecimenIdsOfName`, `type_specimen_taxon_name_id` of the page name, so by name record, not by label text). A synonym's type on the valid name's map is drawn as an ordinary specimen (`kind: null` in `typeStatusByCoId`, see `typeColourOnlyForName`) but keeps its type pill in the popup. If that lookup fails every type stays coloured
- Legend: "Collection object" is listed only while some specimen on the map is drawn in that colour (`hasOrdinarySpecimen`, `syncCollectionObjectLegend` in the store, run after each type-status update). A map whose only specimen is a type, e.g. the page of *Asproparthenis meridionalis* with just its syntype, lists only the type entry
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

## Cached shapes (fast species map)

`/otus/:id/inventory/distribution.geojson` makes TaxonWorks serialise every
shape on the map on every visit: about 93 ms per area plus 54 µs per point
(Canada alone about 4 s), 10 to 15 s for a widespread species. The same
records without geometry come back in about 1 s.

So a species map is first built by `lib/fastDistribution.js` from requests
without geometry plus shapes stored with the site in `public/map-shapes/`
(`<GeographicArea|Gazetteer>/<id>.json`, loaded by `lib/shapeCache.js`). Only if
that can't be done faithfully (a request fails, a field occurrence without a
georeference, a distribution of something other than an OTU or association)
does the store fall back to `distribution.geojson`. Measured in the browser:
15.6 s → 3.1 s (Otiorhynchus carinatopunctatus), 11.2 s → 2.4 s (Chlorophanus
viridis), 5.2 s → 1.9 s (Pandeleteius hilaris).

What it rebuilds, checked feature by feature against `distribution.geojson`:
- OTUs: the page name's *valid* name, its descendants and the synonyms of both
  (`/otus?taxon_name_id[]=&descendants=true&coordinatify=true`); a synonym page
  only its own OTU. The valid name matters: a nominotypical subspecies can have
  the species as valid name and then shows the species' synonyms.
- Their asserted distributions, labelled `<OTU label> in <area> [Geographic
  Area]`. Absent ones target the page OTU and are dropped on synonym pages (as
  `distribution_is_absent.geojson` does). Association distributions use the
  association's `object_label` and target its side that is one of the OTUs.
- Specimens from each OTU's `dwc.json`: at the georeference, else as the
  collecting event's area (collection objects only: there is no
  `/field_occurrences` index to look up a field occurrence's event).
- Areas without a shape in TaxonWorks (`without-shape.json`) are left out, as
  TaxonWorks does. TypeMaterial entries are left to `addMissingTypeSpecimens`.

Shapes: `npm run map-shapes` (`scripts/build-map-shapes.mjs`) fetches each shape
any distribution of the project uses, simplified (0.005°, 4 decimals): 2,420
shapes, 30 MB. Re-runs only fetch new ones; a shape not cached yet is fetched
live by the map. To check the rebuild against TaxonWorks for some OTUs:
`node scripts/compare-map-distribution.mjs <otuId> … [--synonym]`.
