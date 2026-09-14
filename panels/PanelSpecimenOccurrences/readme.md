# PanelSpecimenOccurrences (`panel:specimen-occurrences`)

Replaces the separate `PanelSpecimenRecords` + `PanelFieldOccurrences`. Shows the
CollectionObject / FieldOccurrence records for an OTU (or, above species rank, a
per-species aggregate view).

- `PanelSpecimenOccurrences.vue` — rank switch: species/subspecies →
  `SingleSpeciesOccurrences`, anything higher → `SpeciesBars`.
- `SingleSpeciesOccurrences.vue` — one OTU. Single `dwc.json` fetch, records
  grouped/collapsed by shared collecting event via `lib/groupRecords.js`.
  Country / collector / type / media filters, List vs Phenology view.

## Grouping by collecting event

DwC rows carry no collecting event id. `fetchCollectingEventIds()` looks up
`collecting_event_id` for every CollectionObject via
`/collection_objects.json?collection_object_id[]=` (batches of 200), and
`groupRecords.js` collapses specimens that share it (still split by type status
and institutionCode). FieldOccurrences have no public route to their collecting
event, so they, and every record when that lookup fails, use a fallback key over
all DwC collecting-event fields (`EVENT_FIELDS`). A group row shows its first
record's summary, so any field added to the row summary must be a
collecting-event field and must be listed in `EVENT_FIELDS`.

TaxonWorks contains duplicate collecting events with identical data; with ids
they stay separate rows, in the fallback they merge. Tests:
`lib/groupRecords.test.js` (part of `npm test`).
- `SpeciesBars.vue` — per-species bars for a higher taxon; expanding one mounts
  `SingleSpeciesOccurrences` for that species.
- `ListRecords.vue`, `MultiSelect.vue` — presentational.

## Shared dependencies

- `../../_shared/DwcTable.vue` — the CO/FO detail modal, opened from the ⓘ button
  on a record row (`SingleSpeciesOccurrences.vue`).
- `../../_shared/ImageLightbox.vue` — the project-wide fullscreen image viewer,
  opened from a record's media thumbnails. Specimen `associatedMedia` images carry
  CO/FO depiction types, so the lightbox also shows the type-status line and its
  own ⓘ back into `DwcTable`.
- `../../_shared/specimenRef.js` — resolves a biological-association participant to
  the physical CO/FO it refers to (used to show the primary association inline on
  each row).

See [`../../_shared/readme.md`](../../_shared/readme.md).
