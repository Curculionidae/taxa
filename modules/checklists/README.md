# Country checklists (`/checklists`)

Adapted, with permission, from the country checklists of Fleas of the World
Online (jrpletch/fleasoftheworld, `pages/checklists.vue` at 2afe35c).

## Files

- `ChecklistsPage.vue`: the page (route `checklists`, `/checklists`).
- `router/index.js`, `package.json`: register the module with the framework.
- `components/ChecklistMap.vue`: the Leaflet map.
- `data/`: map helpers, the compact file format (`compact.js` and its test), colour tokens.
- `scripts/build.mjs`: builds the cache (`npm run checklists`, see "Building the cache"): reads the TaxonWorks data, places every record through the placement engine, writes `public/checklists/`.
- `scripts/buildContext.mjs`: turns the TaxonWorks data into records, areas, checklists and the engine context, and places one record; shared by `build.mjs` and `compare.mjs`.
- `scripts/compare.mjs`, `scripts/compareCaches.mjs`: compare two caches record by record and write a report for the curator (see "Comparing two caches"); the pure helpers are tested in `compareCaches.test.js`.
- `scripts/download.mjs`: everything the build fetches from TaxonWorks, and saving or reading it as files for offline runs (`--save`, `--from`).
- `scripts/cacheFiles.mjs`: pure helpers that shape the written files (checklist keys, the country file header, index entries, `unplaced.json`); tested in `cacheFiles.test.js`.
- `scripts/data/country-iso.json`: ISO codes of countries whose TaxonWorks area carries none.
- `placement/specimen.js`, `placement/screen.js`, `placement/typeStatus.js`, `placement/footprint.js`: the specimen record and its label, the screening (which rows count), undetermined type specimens, the point of a georeference shape; each used by the build and the curator page alike (the curator page has no logic of its own: CLAUDE.md).
- `scripts/measure-overlap.mjs`: measures areas and writes the overlap rules (`npm run checklists:measure`, see "Measuring overlap"); `scripts/geometry-node.mjs`: the outline lookups (Geometry) for Node and `measureShares`.
- `public/checklists/`: the cache output (outside the module, served as static files).
- `modules/checklists/.cache/` (not committed): `data/`, the saved TaxonWorks data; `old/`, a copy of an earlier cache for comparing.
- `CuratorPage.vue` (route `checklists-curator`, `/checklists/curator`), `components/PlacementLookup.vue`, `components/PlacementMap.vue`, `components/OtuPlacements.vue`, `components/AreaTree.vue` (+ `AreaTreeNode.vue`), `components/UnplacedList.vue`, `components/RulesView.vue`, `components/RefText.vue` (rules line links), `components/CopyId.vue` (copy a record id): the curator page (see "Curator page").
- `placement/overview.js`: the curator page's lists from the cache files (area tree, unplaced reasons, OTU summary, rules as rows, live result against the cache); tested in `overview.test.js`.
- `data/tsv.js`: reads the tab separated `/dwc_occurrences.csv` (build and curator page).
- `placement/live.js`: fetches records and areas from TaxonWorks for the curator page (one by lookup, or all of an OTU), places them as the build does (`placeLive`), and says whether the cache lists them; tested in `live.test.js`.
- `placement/geometry.js`: the point tests (point in polygon, coast distance, R22), shared by `scripts/geometry-node.mjs` (the build) and `placement/geometry-browser.js` (the curator page, which also makes the engine context from the cache files); `scripts/browserContext.test.js` checks the browser context reproduces the cache.
- `rules/placement.yml`, `placement/rules.js`: the placement rules file and its compiler (see "The rules file").
- `placement/engine.js`, `areas.js`, `checklists.js`, `states.js`, `format.js`: the placement engine (see "How checklists are formed" and "How a record is placed"); `format.js` writes a decision as text.
- `DESIGN.md`, `PLAN.md`: design and implementation plan.

## Data

Nothing is fetched from TaxonWorks while browsing. `npm run checklists`
writes `public/checklists/` (see "Building the cache" for every file):
`index.json` (checklists, taxon counts, update date, each checklist's cached
outline) and `countries/<key>.json` (one checklist's records, with citations
and place names). Country files are compact (`data/compact.js`): each taxon,
record kind and reference text once per file, records point to them; the page
expands them on load into the same records. Only fields the page shows are
kept (no collector, date or occurrenceID: they were CSV-only and made up most
of the size). In short:

- Every record is placed by the placement engine (see "How a record is
  placed"): asserted distributions by their area, specimens and field
  occurrences by their coordinates (or a point in their georeference shape),
  their collecting event's area, or their DwC fields. Each record
  carries `part` (France: Corsica, Mainland France) and `state` (six
  countries) when the engine finds one.
- Distributions asserted for a biological association (e.g. "egg of Lixus
  bidens collected from stem of Opopanax", in Greece) are not in TaxonWorks'
  DwC export; the build adds them for each beetle side of the association,
  with the association's reading shown next to the place. They are asserted
  distributions on an area, so they are placed like any other.
- Only Curculionoidea, species and subspecies, present records, with an OTU
  (`placement/screen.js` `screenRecord`, the same screening for the build and
  the curator page). One taxon per name (several OTUs of a name count once).
- Undetermined type specimens (no determination, only a type status: types
  are never determined in this project, the type status is the
  identification) take the valid name of their type status
  (`placement/typeStatus.js`): the name exactly as the type status prints it
  (subgenus, `var.` and `[sic]` included) is looked up with
  `GET /taxon_names?name=…&name_exact=true` (without `name_exact` it is a
  substring search); rows without rank (Combination rows) are dropped; when
  several valid names remain, those with the same number of epithets (a
  species, not its nominotypical subspecies), then those with the same author
  (homonyms); then the valid name of a synonym and its OTU (several unnamed
  OTUs on one name, a duplicate in TaxonWorks: the lowest id; same name and
  classification, so it changes nothing). The label says so: `Phaeopholus
  vietnamensis Legalov, 2026 (paratype, no determination)`. A type status that
  names no taxon (`holotype`), several, or a name that does not resolve is
  listed in `unplaced.json` with the reason (`type status names no single
  taxon`, `type status name is ambiguous in TaxonWorks`, `type status name not
  found in TaxonWorks`, `no OTU`). On 2026-11-22: 722 type rows, 704 resolved,
  52 placed (two taxa new to their checklist), 648 without any locality.
- `/dwc_occurrences` is not paged: that index has no stable order and loses
  about 5% of the rows. The download uses `/dwc_occurrences.csv` (one request).

## Status (reassessed, adventive, endemic)

Following the project's conventions for asserted distributions
(https://curculionidae.github.io/docs/TutorialAssertedDistributions/):

- A distribution with a "Reassessment" data attribute, or with an "is absent"
  distribution for the same taxon and area, is `reassessed`: it does not
  count. A taxon with only such records stays in its place in the list, red,
  "Reassessed, not counted", with the note and the refuting source; in the
  downloads "[reassessed, not counted]" and a "Reassessed:" line.
- Tags "Adventive" (on distributions and specimens) and "Endemic" mark the
  taxon with a chip (the site's purple adventive chip) and "[adventive]" /
  "[endemic]" in the downloads; the CSV has a `status` column.

## Map

Country outlines come from the species map's shape cache
(`public/map-shapes/`). A country no record uses directly (Spain, used only
through its provinces) is not in that cache, and TaxonWorks gives out a shape
only through a record using it, so those come from
`public/checklists/fallback-shapes.geojson`: Natural Earth admin-0 country
outlines at 1:10m scale (`ne_10m_admin_0_countries.geojson` of the
nvkelso/natural-earth-vector repository on GitHub), geometry copied unchanged,
`properties.name` only. Kosovo, Norfolk Island and Northern Mariana Islands
were added from that file on 2026-11-20 (no record uses their TaxonWorks
country areas, and the public API gives shapes only of used areas). The fallback
feature is found by the checklist name or any name of its synonym list in the
rules file, accent and case insensitive, so the feature "Saint Barthelemy"
serves the checklist Saint Barthélemy; index.json `fallback` names the feature
the page draws. The script lists countries that have neither. A checklist filed under another country
(index.json `of`: French Guiana under France) is cut out of that country's
outline on the world map: polygons of the country whose centre lies in the
own checklist's `bbox` are dropped. The state/province drill-down draws the
states from `public/checklists/subdivisions.geojson` (Natural Earth) and the
parts of France from their cached outlines. Which state or part a record
belongs to is not worked out on the page: the region dropdown and its counts
read the `part` or `state` the build wrote into each record (the part for
France, the state for the five state countries), so the page and the
explanations of curator mode always agree. A record without one counts for
the country only. The CSV download writes the DwC `stateProvince` of the
record. The page no longer loads `rules.json`.

Where Natural Earth data enters, and where it does not: Natural Earth is
geometry only. No name from it decides anything (R51).

- `fallback-shapes.geojson` (1:10m admin-0 outlines): country outlines for
  checklists without a cached TaxonWorks outline, as above, and for a
  checklist whose rules entry says `outline: natural_earth` (Norfolk Island,
  whose TDWG outline also covers Lord Howe Island). The placement says so
  (`shape` `fallback/Norfolk Island`, a cited step). `measure-overlap.mjs`
  measures against these outlines too.
- `subdivisions.geojson` (from the Fleas of the World port): the list of
  states of each state country (their names are the state names the engine
  matches) and their outlines (for `stateAt`, the measuring script and the
  drill-down). Its `aliases` (other names of a state, such as Moskva for
  Moscow) are not read by the engine: an area known only by such a name gets
  its state from an overlap or manual rule.
- The file also groups Natural Earth counties into four United Kingdom
  "states" (England, Scotland, Wales, Northern Ireland). Since the United
  Kingdom is no longer browsed by state (R50), that grouping is used for
  nothing; the file is kept unchanged for the other five countries.

## How checklists are formed

The list of checklists comes from `placement/checklists.js` (`deriveChecklists`),
which reads the areas that asserted distributions use (`placement/areas.js`,
`toArea`) and the rules file.

- Country areas come from TaxonWorks. A country area is what TaxonWorks calls
  one in `GeographicArea#categorize` (`isCountryArea` in `placement/areas.js`):
  its id equals its `level0_id`, or its type is a country-level type
  (`COUNTRY_LEVEL_TYPES`: Country, Governorate), or its parent is Earth and it
  is not a TDWG area. Each becomes a checklist, named after the area. GA 33412
  "United States of America" (Natural Earth, type Country, `level0_id` empty,
  no shape) is a country by this rule; the US states point to it with their
  `level0_id`, and the synonym line `[United States, United States of
  America]` merges it with GA 237 into United States (areas 237 and 33412, as
  in today's index; the outline comes from GA 237).
- Merging by synonyms: TaxonWorks has several country-level areas for some
  countries (for example "Bosnia and Herz." and "Bosnia and Herzegovina"). Areas
  whose names are listed together in `synonyms`, or are the same after
  normalizing (accents, case and punctuation ignored, see `normalizeName`),
  become one checklist. Its name is the first synonym and its `areaIds` list
  every merged area. Its id is the area with the only ISO code; with none or
  several ISO codes, the lowest id.
- A country area whose parent is not "Earth" (England under United
  Kingdom, Sint Maarten under Netherlands) is not a checklist of its own: its id
  joins its parent's country.
- A country used only through its subdivisions (Spain, Western Sahara, ...) has
  no area of its own. Every level0 id that areas refer to becomes a country, named
  by the `level0Names` map the build passes in (from the DwC country text of
  those records). Without a name the id is skipped and `deriveChecklists`
  returns a warning `level0 <id> has no name (areas: ...)`; it returns
  `{ checklists, warnings }`.
- Own checklists: every entry of `checklists` in the rules file is a checklist
  of its own, even when TaxonWorks files it under another country (`of:`). An
  area id listed there is removed from the country checklist it would have
  belonged to, so no checklist owns an area id twice.
- Ids and keys: a merged country has the id of its area with an ISO code (else
  the lowest area id); an own checklist the numeric id of its first listed GA
  area (French Guiana: 32253), or its ISO code when it lists none (Northern
  Mariana Islands: `MP`). These ids are internal to the engine. Everything
  written to `public/checklists/` uses the checklist key instead, the slug of
  its name (`french-guiana`, see "Building the cache").
- ISO codes: a country takes its ISO code from its TaxonWorks area. Natural
  Earth country areas and countries used only through subdivisions carry
  none, so the build passes `isoByName` (fourth argument, keys are
  `normalizeName` of a country name), filled from
  `scripts/data/country-iso.json`; it is looked up by the checklist name and
  every synonym of it. Gazetteers are placed by ISO code, so without this a
  Solomon Islands gazetteer (ISO SB) would find no checklist.
- `states` is true for the checklists named in the rules file's
  `state_countries` list (United States, Canada, Australia, China, Russia),
  the countries browsed by state. `parts` holds the part names
  from the `parts` section of the rules file (France: Corsica, Mainland France).

## The rules file

`modules/checklists/rules/placement.yml` is hand-edited. It holds what
TaxonWorks cannot say by itself, and the placement engine reads it through
`placement/rules.js` (`compileRules`), which turns it into plain data and notes
the line of every rule. Every explanation of a decision cites the rule that
made it as `placement.yml:<line>`, so the line number in an explanation is the
line to open and change. On the curator page every `placement.yml:N` links to
that line of the file (Rules tab). The line numbers quoted in this README are
examples of 2026-11-20: they shift whenever lines are added above, so follow
the links on the curator page rather than these numbers. The header comment
of the file describes every key; in short:

- Sources of a decision: `[TaxonWorks]` (what TaxonWorks states), `[manual]` (a
  hand-written line: the `manual` section, a checklist, a synonym, a part, the
  ignored name words, the coastal tolerance, an outline choice), `[overlap]`
  (the `overlap` section, or a point tested against the outlines). Manual
  lines win over overlap lines.
- `checklists`: checklists of their own that TaxonWorks files under another
  country (French Guiana, Guadeloupe, Martinique, Réunion, Mayotte, Northern
  Mariana Islands), and checklists the user decided to keep apart (Kosovo,
  ISO XK; Norfolk Island, ISO NF, TDWG 50NFK). Norfolk Island lists GA 33700
  (TDWG 50NFK) and GZ 10458 "Australia: Norfolk Island", a gazetteer that
  TaxonWorks gives the ISO code AU: the entry's `areas` are checked before a
  gazetteer's ISO code (step 2 before step 4 below), so its records land in
  Norfolk Island (R49). Its outline is the Natural Earth one
  (`outline: natural_earth`), because the TDWG outline of 50NFK also covers
  Lord Howe Island. TDWG 50NFK-LH (Lord Howe I.) has Norfolk Island as its
  TDWG parent, but Lord Howe Island belongs to New South Wales, so a manual
  rule keeps it in Australia (state Lord Howe Island comes from an overlap
  rule), and a point on Lord Howe lies in the Australia outline only.
  Keys: `name`, `iso2`, `of`, `areas` (`GA 78`, `GZ 10453`),
  `names` (words in a DwC country, province or place), `box` (west, south,
  east, north), `outline` (`natural_earth`: take the Natural Earth outline
  even when an area outline is cached), `why`.
- `state_countries`: the checklists browsed by state or province (United
  States, Canada, Australia, China, Russia; the United Kingdom was removed by
  R50, so its records follow TaxonWorks' hierarchy and get no state, e.g.
  GA 32348 Cornwall is United Kingdom, no state). Their state outlines and
  state names come from `subdivisions.geojson`. The engine has no list of its own.
- `coastal_tolerance_degrees` (0.05, about 5 km): a point outside every
  outline but this close to one counts for that outline (coasts are
  simplified). Steps that used it say "within about 5 km of the coast of"
  and cite the line.
- Validation: once the checklists are derived, `validateRules` (rules.js)
  stops the build with `placement.yml:N: unknown country "X"` (and the like)
  for a rule naming an unknown country, part or state, a state of a country
  not in `state_countries`, an unknown `parts` or `state_countries` name, or a
  synonym list whose first name is no checklist; `rest` must be true or false.
  A rule that matches no area in use is printed as a warning.
- `synonyms`: spellings of one country; the first name is the checklist name,
  e.g. `[Tanzania, United Republic of Tanzania]`. Anything looked up by
  checklist name tries every name of its synonym list too, such as the
  fallback outline (see "Map").
- `ignored_name_words`: words left out when a place name is compared with the
  state names of a checklist (oblast, krai, republic, of, ...), so "Krasnoyarsk
  Krai" finds Krasnoyarsk. Only for states, never for countries. The engine has
  no word list of its own; a state found only by leaving words out cites this
  line (see "States and provinces").
- `parts`: parts of a country that can be selected on their own, by country
  name (France: Corsica, Mainland France). Keys: `name`, `areas`, `names`,
  `box`, and `rest: true` on the part that takes every other record below
  country level.
- `manual` and `overlap`: one rule per area. `match` is one of `area`, `tdwg`,
  `gazetteer_prefix`, `iso2`; the action is exactly one of `subdivision_of`
  (`{ country, part?, state? }`), `synonymous_with` (an area key) or
  `not_placeable` (the reason). Manual rules carry `why`; overlap rules carry
  `measured: "Russia 100% (2026-11-20)"`, whose first percentage becomes `pct`.
- The `overlap` section is written by the measuring script
  (`npm run checklists:measure`, see "Measuring overlap"). Do not edit it by
  hand except to delete a line; to overrule a line, add a manual rule.

To add a rule: put it in the section where it belongs (a checklist, a synonym
list or a manual rule), keep exactly one action per rule, and run
`node --test modules/checklists/placement/rules.test.js`. A mistake stops the
compiler with `placement.yml:<line>: <message>`, for example an unknown key such
as `subdivison_of`.

## How a record is placed

`placement/engine.js` decides which checklist a record belongs to. It is pure
(no network, no file system), so the cache build and the curator page run the
same code. `createContext({ checklists, rules, geometry, shapes, unusable,
outlines, stateAreas })` builds the lookups once (`shapes` is the set of
cached outline keys such as `GeographicArea/32253`; `unusable` those of them
that hold no polygon, such as the Point gazetteer GZ 10497; `outlines` the
outline key standing for each checklist, `GeographicArea/<id>` or
`fallback/<name>`; `stateAreas` the areas of the cache placed in each
checklist with states, for specimens, see "States and provinces"). The build
computes these from the cached files and writes them to `context.json`, so
the curator page decides with exactly the same data. `placeArea(area, ctx)` places the area an asserted
distribution points to, without its state; `await placeRecord(record, ctx,
area?)` places a record (an asserted distribution with its area, a specimen or
a field occurrence) and finds its state. The answer is a `Placement`: the
checklist (or `null` and a `reason`), the part, the state, the outline to show
(`shape`, the checklist's or the part's outline, never the state's) and the
`steps` of the decision.

`geometry` answers the questions that need outlines; it is passed in, so the
engine itself stays pure (the build reads cached files, the browser fetches):
`checklistsAt([lng, lat])` gives `{ ids, near }`, the checklists whose
outline holds a point, else those within the coastal tolerance (`near`
true); `stateAt(checklistId, [lng, lat])` `{ name, near }` for the state
whose outline holds it, else the only one within the tolerance (or null);
`partAt(checklistId, [lng, lat])` `{ name, by }` for the part whose outline
(`by: 'outline'`), else whose `box` in the rules file (`by: 'box'`), holds it
(or null); and `stateNames(checklistId)` the state names of a checklist. Only
records with coordinates make `placeRecord` wait for it; `placeArea` never
calls it.

Every step is one short sentence with its source:

- `TaxonWorks`: what TaxonWorks says (the country of a political area, the
  parent of an area, the ISO code of a gazetteer). Fix it in TaxonWorks.
- `manual`: a hand-written line of the rules file (a checklist of its own, a
  synonym, a part, a manual rule), cited as `placement.yml:<line>`. Fix it there.
- `overlap`: a measured line of the overlap section, with its line and the
  measured share (`pct`). Overrule it with a manual rule.

Every check that runs prints a step, also when it finds nothing: `no manual
rule for New Guinea (GZ 3614)` [manual], `New Guinea (GZ 3614) has no ISO
code in TaxonWorks` [TaxonWorks], `no overlap rule for ...` [overlap]. So an
explanation shows each check of the order up to the one that decided; the
checks after it do not run and are not printed. The step that decides
(or gives the reason) still says everything on its own, as it is often shown
alone. Such a step carries
`none: true` and no line. Its tag says which kind of nothing it found:
`[manual, no rule]` when no line of `placement.yml` matched, `[overlap, never
measured]` when no overlap line exists for the area, `[overlap]` when a point
lay in no outline (`pointTest`), and `[TaxonWorks]` for a fact TaxonWorks does
not have (`New Guinea (GZ 3614) has no ISO code in TaxonWorks`). Where the step that decided is
wanted (`format.js` `decidingStep`, the `how` of the country files, the source
tags of the OTU table, the reasons of the area tree), these steps are skipped.

Decision order for an area; the first that applies decides:

1. A manual rule for the area. If an overlap rule matches the same area, the
   step says that the manual rule overrides that measurement.
2. A checklist of its own: the area or its parent is listed in the entry's
   `areas`, the area has the entry's ISO code, or a word of the entry's `names`
   is in the area's or its parent's name (accent insensitive, whole words).
3. The country TaxonWorks gives the area: its `level0_id`; without one, the
   area itself when TaxonWorks counts it as a country (GA 33412 United States
   of America, type Country), else a parent that belongs to a checklist
   (Texas, GA 26386, under GA 237 United States). A country area whose name
   differs from its checklist gets a second, manual step citing the synonym
   line (`United States of America is a spelling of United States`).
4. The ISO code of a gazetteer.
5. An overlap rule for the area.
6. Otherwise not placeable. Reasons: `spans several countries: <shares>` (from
   a `not_placeable` rule), `no checklist for <country or ISO code>`,
   `outside every checklist outline` (measured: no land in any outline),
   `not measured yet` (an outline is cached but no rule measured it yet),
   `no usable outline (no polygon)` (the cached outline is a point or a line,
   so there is nothing to measure), or `no outline` (none cached).

Then the part, for a checklist with parts (France): the part that lists the
area or its parent in `areas`, or whose `names` appear in the area's or its
parent's name; else the `rest` part (Mainland France) when the area lies below
country level; else none. A manual rule may name the part itself. Last, the
outline: the first cached area of the part, else the checklist's outline
(its first cached area, else its Natural Earth fallback outline, `shape`
`fallback/<name>`; an entry with `outline: natural_earth` takes the fallback
first and a step cites that line). When there is none the record is still
placed and a last step says `no outline cached for <checklist>`.

Two worked examples (as the curator page shows them):

```
GA 8837 Cayenne  =>  French Guiana
  no manual rule for Cayenne (GA 8837)                         [manual]
  Cayenne is a subdivision of French Guiana (GA 78)            [TaxonWorks]
  French Guiana (GA 78) belongs to the checklist French Guiana [manual, placement.yml:69]
  outline: GeographicArea/32253

GZ 3614 New Guinea  =>  not placeable
  reason: spans several countries: Papua New Guinea 51%, Indonesia 49%
  no manual rule for New Guinea (GZ 3614)                                                   [manual]
  New Guinea (GZ 3614) matches no checklist of its own (by area, parent, ISO code or name)  [manual]
  New Guinea (GZ 3614) is a gazetteer, which has no country in TaxonWorks                   [TaxonWorks]
  New Guinea (GZ 3614) has no ISO code in TaxonWorks                                        [TaxonWorks]
  New Guinea spans several countries: Papua New Guinea 51%, Indonesia 49%                   [overlap, placement.yml:704]
```

Cayenne has no country in TaxonWorks, but its parent GA 78 is listed in the
French Guiana entry of the rules file, so step 2 decides before the country
step. New Guinea is a gazetteer with no country and no ISO code; the
measuring script found it in two countries and wrote a `not_placeable` overlap
line, whose shares become the reason.

### Reading an explanation

`placement/format.js` turns one decision into plain text. The build prints it
with `--verbose` and `--explain`, and the curator page shows the same text.
`formatPlacement(subject, placement)` takes the subject (`kind`, `id`, `label`
and optionally the `area` behind it) and the `Placement`. Example:

```
AD 556796  Phaedropus candidus (Fabricius, 1775)
  area      GA 8837 Cayenne (GA)
  step      no manual rule for Cayenne (GA 8837)                          [manual]
  step      Cayenne is a subdivision of French Guiana (GA 78)             [TaxonWorks]
  step      French Guiana (GA 78) belongs to the checklist French Guiana  [manual, placement.yml:69]
  result    French Guiana checklist
  drawn as  French Guiana outline (GeographicArea/32253)
```

The first line is the kind, the id and the label. `area` appears only when an
area is given. Each `step` is one sentence of the decision, in order, followed
by its source tag in an aligned column. `result` names the checklist, with
`, part <P>` and `, state <S>` when set, or says `not placeable:` and the
reason. `drawn as` is about the outline the record is drawn with on the
checklist map, not about the area's own shape: `<Name> outline (GeographicArea/32253)`
for a cached TaxonWorks area (Name is the checklist, or the part when a part
outline is used), `<Name> outline (Natural Earth)` for the fallback outline,
`nothing (no outline for <Name>)` when it was placed but has no outline, and
`nothing (not placed in a checklist)` when it was not placed (the `result` line
gives the reason).

Source tags:

- `[TaxonWorks]`: a fact from TaxonWorks data (parent area, ISO code).
- `[manual, placement.yml:N]`: a hand-written rule, with its line in the rules file.
- `[overlap 72% Russia, placement.yml:N]`: a measured overlap rule; the share
  and the country (or state) it refers to.
- `[overlap, placement.yml:N]`: an overlap rule without a share.
- `[overlap]`: a live coordinate step (a point tested against the cached outlines), no rule line;
  also a point that lay in no outline (a check that found nothing).
- `[manual, no rule]`: a check of the rules file that found no line (`no manual rule for …`).
- `[overlap, never measured]`: no overlap line exists for the area (`no overlap rule for …`).
- `[overlap, placement.yml:N]` on a coordinate step: the point lay outside
  every outline but within the coastal tolerance; N is the line of
  `coastal_tolerance_degrees`.

The lookup box takes a kind and an id: `GA`, `GZ`, `AD`, `CO` or `FO`, in any
case, with any number of spaces or none (`ad 556796`, `AD556796`, `GZ  10453`).
`parseLookup(text)` returns `{ kind, id }`; a bare number or any other kind
gives `null`.

### Specimens and field occurrences

A specimen or field occurrence is placed by its DwC fields (`RecordInput`:
`country`, `stateProvince`, `county`, `locality`, `lat`, `lng`, and
`footprint`, the DwC `footprintWKT`), and a collection object without
coordinates also by its collecting event's area (`eventArea`).

First, the point the outlines are tested with: the coordinates, else a point
inside the georeference shape (a georeference drawn with TaxonWorks' shape
tool gives `footprintWKT` but no latitude and longitude; `placement/footprint.js`
takes the centre of its largest polygon, or the middle of a horizontal cut
through it when the centre lies outside, rounded to 4 decimals; no point for a
shape across the 180th meridian). The first step then says so:

```
CO 2707818  the georeference is a shape; the point 36.8236, 78.254 inside it is used  [TaxonWorks]
```

Without a point, the collecting event's area decides, exactly as for an
asserted distribution on that area (country, part and state, with the same
steps), when a distribution uses that area (so its levels and parent are
known). A reason from TaxonWorks data or a rule (`spans several countries`)
stands, as for the distribution; only an area that cannot be placed by its
outline yet (`no outline`, `no usable outline (no polygon)`, `not measured
yet`) hands over to the DwC fields, after its steps. An area no distribution
uses is named by its key and the DwC fields decide. Field occurrences have no
collecting event area in the API.

```
CO 2874936  no coordinates and no georeference shape                     [TaxonWorks]
            the collecting event's area is Sulawesi (TDWG 42SUL-OO)      [TaxonWorks]
            ... the steps of the area, as for a distribution on it
CO 1380033  no coordinates and no georeference shape                     [TaxonWorks]
            the collecting event has no area                             [TaxonWorks]
            ... the DwC fields, below
```

With a point, the collecting event area is not used: TaxonWorks derived the
DwC fields from the georeference, which is more precise. Then the DwC fields,
the first that applies decides:

1. A checklist of its own: a word of the entry's `names` is in the DwC
   `country`, or in the `stateProvince` or `county` when the DwC country is
   empty or is the country the entry is filed under (`of`, France); whole
   words, accent insensitive. A specimen with country France and
   stateProvince French Guiana lands in French Guiana; one with country
   United States and a county named like Martinique stays in the United
   States. One `[manual]` step cites the entry.
2. The DwC country. TaxonWorks computes it from the georeference (on full
   outlines) or from the collecting event's area; in the test run of
   2026-11-20 it equalled the collecting event's country in 20,329 of 20,329
   specimens, so it is trusted. It is compared with checklist names and the
   `synonyms` lines only, never with state names. A spelling that is not the
   checklist name gets a second, `[manual]` step citing the synonym line. A
   country without a checklist is not placeable: `no checklist for Atlantis`
   (and so for any other country text without a checklist), even when coordinates exist.
3. No DwC country, but coordinates: `geometry.checklistsAt`. One checklist
   holds the point: placed, step `coordinates <lat>, <lng> lie inside
   <name>` `[overlap]` (measured live, no line, no share). None holds it but
   one lies within the coastal tolerance (`coastal_tolerance_degrees`, 0.05
   degrees): placed, step `coordinates <lat>, <lng> lie within about 5 km of
   the coast of <name>` `[overlap, placement.yml:N]` citing that line (CO
   1383195 on the Crimean coast). Several: `coordinates in several countries
   (Russia, Ukraine)`, names sorted. None: `coordinates outside every
   outline`. This fallback is for the few records
   (252 in the test run) where TaxonWorks gives coordinates but no country;
   our outlines are simplified, so they never overrule a DwC country.
4. Otherwise not placeable: `locality text only` when the record has locality
   text, else `no locality at all`.

Then the part (France), as the old build did: a part name in `stateProvince`
or `county` (Corse goes to Corsica) `[manual]`; else the part whose outline, or
`box`, holds the coordinates (`geometry.partAt`, step `coordinates <lat>,
<lng> lie inside Corsica` `[overlap]`, or `lie inside the rough box of the part
Mainland France` `[manual]` citing the part); else the `rest` part (Mainland France)
when the record has a stateProvince or coordinates, as it then lies below
country level; else no part.

### States and provinces

Only checklists with `states` (the rules file's `state_countries`: United
States, Canada, Australia, China, Russia) get a state; any other has none and
no state step (the United Kingdom since R50).
State names are matched with `placement/states.js` (`matchSubdivision`) and
only against the states of the chosen checklist: first the state's own name
`[TaxonWorks]`; then that name with the rules file's `ignored_name_words`
left out (`DwC stateProvince "Krasnoyarsk Krai" matches the state
Krasnoyarsk (ignoring "krai")`, `[manual]` with the line of that list). Other
names of a state (the Natural Earth `aliases` of `subdivisions.geojson`,
Moskva for Moscow) decide nothing (R51). Country names never meet
state names: the US state Georgia stays a state of the United States, and a
specimen with DwC country Georgia and stateProvince Georgia lands in the
country Georgia, which has no states.

For an asserted distribution, the first that applies:

1. A manual rule for the area gives `subdivision_of: { country, state }`
   (`[manual]`, with its line). Manual rules win over names, as they do for
   countries: GA 20379 Chukot is Chukotka, whatever its outline says.
2. The area's own name is a state of the checklist, but only when the area is
   a state itself: TaxonWorks' state test (`GeographicArea#categorize`,
   `isStateArea` in `placement/areas.js`): a state-level type (State,
   Province, Oblast, ...), Natural Earth origin `ne_states`, its own level1
   area, or its parent is a country (the gadm US states such as Texas, GA
   26386). TDWG areas and gazetteers carry no levels and are always tried by
   name. So a county named like a state never becomes that state.
3. Its parent's name, when the parent is the area's state (its level1 area, or
   level1 unknown): a county takes the state it lies in. `Colorado is a
   subdivision of Texas (GA 26386), the state Texas`, not the state Colorado.
   An area below a county gets no state from the county's name.
4. An overlap rule for the area gives `subdivision_of: { country, state }`
   (`[overlap]`, with its line and share). This covers what names cannot:
   Hawaiian gazetteers (state Hawaii), IBRA bioregions (Australian states),
   renamed units (Evenk to Krasnoyarsk, TDWG Yakutskiya to Sakha) and areas
   whose TaxonWorks name is not the state name (GA 20330 Primor'ye to
   Primorsky Krai, GA 32013 Inner Mongol to Inner Mongolia). The measuring
   script writes these lines.
5. No state, with a last step `no state: <reason>`: `record is for the whole
   country` (the area is one of the checklist's country areas), `spans several
   states: <shares>` (from an overlap or manual line `not_placeable: spans
   several states`; such a line only speaks about the state and never decides
   the country), `outside every state outline` (an overlap line written when
   no part of the outline lies in a state outline, GZ 10454 Hawai'i: Lana'i;
   it too never decides the country), `no usable outline (no polygon)`, `no
   outline to measure` (none cached), or `not measured yet`.

For a specimen or field occurrence, the first that applies:

1. The DwC `stateProvince` (TaxonWorks' first-level area name) is a state of
   the checklist `[TaxonWorks]` (or after leaving out ignored words, as above).
2. It is the name of exactly one TaxonWorks area of the same checklist in the
   cache (`context.json` `stateAreas`, exact after normalizing; a name two
   areas share is ignored): that area's own state decision gives the state,
   with one step naming both and carrying that decision's source, e.g. `DwC
   stateProvince Primor'ye is TaxonWorks area GA 20330, which lies in the
   state Primorsky Krai` `[overlap 100% Primorsky Krai, placement.yml:N]`.
3. The state outline holding its coordinates (`geometry.stateAt`, `[overlap]`),
   else the only one within the coastal tolerance (`within about 5 km of the
   coast of the state X`, citing the tolerance line).
4. No state, with the reason (`no state: Atlantis is not a state of United
   States`, `no state: no DwC stateProvince and no coordinates`, or that the
   coordinates lie in no state outline).

Three more worked examples:

```
CollectionObject, DwC country "United Republic of Tanzania"  =>  Tanzania
  DwC country is United Republic of Tanzania                     [TaxonWorks]
  United Republic of Tanzania is a spelling of Tanzania          [manual, placement.yml:137]

GZ 10453 Hawai'i: Kaua'i (ISO US)  =>  United States, state Hawaii
  Hawai'i: Kaua'i has ISO code US, United States                 [TaxonWorks]
  Hawai'i: Kaua'i (GZ 10453) lies in the state Hawaii            [overlap 100% Hawaii, placement.yml:578]

GA 33876 Central European Russia (TDWG 14RUC)  =>  Russia, no state
  Central European Russia (TDWG 14RUC) lies in Russia            [overlap 100% Russia, placement.yml:201]
  no state: spans several states: Tver' 10%, Nizhegorod 9%, ...  [overlap, placement.yml:521]
```

The two overlap lines behind these examples, as the measuring script wrote them:

```yaml
  - match: { area: "GZ 10453" }   # GZ 10453 Hawai'i: Kaua'i, 12 records
    subdivision_of: { country: "United States", state: "Hawaii" }
    measured: "Hawaii 100% (2026-11-20)"

  - match: { tdwg: 14RUC }   # GA 33876 Central European Russia (TDWG Level 3 14RUC), 124 records
    not_placeable: spans several states
    measured: "Tver' 10%, Nizhegorod 9%, Kostroma 8%, Smolensk 7% (2026-11-20)"
```

The Tanzania specimen has a DwC country that is not a checklist name, but
the synonym line names it, so the second step cites that line. The Hawaiian
gazetteer finds its country by its ISO code, and its name is no state name, so
the state comes from the overlap line the measuring script wrote for it.
Central European Russia gets its country from one overlap line (Russia
100%); a second line, `not_placeable: spans several states`, tells why it has
no state: no state holds even a fifth of it. The line numbers above are
examples of 2026-11-20; they shift when lines are added above (the curator
page links every one to the current line).

## Measuring overlap

`npm run checklists:measure` (`scripts/measure-overlap.mjs`) writes the
`overlap` section of the rules file. It measures, on the cached outlines, how
the outline of an area is shared among other outlines, and appends one rule
per area. The build never measures; it only reads the rules.

When to run it: after a build reports areas as `not measured yet` or
`no state: not measured yet` (new TDWG
areas or gazetteers without ISO code in TaxonWorks, or new areas in a country
with states whose name is no state name), and after the cached outlines
changed a lot. It reads the TaxonWorks data the build saved
(`--from <dir>`, default `modules/checklists/.cache/data`:
`distributions.json`, and `dwc_occurrences.csv` for the names of countries
used only through their subdivisions). A run over all 2,458 areas in use
takes about 10 seconds.

What it measures (only areas some distribution uses and no rule decides yet;
the placement engine says which):

- The country of an area the engine leaves `not measured yet`: TDWG areas and
  gazetteers without ISO code that no rule, own checklist or TaxonWorks
  country places. It is measured against every checklist outline (the first
  cached area of the checklist, else its Natural Earth outline in
  `public/checklists/fallback-shapes.geojson`).
- The state of an area placed in a checklist with states, when neither its
  name nor its parent's name is a state name and it is not the whole country
  (the engine's step `no state: not measured yet`). Gazetteers with an ISO
  code count too (Hawaiian islands, IBRA bioregions in Australia). It is
  measured against the state outlines of that checklist
  (`public/checklists/subdivisions.geojson`).

How: `scripts/geometry-node.mjs` (`measureShares`) lays a grid of 24 by 24
points over the area's bounding box and keeps the points inside the area; with
fewer than 30 inside, a grid of 80 by 80; with none inside (tiny islands), the
area's vertices, where a point within the coastal tolerance of the rules file
(`coastal_tolerance_degrees`, 0.05 degrees, about 5 km) off a simplified
coast counts for the nearest outline. Outlines are read as Polygon,
MultiPolygon or GeometryCollection (its polygons; GZ 3614 New Guinea is a
polygon and a line). Each point is tested against
the outlines whose bounding box holds it. Points in no outline (sea, or land
without outline) do not count, so the shares are shares of land. A point in an
own checklist and in the country it is filed under (Réunion and France, whose
outline still contains Réunion) counts for the own checklist only.

The 90% rule: when one country holds 90% or more of the land points, the rule
says `subdivision_of: { country }`, else `not_placeable: spans several
countries`. For states: `subdivision_of: { country, state }`, else
`not_placeable: spans several states`, which only explains the missing state
and never decides the country. Every rule carries `measured:` with the top
four shares, rounded, and the local date, and a comment with the area, its
TDWG code and how many distributions use it. TDWG areas are matched by their
TDWG code, all others by their area key. Rules are appended at the end of the
`overlap` section; no other line changes, so line references stay valid.
An area with no land point in any outline gets a rule that says so:
`not_placeable: outside every checklist outline` for the country, or
`not_placeable: outside every state outline` for the state (which never
decides the country), with `measured: "no sample in any outline (date)"`.
Areas without a cached outline, or whose outline holds no polygon (a Point
gazetteer), get no rule and are listed at the end of the run; the engine
gives them `no outline` or `no usable outline (no polygon)` by itself.
`--dry-run` prints the rules instead of writing them.

`--recheck` re-measures every existing overlap rule and lists those whose top
share moved by more than 5 points (for example after the cached outlines
changed); it never edits the file. To refresh such a rule, delete it and run
the script again.

Curators: a measured line can be deleted (the next run measures the area
again) but should not be edited, because the next recheck would report it.
To overrule a measurement, add a manual rule for the same area in the `manual`
section, with `why`; manual rules win, and the explanation then says that the
manual rule overrides the measurement and cites both lines.

## Building the cache

Commands (from the project folder):

```
npm run checklists                                   # download (about 3 minutes) and build
npm run checklists -- --save                         # the same, and keep the download in modules/checklists/.cache/data
npm run checklists -- --save /some/dir               # keep it elsewhere
npm run checklists -- --from                         # build offline from modules/checklists/.cache/data (about 15 seconds)
npm run checklists -- --from --verbose               # also print every record's decision
npm run checklists -- --from --explain "AD 556796"   # print one decision and stop
```

Flags:

- `--save [dir]`: after downloading, write the TaxonWorks data to `dir`
  (default `modules/checklists/.cache/data`).
- `--from [dir]`: read the TaxonWorks data from `dir` instead of downloading;
  nothing touches the network. Use it to try a rule change in seconds.
- `--verbose`: print every record's decision in the text form of
  `placement/format.js` (see "Reading an explanation").
- `--explain <lookup>`: print the decision for one record or area and stop
  without writing anything. Any form the curator lookup box reads works:
  `AD 556796`, `co 12`, `FO7`, `GA 8837`, `GZ 10453`.

The saved folder (`scripts/download.mjs`, `FILES`), one file per download:

- `dwc_occurrences.csv`: every DwC occurrence, as TaxonWorks exports it.
- `distributions.json`: every asserted distribution with
  `asserted_distribution_shape` and its citations, as the API returns them.
- `status_tags.json`: tags with the keywords Adventive and Endemic.
- `reassessments.json`, `reassessment_citations.json`: the Reassessment data
  attributes of distributions and their citations with source.
- `associations.json`: the biological associations distributions are asserted for.
- `type_names.json`: `{ [name and authorship]: { taxonName, valid, otuId } |
  { error } }`, the type status names of undetermined type specimens resolved
  by `placement/typeStatus.js` `resolveTypeName` (663 names, about 45 s); their
  OTUs are added to the `otu_parents.json` lookups.
- `association_otus.json`: OTU and taxon name of association OTUs without a
  DwC row; `otu_parents.json`: the parents of OTUs the DwC export leaves
  without classification. A stale or hidden OTU is kept as `{ error }`.
- `specimen_areas.json`: `{ [collectionObjectId]: geographicAreaId }`, the
  area of each specimen's collecting event, for the specimens whose
  collecting event has one: `GET /collecting_events`, every page (ordered by
  id, counted against `pagination-total`), then `GET /collection_objects` with
  `collecting_event_id[]` for those with an area, 50 per request, each batch
  counted (about 15 s; 15,731 collecting events, 293 with an area, 332
  specimens on 2026-11-22). The DwC export has no collecting event id. A
  folder saved before this file existed is refused, with a message saying so.

`measure-overlap.mjs` reads the same folder.

What the build writes to `public/checklists/`:

- `index.json`: `updated` (local build date), `countries` (one entry per
  checklist with records: `key`, `file`, `name`, `iso2`, `of` for own
  checklists filed under another country, `shape` (the cached outline, or
  null when the page draws the Natural Earth fallback), `fallback` (only then:
  the name of that feature in `fallback-shapes.geojson`, possibly a synonym of
  the checklist name), `bbox` of that outline
  `[west, south, east, north]`, `parts` (France: name and outline of each
  part, the first cached GA area the part lists in the rules file; Mainland
  France is GA 34185, TDWG 12FRA-FR, whose outline leaves out the Channel
  Islands that TDWG 12FRA includes; the build warns about a part without
  cached outline, as the page skips it),
  `states` (true for the five countries browsed by state), `taxa` and
  `records`), and `unplaced` (records and taxa left out).
- `countries/<key>.json`: one checklist, a `checklist` header and then its
  records in the compact form of `data/compact.js`. Records carry `part` and
  `state` when the engine finds one.
- `taxa.json`: per higher taxon its number of taxa in each checklist, keyed by
  the checklist key; the page loads it for the taxon filter.
- `rules.json`: the compiled rules file (`compileRules`), for the browser.
- `context.json`: what the placement engine needs besides `rules.json`, for
  the curator page: `built` (the build date), `checklists` (the engine's
  checklists as `deriveChecklists` made them, numeric ids and `areaIds`
  included), `outlines` (per checklist with an outline: `id`, `outline`,
  `GeographicArea/<id>` or `fallback/<feature name>`, and its `bbox`) and
  `shapes` (every cached outline id the build saw, `{ GeographicArea: [...],
  Gazetteer: [...] }`). See "Curator page".
- `areas.json`: every area some distribution uses, `{ key, name, origin, type,
  tdwg, iso2, parentId, parentName, records, placement }`, where `records`
  counts the build's records on the area (Curculionoidea, species, present;
  placed or not) and `placement` is the engine's answer with the checklist
  given by key and name. Parents known only as parents follow with
  `records: 0` and `placement: null`.
- `unplaced.json`: the records no rule places, `{ [reason]: [[kind, id], ...] }`
  with kind `AD`, `CO` or `FO`, the most frequent reason first.
  `classification lookup failed` lists records whose OTU could not be
  classified (not counted as left out).
- `fallback-shapes.geojson` and `subdivisions.geojson` are read, never written.
- Country files of checklists that no longer exist are removed.

Checklist keys: every checklist is known by its key, the slug of its name
(`normalizeName`, spaces as hyphens, ASCII only): `french-guiana`,
`reunion`, `united-states`. The country file is `countries/<key>.json`. No
numeric id appears in `public/checklists/` except in `context.json` (the
engine's own checklists, for the curator page). When two checklists would get the
same key the build stops with an error naming both.

The country file header says what the checklist is made of and how its
records got there:

- `defined_by`: the TaxonWorks areas the checklist is made of, each with why:
  a country area `[TaxonWorks]`, a country area that is a spelling of the
  checklist name (the synonym line, `[manual, placement.yml:N]`), a country
  used only through its subdivisions (named by their DwC country), or an area
  listed in an own checklist entry of the rules file.
- `areas_used`: every area some record of the file points to, with its kind
  (TaxonWorks area type, or Gazetteer), its number of records and the first
  step of its decision with the source tag.
- `specimens`: the number of specimens and field occurrences in the file, and
  how many were placed which way.
- `outline` (`GeographicArea/<id>`, `fallback/<name>` or null), `built`, and
  `rules`, the rules file the decisions cite.

The record counts of `areas_used` plus `specimens.records` equal the number of
records in the file (tested in `data/compact.test.js`). `expandChecklist`
ignores the header. Example (French Guiana, 2026-11-20):

```json
"checklist": {
  "key": "french-guiana",
  "name": "French Guiana",
  "iso2": "GF",
  "outline": "GeographicArea/32253",
  "defined_by": [
    { "area": "GA 32253", "name": "French Guiana", "how": "listed in the checklist entry [manual, placement.yml:69]" },
    { "area": "GA 78", "name": "French Guiana", "how": "listed in the checklist entry [manual, placement.yml:69]" },
    { "area": "GA 34200", "name": "French Guiana", "how": "listed in the checklist entry [manual, placement.yml:69]" }
  ],
  "areas_used": [
    { "area": "GA 32253", "name": "French Guiana", "kind": "Unknown", "records": 31,
      "how": "GA 32253 French Guiana belongs to the checklist French Guiana [manual, placement.yml:69]" },
    { "area": "GA 8837", "name": "Cayenne", "kind": "Unknown", "records": 2,
      "how": "Cayenne is a subdivision of French Guiana (GA 78) [TaxonWorks]" }
  ],
  "specimens": { "records": 0, "how": "none" },
  "built": "2026-11-20",
  "rules": "modules/checklists/rules/placement.yml"
}
```

(Two of its four `areas_used` rows shown.) For a country with specimens,
`specimens` reads for example `{ "records": 325, "how": "by DwC country 325
[TaxonWorks]" }`.

The build ends with a summary: placed records by kind and by the source that
decided the checklist, unplaced records by reason, the number of checklists,
warnings from `deriveChecklists`, checklists without ISO code, and checklists
without any outline.

## Comparing two caches

Every visible change to the checklists needs the curator's approval before a
new cache is committed. `compare.mjs` compares a new cache with an earlier one
record by record and writes a report to read before approving. From the
project folder (the folder with `package.json`):

```
mkdir -p modules/checklists/.cache/old
git archive HEAD public/checklists | tar -x --strip-components=2 -C modules/checklists/.cache/old
npm run checklists -- --from                          # build the new cache from the saved data
node modules/checklists/scripts/compare.mjs modules/checklists/.cache/old public/checklists
```

Arguments: the old cache (default `modules/checklists/.cache/old`), the new
cache (default `public/checklists`), `--from <dir>`, the saved TaxonWorks
data the new cache was built from (default `modules/checklists/.cache/data`),
and `--out <file>` for the report (default
`modules/checklists/.cache/compare.md`). A folder is read relative to the
working directory, else to `modules/checklists/`. The new cache must come
from that data and the current rules file, because the explanations are made
again from them. Either cache may be in the old build's format (country files
`<id>.json`, no stored states) or the engine's (`file` in index.json, `state`
on records): `compareCaches.mjs` `cacheEntries` reads both, using
`record.state` when it is stored. Changes of the explanation text alone never
count; only checklist, part and state.

It writes `modules/checklists/.cache/compare.md` and `compare-full.md` beside
it (`<out>-full.md` with `--out`; not committed). The report gives the counts (same checklist, moved, newly placed,
no longer placed, gone from TaxonWorks, part changed, state changed), then the
moves by "from checklist to checklist", the newly placed records by the step
that decided their checklist, the records no longer placed by reason, the part
and state changes, records that are in several checklists, and the checklists
renamed, added or removed. Each changed record comes with its placement text
(the same as `--explain`), at most 20 per group in `compare.md`; every record
and every file rename is in `compare-full.md`.

How it works:

- A record is "<dwc_occurrence_object_type>:<id>". Distributions asserted for
  a biological association have one record per beetle side; these are paired
  by OTU.
- An old checklist counts as the same checklist under its new name when the new
  one has the same id, shares an area, or has the same name without accents,
  so a renamed checklist is not a move.
- The explanations use the build's own code: `buildContext.mjs` creates the
  engine context from the saved data exactly as the build does.
- The old build's cache stored no states; its page worked them out while
  showing a country. For such a cache `compareCaches.mjs` (`oldState`)
  reproduces that: for the United States, Canada, Australia, China, Russia
  and the United Kingdom (the six state countries of that time), the
  record's stateProvince, then the place name of its distribution, then its
  county, matched against the old `subdivisions.geojson` with its aliases
  and the old page's word list (`OLD_IGNORED_WORDS`, kept fixed there so the
  reproduction does not follow later edits of `ignored_name_words`).
- TaxonWorks edits are told apart from rule changes by dates: a record created
  in TaxonWorks after the old download day (`updated` in the old index.json)
  is "new in TaxonWorks", one updated after it "edited in TaxonWorks"; a
  record of the old cache that is nowhere in the new data is "gone from
  TaxonWorks".
- Two groups are named after the ruling that causes them: a checklist no
  longer browsed by state (R50, the United Kingdom) lists all its dropped
  states as one group, and states that were decided by a Natural Earth name
  in the old engine cache (R51: a `Natural Earth` step in its `areas.json`,
  or a specimen whose stateProvince matched only an alias) are grouped
  separately for asserted distributions and for specimens.
- Questions for the curator that the report should carry go into
  `modules/checklists/.cache/compare-questions.md`; its text is added at the
  end of `compare.md` when the old cache is the old build's.

## Curator page

`/checklists/curator` (in hash mode `/#/checklists/curator`) is for curators:
open it with `?curator=1` (curator mode, see
`panels/_shared/curatorMode/readme.md`), or follow the red button "How
records are placed (curator)" right of the "Distribution data is generally
incomplete" note on the checklists page (shown in curator mode only, in the
red of "Leave curator mode"). Without curator mode it shows only
"Open this page with ?curator=1". It is for finding problems and fixing them
in TaxonWorks or in the rules file.

Five tabs; the active one is in the address (`?tab=otu`, `areas`,
`unplaced`, `rules`; none for the lookup), so every view can be linked:

| Tab | Address | Shows | Based on |
|---|---|---|---|
| Record or area | `?lookup=AD%20556796` | one record or area: its explanation, the cache line, links, a map | live from TaxonWorks |
| OTU | `?tab=otu&otu=731160` | every record of one OTU, placed | live from TaxonWorks |
| Area tree | `?tab=areas` | every area of `areas.json` and its decision | the cache |
| Not placed | `?tab=unplaced` | `unplaced.json` by reason | the cache |
| Rules | `?tab=rules#L120` | the decision order, every rule of `rules.json`, and `placement.yml` with line numbers | the cache |

Each tab starts with one line saying which: "Live from TaxonWorks, placed
with the rules and data of the build of 2026-11-20." (lookup and OTU: the
records come from TaxonWorks now, the engine context from the cache files of
that build) or "As built on 2026-11-20." (tree, not placed, rules: the cache
files as they are). The date is `updated` of `index.json`.

Clicking a row in the OTU table, an area name in the tree or a row of the
unplaced lists opens the lookup tab with that record (`?lookup=AD 287565`,
`?lookup=GA 32253`), where its full explanation and map are. Links on a row
(the record's edit page, the area's page in TaxonWorks) open TaxonWorks
instead. Every `placement.yml:N` on the page (in an explanation, a source
tag, the tree, the rules list) links to that line on the Rules tab
(`components/RefText.vue`): the link is the route `?tab=rules` with the
route hash `#L<N>` (in hash mode `/#/checklists/curator?curator=1&tab=rules#L120`;
the router keeps the second `#` as the route's hash, and the framework's
scrollBehavior scrolls to the line). A query-only link was scrolled back to
the top by that scrollBehavior, which is why the first version's links did
nothing when clicked on the Rules tab. A click on such a link inside a table
row does not also open the row's lookup.

When a live result differs from the cache (another checklist, part or state,
or the cache does not list a record the live placement places, or lists one
it does not place; `overview.js` `differsFromCache`), the lookup says
"Differs from the cache (built 2026-11-20): rebuild the checklists to
update." and the OTU table marks the row "differs" and counts such rows
under the summary. Records the build leaves out of every checklist (absent,
rank above species, outside Curculionoidea) never differ.

### OTU

An OTU search (the site's OTU name autocomplete, the `Autocomplete` global
component with the same settings as `AutocompleteOtu`), then the OTU's own
records only: no synonyms, no subordinate taxa. The page loads:

- `GET /otus/:id?extend[]=parents` and `GET /taxon_names/:id`: the name, and
  whether the build counts the OTU's distributions (`live.js` `otuLeftOut`:
  species or subspecies, below Curculionoidea, as the DwC rank and
  superfamily of its distributions say).
- Asserted distributions: `GET /asserted_distributions`, `otu_id[]=<id>`,
  `extend[]=asserted_distribution_shape`, `per=500`, page by page with a
  progress line (`fetchOtuDistributions`).
- Specimens and field occurrences, from the DwC index, as the build reads them
  (`fetchOtuSpecimens`): `GET /dwc_occurrences` with `taxon_name_id[]=<the OTU's
  taxon name>` and `dwc_occurrence_object_type=CollectionObject` (then
  `FieldOccurrence`), `per=500`; when there is more than one page,
  `GET /dwc_occurrences.csv` with the same filter instead (the paged list has
  no fixed order and can repeat and miss rows). `otu_id[]` returns nothing on
  `/dwc_occurrences`, and a taxon name includes its subordinate taxa, so only
  rows whose `otu_id` is this OTU are kept. Not loaded for an OTU without
  taxon name, nor for an OTU the build leaves out (above species: the DwC
  index of a family is the whole family; outside Curculionoidea, such as a
  host plant); a line says why.
- The collecting event areas of the OTU's collection objects without
  coordinates or georeference shape (`attachEventAreas`): `GET
  /collection_objects?collection_object_id[]=…` and `GET
  /collecting_events?collecting_event_id[]=…` (100 per request), then each area
  through `GET /asserted_distributions?geo_shape_id[]=…` as for a GA lookup.

A record counts as left out (`live.js` `recordLeftOut`) for its own DwC
reason, as absent, or for its OTU's reason: a specimen whose DwC row has no
superfamily takes the OTU's parents, as the build does. The lookup tab asks
TaxonWorks for the OTU in the same way when the cache does not list a record.

Every record is placed with `placeLive` in the engine context of the cache
files, as in the lookup, so the result equals the build's. The summary
counts records by kind and result, e.g. `85 records (62 AD, 23 CO): 83 placed
in 34 checklists, 2 not placed (1 locality text only, 1 spans several
countries)` (`overview.js` `summarizeOtu`; not placed counted by the kind of
reason). The table: the record (`AD 287565`, a link to its edit page, with a
copy button that copies `AD 287565` to the clipboard and says "Copied", or
selects the text when the clipboard is not available), its place (the area
with its key, linked to TaxonWorks; for a specimen its DwC country, state,
county and locality and coordinates), the checklist with part and state, or
the reason in red, every source that contributed to the placement (country,
part, state, outline; `overview.js` `sourceTags`, e.g. `[TaxonWorks]
[overlap 100% Primorsky Krai, placement.yml:N]`, each line a link), and
"differs". Rows not
placed come first. An absent distribution, or a record the build leaves out,
reads e.g. "absent (not in checklists)", "rank family (not in checklists)".

### Area tree

`areas.json` as a tree (`overview.js` `buildAreaTree`): three roots,
Political, TDWG and Gazetteers. Gazetteers are the GZ areas, TDWG the areas
whose TaxonWorks `data_origin` starts with `tdwg`, Political the rest. Where
an area sits is compiled by the build from TaxonWorks data in the cache and
written to `areas.json` as `ancestors` (`cacheFiles.mjs` `areaPositions`,
R44); the tree only shows it. Political areas sit under their `level0_id`,
`level1_id` and `level2_id` areas, then their parent ("Earth" left out): GA
26688 Alabama, used by no record, is known from its counties (level0 GA 237,
level1 GA 26688) and sits under GA 237 United States. TDWG areas sit under
their TDWG code's levels (L4 under L3 under L2 under L1, `12FRA-FR` under
`12FRA` under `12` under `1`) where that level is in the cache, as a used
area or as the parent of one; otherwise at the top of the TDWG root.
Gazetteers carry no levels and are grouped by their ISO code (`ISO AU`, `No
ISO code`). An area known only as an ancestor (a stub, `records: 0`, no
placement) appears muted with "used by no record" in every root that has one
of its descendants.

The tab starts with one line: "Each area: how many records point to it, the
checklist it lands in, and why. Indentation shows the TaxonWorks hierarchy."
Each area line (R54) reads `name (GA 237)` (a TaxonWorks link) · `n records`
· one segment per decision, each with its own reason (`overview.js`
`plainReasons`, read from the step that decided it: the engine marks every
step with its `stage`, `checklist`, `part`, `state` or `outline`). A state or
part is a list inside the country checklist (`→ Corsica list`), never a checklist. For example:

```
Primor'ye (GA 20330) · 60 records · → Russia checklist · because: GA hierarchy in TaxonWorks (GA 19713) · → Primorsky Krai list · because: measured 100% in Primorsky Krai (placement.yml:539)
Corse (GA 32254) · 12 records · → France checklist · because: GA hierarchy in TaxonWorks (GA 77) · → Corsica list · because: manual entry (placement.yml:172)
Clay (GA 30081) · 3 records · → United States checklist · because: GA hierarchy in TaxonWorks (GA 237) · → Alabama list · because: GA hierarchy in TaxonWorks (GA 26688)
```

The checklist reasons are "country area in TaxonWorks", "GA hierarchy in
TaxonWorks (GA 77)", "spelling synonym", "own checklist entry", "gazetteer ISO
code NZ", "measured 100% in Russia" and "manual rule". The part's are "manual
entry", "rest of the country", "manual rule" (the rule that placed the area
also names the part) and the measured ones. The state's are "the area is this
state in TaxonWorks", "GA hierarchy in TaxonWorks (GA 26688)" (through the
parent), "measured 100% in Primorsky Krai", "manual rule" and "name matches
after ignoring words". Each carries its rules line as a link when it has one.
A decision whose step is not known (a cache built before steps had a `stage`,
or a wording `plainReasons` does not know) shows no "because", never a guess.
The full steps and source tags stay in the lookup tab; the OTU table keeps its
source tags (R43). An area not placed shows only `not placed: <reason>` in red
with its rules line, no "because" (the reason already says it); one placed
without any outline gets a red "no outline". A wrapped line stays at its
node's indentation. Each root header gives its number of areas and of problems.

Only the top level is shown at first, and an area's children render only when
it is opened, so the 2,600 areas stay fast. The filter box keeps areas whose
name contains the text (accent and case insensitive, or an exact key such as
`GA 78`); "Problems only" keeps areas not placeable (any reason, also `not
measured yet` and `no outline`) or placed without any outline (a Natural
Earth fallback outline counts as an outline). Both keep the ancestors of
what matches, opened.

### Not placed

`unplaced.json` by kind of reason and by area (`overview.js`
`unplacedSections`, R53). Kinds come from `reasonKind`: the text before `:` or
`(` (`spans several countries`, `coordinates in several countries`), `no
checklist for a country` for every `no checklist for <name>`, else the
reason. Each kind is a heading with its record count and its number of areas
(or countries). Under it one line per area: its name and key (GA or GZ, a
link to TaxonWorks), the reason detail for that area (`reasonDetail`: the
measured shares such as "Indonesia 51%, Papua New Guinea 49%", the names, or
the country), and its record count; largest first, GA and GZ mixed.
Specimens and field occurrences have no area: their lines are their DwC
country text, else "no country" (`unplaced.json` keeps the area of each
asserted distribution as a third element, `["AD", 669847, "GZ 3614"]`, and
the DwC country of a specimen as a fourth, `["CO", 12, null, "Chile"]`). The
reasons `locality text only` and `no locality at all` come last, closed,
after one note: their collecting events have no georeference or area; fix
them in TaxonWorks when convenient.

A line opens (a button with `aria-expanded`) to its records, loaded only
then, 50 at a time ("Load more"): distributions in one request per 50 (`GET
/asserted_distributions?asserted_distribution_id[]=…`,
`fetchDistributionsByIds`), specimens and field occurrences one by one
(`/collection_objects/:id/dwc`, `/field_occurrences/:id/dwc`, at most 6 at
once). Each record: its id (edit link and copy button) and its name;
clicking it opens the lookup.

### Rules

The decision order for an area (the list of "How a record is placed"),
continued by numbered steps for what follows once the checklist is known:
the part (France only: Corsica or Mainland France), the state or province
(only for the checklists of `state_countries`, named) and the outline (the
part's, else the checklist's) (`overview.js` `afterDecisionSteps`); a short
paragraph for specimens and field occurrences (DwC country, else
coordinates, with the coastal tolerance and its line). Then every rule of
`rules.json` by section (`overview.js` `ruleSections`): checklists of their
own, synonyms, parts, state countries, ignored name words, manual rules,
overlap rules (closed at first, with its count). Each rule: its line (a link
to the line below), what it matches, what it does, and its `why` or
`measured`. Last, `placement.yml` itself as the build copied it to
`public/checklists/placement.yml`, at full length in the page (no scroll box
of its own, long lines wrap), with line numbers and YAML colours
(`placement/yamlTokens.js`, a small tokenizer: comments, keys, quoted
strings, numbers and booleans, list dashes, brackets; rendered token by
token, colours from theme tokens and `--pp-yaml-*` in
`data/checklist-tokens.css`). Each line has the id `L<N>` and its number
links to it; the route hash `#L<N>` marks the line and scrolls to it. The
file exists only in a built cache: until `public/checklists/` is rebuilt and
committed, the tab says it could not load `placement.yml`.

### Record or area (the lookup)

The first tab shows, for one record or area, which checklist it lands in,
every step of the decision with its source, whether the cache lists it, and
both outlines on a map.

Input: a kind and an id, as `parseLookup` reads them (see "Reading an
explanation"): `GA`, `GZ`, `AD`, `CO` or `FO`, any case, with or without a
space, spaces around ignored (`AD 556796`, `ad 556796`, `AD556796`,
`GZ 10453`, `CO 1385165`). Anything else gives a message naming these forms.
Every `placement.yml:N` in the explanation links to that line (Rules tab).
The lookup is part of the address, `?lookup=AD%20556796`
(`/#/checklists/curator?curator=1&lookup=AD%20556796`), so a lookup can be
linked and reloaded.

What it shows:

- The explanation in the text form of `placement/format.js`, the same text
  `npm run checklists -- --from --explain "AD 556796"` prints.
- What the cache says: `listed in French Guiana` (with the part and state of
  the cached record), or why not: its reason from `unplaced.json`, or `not
  listed: rank genus` (or `not in Curculionoidea`, `recorded as absent`,
  `distribution is absent`) when the record is outside the checklists'
  scope, else `not listed in the cache` (for example a record added after
  the build). The record is looked up in the country file of the live
  result only. For an area: its row in `areas.json`, with the number of
  records on it.
- Links into TaxonWorks: the record's edit page, its area's page
  (`/geographic_areas/:id` or `/gazetteers/:id`) and the OTU.
- A map with two layers and a legend: the record's own place (its area's
  cached outline from `public/map-shapes/`, or a specimen's coordinates) and
  the outline the placement chose (`shape`, else the checklist's Natural
  Earth fallback outline). A layer that does not exist is left out and named
  (`No outline cached for Cayenne (GA 8837).`). Colours are the map tokens
  of the taxon pages (area `--tp-map-asserted`, specimen point
  `--tp-map-collection-object` or `--tp-map-field-occurrence`, assigned
  outline `--tp-map-aggregate`). A Natural Earth outline is labelled so.

Why it equals the build: the page fetches the record from TaxonWorks
(`placement/live.js`: AD `GET /asserted_distributions/:id` with
`extend[]=asserted_distribution_shape`, CO `GET /collection_objects/:id/dwc`
(and, without coordinates or georeference shape, `GET /collection_objects/:id`,
`GET /collecting_events/:id` and the area as for a GA lookup), FO
`GET /field_occurrences/:id/dwc`, GA and GZ through
`GET /asserted_distributions?geo_shape_id[]=…&geo_shape_type[]=…&per=1`),
the same JSON the build downloads, and places it with the same engine in an
engine context made from the cache files only (`context.json` and
`rules.json`, `placement/geometry-browser.js`). The browser geometry fetches
an outline only when a point lies within its `bbox` (one or two files per
lookup) and runs the same point tests as the build (`placement/geometry.js`).
`scripts/browserContext.test.js` builds the context this way from disk and
checks it reproduces every area of `areas.json` (2458 of 2458 on 2026-11-20)
and 200 specimens of the country files (100 of them placed by their
coordinates), every listed specimen placed through its georeference shape or
its collecting event area (with the area set as `attachEventAreas` sets it),
and the coordinate reasons of `unplaced.json`. It needs the
saved data (`--save`, in `modules/checklists/.cache/data`) and a cache built
from it, and is skipped without them (so a fresh checkout runs `npm test`
without this check). The explanation can differ
from the cache only when TaxonWorks changed since the build (or the rules
file, before the next build); the cache line then shows the old result.

Limits:

- Types of an OTU are not on the OTU tab: an undetermined type has no OTU in
  TaxonWorks' DwC rows, which the tab loads by OTU. Look one up by its id
  (`CO 2876460`); the lookup resolves its type status as the build does.

- An area no distribution uses cannot be fetched (TaxonWorks has no area
  endpoint): `used by no record`. When `areas.json` knows it as a parent
  (GA 78 French Guiana), its children are named.
- Specimens and field occurrences are placed from their DwC fields, as in the
  build: a change in TaxonWorks shows only after TaxonWorks has updated the
  record's DwC index.
- The label of a distribution is the OTU's name from TaxonWorks (`object_tag`);
  the build prints the DwC `scientificName` of the same OTU, normally the same text.
- A distribution without area gives `not placeable: distribution has no area`,
  as in the build (`live.js` `placeLive`).
- The browser fetches outlines from `public/map-shapes/`, which a map-shapes
  refresh (`npm run map-shapes`) can change after the checklist build. A
  missing outline file (404) then counts as no outline, so the page still
  shows what exists, but a coordinate lookup can then differ from the build.
  Build the checklists again after refreshing the map shapes.

## Maintenance

When to run what:

- `npm run checklists` (or `-- --save` once, then `-- --from` to retry quickly):
  after TaxonWorks data changed, after editing `placement.yml`, or to refresh
  the cache before publishing. Read the summary at the end: unplaced reasons
  and warnings show what needs a rule or a fix in TaxonWorks.
- `npm run checklists:measure`: when the build reports `not measured yet`
  areas, or the cached outlines changed a lot (`--recheck` lists measurements
  that moved). Then build again.
- `node modules/checklists/scripts/compare.mjs modules/checklists/.cache/old public/checklists`,
  run from the project folder: before committing a new cache, to see every
  record that moved. Copy the cache you compare against to
  `modules/checklists/.cache/old` first (see "Comparing two caches").

Adding a rule: see "The rules file" (right section, one action per rule, a
`why`), run `node --test modules/checklists/placement/rules.test.js`, build
with `--from`, check the records concerned (below), then compare.

Checking one record or area: on the curator page (`?curator=1`, tab "Record or
area", for example `AD 556796`), or on the command line with `npm run
checklists -- --from --explain "AD 556796"`. Both print the steps with their
source and the rule line to change.

When TaxonWorks has a wrong outline or fact: fix it in TaxonWorks if you can.
Until it is fixed, add a manual rule with a `why` that says so. Example: the
cached outline of GA 20379 Chukot also covers Yakutia, so a manual rule
places it in Russia, state Chukchi Autonomous Okrug, and
its `why` says to fix the shape in TaxonWorks. Remove the rule once TaxonWorks
is right.

## Known limits and open decisions

- The United Kingdom is not browsed by state (R50): the grouping of Natural
  Earth counties into England, Scotland, Wales and Northern Ireland in
  `subdivisions.geojson` is no longer used. The Natural Earth state outlines
  of the other five countries remain in use as geometry; their `aliases`
  decide nothing (R51).
- Králický Sněžník is not placeable (it lies on the Czech and Polish border)
  pending the curator's review.
- A specimen without any locality (no country, no coordinates, no locality
  text) cannot be placed: the reason is `no locality at all`. Fix it in
  TaxonWorks.
- The live tabs of the curator page (Record or area, OTU) reflect the current
  TaxonWorks data; the area tree, the unplaced lists and the rules reflect the
  last build. A difference is shown as "Differs from the cache".

## Updating

`npm run caches` rebuilds map shapes, then checklists, then the home
slideshow pool (about 5 minutes); `./scripts/update-caches.sh` also commits
and offers to push.
