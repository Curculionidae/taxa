# Better specimen data and the open fixes of 2026-11-22

Follow-up to the placement engine (`PLAN.md`, done). Decided with the user on
2026-11-22: state names and outlines stay Natural Earth (no switch to
TaxonWorks states); Natural Earth country outlines keep deciding where
TaxonWorks has none, cited as today. Everything else found in the review of
2026-11-21/22 is fixed here.

Every task ends with `node --test 'modules/checklists/**/*.test.js'` green.
The cache is rebuilt and compared once, at the end (task 6); the user approves
every moved record before the new cache is committed.

## 1. Specimens without coordinates are placed by their collecting event's area (done 2026-11-22)

Why: a specimen and an asserted distribution on the same area can disagree
today. CO 1383838 (collecting event area GA 22258 Yakutsk gorsovet) gets Russia
without a state, the AD on GA 22258 gets Russia, state Sakha (Yakutia). CO
2746689 (TDWG Irkutsk, no DwC country) was not placed at all, the AD on the
same area was. The engine read only the DwC names.

Data (measured 2026-11-22): 15,731 collecting events, 293 with an area; their
specimens are 332 collection objects. Download: every collecting event
(`GET /collecting_events`, 32 pages, ordered by id, about 12 s), then
`GET /collection_objects?collecting_event_id[]=…` for the 293 (6 requests,
about 3 s). Field occurrences have no index route (only `/field_occurrences/:id/dwc`),
so they keep the DwC path.

- `scripts/download.mjs`: one new part, `specimen_areas.json` (collection
  object id to its collecting event's area id, only for events with an area).
  Add to `FILES`.
- Engine (`placeRecord`): a collection object without coordinates whose
  collecting event area is known (an area of the build's areas, i.e. used by
  some distribution, so its levels and parent are known) is placed exactly as
  an AD on that area (`decideArea` + `areaState`), after the steps
  `no coordinates and no georeference shape` and
  `the collecting event's area is Yakutsk gorsovet (GA 22258)` [TaxonWorks].
  A reason from TaxonWorks data or a rule (e.g. spans several countries)
  stands, as for the AD; only an area that cannot be measured yet (no
  outline, no polygon, not measured yet) hands over to the DwC path, after
  those steps (review of 2026-11-22).
  With coordinates nothing changes: TaxonWorks derived the DwC names from the
  georeference, which is more precise than the area.
- An area no distribution uses: only its id is known (no area endpoint), so
  the DwC path runs, with a step saying so.
- Curator page (`placement/live.js`): `lookupLive` for CO also fetches
  `/collection_objects/:id` (collecting_event_id), `/collecting_events/:id`
  (geographic_area_id) and the area through `/asserted_distributions?geo_shape_id[]=…`,
  as for a GA lookup; the OTU tab does the same in batches. Same input as the
  build, so the same placement.
- Tests: engine (area wins without coordinates, coordinates win, unplaceable
  area falls back to DwC, unknown area falls back), live lookup and the OTU
  tab with a fake request.
- Effect on the download of 2026-11-22: 224 collection objects without
  coordinates have an event area; 7 change (CO 1383838 gains state Sakha
  (Yakutia); 3 Siberian and 2 Sulawesi specimens are newly placed; one DR Congo
  spelling).

## 1b. A georeference drawn as a shape counts as coordinates (done 2026-11-22)

Why: CO 2707818 "Sanju" has a georeference drawn with the shape tool, so its
DwC record has `footprintWKT` but no decimalLatitude/decimalLongitude, and the
engine saw no coordinates. 41 specimens are like that.

- `placement/footprint.js`: a point inside the shape's largest polygon (its
  centre, else the middle of a horizontal cut), rounded to 4 decimals.
- Engine: coordinates, else that point, after the step
  `the georeference is a shape; the point 36.8236, 78.254 inside it is used` [TaxonWorks];
  only without either does the collecting event area (task 1) decide.
- Build and curator page pass `footprintWKT` as `RecordInput.footprint`.
- Effect on the download of 2026-11-22: 24 of the 41 change (15 newly placed,
  9 gain a state), e.g. CO 2707818 China, state Xinjiang.

## 2. Undetermined type specimens are counted (done 2026-11-22)

Result on the download of 2026-11-22: 722 type rows, 704 resolved, 52 placed
in 18 checklists (two taxa new to their checklist: Parasystates burgeoni in
Uganda, Xestorhinus regularis vicinus in Kenya), 648 without any locality,
18 listed with a reason (11 type statuses name no taxon, 4 ambiguous names,
3 valid names without OTU). Built with the user's rule that the curator page
runs the build's code: `placement/specimen.js` (record, label, event area,
unresolved type), `placement/screen.js` (which rows count, replacing the
build's `screenRow` body and the curator page's own `leftOutReason` /
`otuLeftOut` / `recordLeftOut` logic) and `placement/typeStatus.js`, all
used by both; the rule is in CLAUDE.md.

Original plan:

Why: 722 specimen rows have no determination, only a type status (the user
never determines types: the type status is the identification). The build's
first screening check (`rank none`) drops them silently, not even in
`unplaced.json`. 58 have a locality; for 26 the type status name is not in
that country's checklist.

- Download: for every specimen row without `otu_id` but with `typeStatus`,
  `GET /collection_objects/:id?extend[]=type_material` (show route only), the
  type material's taxon name, then the valid name and its OTU
  (`/taxon_names/:id`, `cached_valid_taxon_name_id`; `/otus?taxon_name_id[]=`),
  and the OTU's parents for the classification (existing `otu_parents`).
  Same TaxonWorks link the map uses (`panels/_shared/typeMaterialSpecimen.js`).
- Screening (`buildContext.mjs`, `screenRow`): such a row takes the valid
  name's rank, OTU and classification, and is placed like any specimen. A
  first step says `no determination; type status names Phaeopholus vietnamensis Legalov, 2026` [TaxonWorks].
  A type whose name cannot be resolved is listed in `unplaced.json` with
  the reason `type status name not found in TaxonWorks`, never dropped silently.
- Curator page: the lookup and the OTU tab resolve the same way.

## 3. The ISO dictionary becomes a cited section of placement.yml (done 2026-11-22)

Done: 41 lines (Guadeloupe and Saint Barthelemy dropped: their code comes from
their checklists entry and from TaxonWorks); an unused line is a build warning
saying why.

Why: `scripts/data/country-iso.json` (43 countries whose TaxonWorks area has
no ISO code) decides the checklist of 38 gazetteers (187 records: Solomon
Islands 161, Spain 7, Taiwan 6, Saint Helena 6, Micronesia 5, Russia 1, South
Korea 1), but no step cites it.

Decided 2026-11-22: a section `iso_codes:` in `rules/placement.yml` (one line
per country), not a separate file, so every existing citation, the Rules tab
and `rules.json` work unchanged. The ISO step becomes
`… has ISO code SB` [TaxonWorks], then `SB is the ISO code of Solomon Islands`
[manual, placement.yml:N] (or [TaxonWorks] when TaxonWorks gives the code).

## 4. No state check against a parent that is the country

`areaState` tries the parent's name as a state even when the parent is the
country itself ("the parent Russia (GA 19713) is no state name of Russia").
Skip that check, with its step, when the parent is one of the checklist's
country areas.

## Tags of checks that found nothing (decided 2026-11-22)

`[manual, no rule]` when no line of placement.yml matched; `[overlap, never
measured]` when no overlap line exists for the area; `[overlap]` when a point
lay in no outline; `[TaxonWorks]` unchanged. Done with the review fixes.

## 5. Small items

- `README.md` and engine header: the new specimen order, the type rows.
- `docs/Task_toDo.md`: the TaxonWorks fixes for the user (12 ADs on GADM US
  states without a shape; the other areas without a shape; 8 TDWG collecting
  events; the Xinjiang Uygur collecting event), the two island rules (Dauan
  Island, Lana'i), the step wording review, and the ideas (Spain parts as for
  France, regions in the state drill-down, a measured preview for new
  gazetteers on the curator page).

## 6. Rebuild and compare

`npm run checklists -- --save` (fresh data), `compare.mjs` against the current
cache, report every moved record by cause (area, type, ISO citation). Nothing
is committed before the user has seen and approved the report. The step
changes of 2026-11-21 (every check prints a step) are in the same rebuild.
