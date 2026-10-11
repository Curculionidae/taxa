# PanelSpecimenOccurrences (`panel:specimen-occurrences`)

Replaces the separate `PanelSpecimenRecords` + `PanelFieldOccurrences`. Shows the
CollectionObject / FieldOccurrence records for an OTU (or, above species rank, a
per-species aggregate view).

- `PanelSpecimenOccurrences.vue` — rank switch: species/subspecies →
  `SingleSpeciesOccurrences`, anything higher → `SpeciesBars`.
- `SingleSpeciesOccurrences.vue` — one OTU. Single `dwc.json` fetch, records
  grouped/collapsed via `lib/groupRecords.js` (see below).
  Country / collector / type / media filters, List vs Phenology view.
- `SpeciesBars.vue` — per-species bars for a higher taxon; expanding one mounts
  `SingleSpeciesOccurrences` for that species.
- `ListRecords.vue`, `MultiSelect.vue` — presentational.

## Row text (list view)

User decisions, 2026-10-11:

- Locality line: country and province in bold, then a colon and the rest of the
  locality, then the georeferenced point in brackets, e.g.
  `Brazil, Mato Grosso: Rosário-Oeste (14.83583°S, 56.42778°W ±10 m)`. The point
  is `decimalLatitude` / `decimalLongitude` (not the verbatim coordinates) with
  `coordinateUncertaintyInMeters`; the number of decimals follows the uncertainty.
- Line below: `leg. N. Yunakov, 2024-05-02`, or `collected 1973-10` when no
  collector is recorded (`observed 1973-10` for a field occurrence).
- The primary biological association is a green chip (`--pp-bio-chip*` in
  `../_shared/panel-tokens.css`, the package VBadge green that association
  citations use in the bibliography). A partner OTU links to its page, and an OTU
  with a name of its own shows only that name (`otuOwnName()` in
  `../_shared/otuTag.js`). A click on any link in a row does not open the detail
  modal.

## Grouping (collapsed rows)

**Rule (user decision, 2026-09-14):** records collapse into one row only when they
are otherwise exactly the same. The only things allowed to differ inside a group
are `habitat`, `samplingProtocol` and biological associations, and wherever they
differ the collapsed record list must say so.

**What must match** (`buildGroupKey()` in `lib/groupRecords.js`): object type,
type status, institutionCode, scientificName, and every DwC collecting-event field
in `EVENT_FIELDS` (country, stateProvince, county, municipality, waterBody,
islandGroup, island, locality, verbatimLocality, coordinates and uncertainty,
elevation, fieldNumber, eventDate, verbatimEventDate, eventTime, year/month/day,
recordedBy). Values are compared as strings, since endpoints disagree on numbers
(`1999` vs `"1999"`).

**What may differ** (`PER_RECORD_EVENT_FIELDS`, plus associations): shown in the
group's "Individual records" list by `recordDifferencesHtml()` in
`SingleSpeciesOccurrences.vue`, only for values that actually differ within that
group, e.g. `ZMUH 123 · habitat marsh · sampling protocol not recorded`. An
association shared by every record in the group is shown once on the group row
instead.

**Why:**
- The group row shows the first record's headline, summary, depository and
  minority scientific name for all its records. The old six-field key (country,
  stateProvince, county, verbatimLocality, eventDate, recordedBy) let records with
  different coordinates or locality collapse, so the row misattributed a place.
  In a sample of 5000 sfg specimens, 20 of its 110 group rows mixed different
  collecting events.
- Institution and type status split groups so a row never asserts one member's
  depository or type status for all (earlier explicit decision).
- Not keyed on TaxonWorks `collecting_event_id` (tried first, commit `0dd0d0f`):
  records differing only in habitat are on different collecting events by
  definition, so they could never collapse. For reference,
  `/collection_objects.json?collection_object_id[]=` does return
  `collecting_event_id`; FieldOccurrences have no public route to theirs.

**Keep in mind when changing it:**
- Any field added to the row headline or summary must be in `EVENT_FIELDS`,
  never in `PER_RECORD_EVENT_FIELDS`.
- A new field allowed to differ goes in `PER_RECORD_EVENT_FIELDS` and gets a label
  in `PER_RECORD_FIELD_LABELS`, so it shows up in the record list.
- `hasNoEventFields()` checks only `EVENT_FIELDS` (never institutionCode):
  records with no collecting-event data stay single rows instead of collapsing
  as "equally blank".
- Tests: `lib/groupRecords.test.js` (part of `npm test`).

## Shared dependencies

- `../../_shared/DwcTable.vue` — the CO/FO detail modal, opened from the ⓘ button
  on a record row (`SingleSpeciesOccurrences.vue`).
- `../../_shared/ImageLightbox.vue` — the project-wide fullscreen image viewer,
  opened from a record's media thumbnails. Specimen `associatedMedia` images carry
  CO/FO depiction types, so the lightbox also shows the type-status line and its
  own ⓘ back into `DwcTable`.
- `../../_shared/typeMaterialSpecimen.js` — type specimens of the name and of every
  synonym. A type usually has no taxon determination, so `dwc.json` does not list
  it; `fetchMissingTypeSpecimens()` in `SingleSpeciesOccurrences.vue` adds each one
  the inventory lacks from `/collection_objects/:id/dwc`. Those rows have no
  `scientificName` and no `otu_id`.
- `../../_shared/specimenRef.js` — resolves a biological-association participant to
  the physical CO/FO it refers to (used to show the primary association inline on
  each row).

See [`../../_shared/readme.md`](../../_shared/readme.md).
