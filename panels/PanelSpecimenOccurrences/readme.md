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

`groupRecords.js` collapses records only when they are otherwise exactly the
same: object type, type status, institutionCode, scientificName and every DwC
collecting-event field (`EVENT_FIELDS`). The only fields allowed to differ inside
a group are `habitat` and `samplingProtocol` (`PER_RECORD_EVENT_FIELDS`), plus
biological associations. Wherever those differ, the group's "Individual records"
list shows them per record (`recordDifferencesHtml()` in
`SingleSpeciesOccurrences.vue`); an association shared by the whole group is
shown once on the group row.

A group row shows its first record's summary, so any field added to the row
summary must be listed in `EVENT_FIELDS`. Grouping deliberately ignores
`collecting_event_id`: records differing in habitat are on different collecting
events by definition. Tests: `lib/groupRecords.test.js` (part of `npm test`).
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
