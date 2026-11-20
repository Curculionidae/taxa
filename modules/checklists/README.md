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
- `scripts/measure-overlap.mjs`: measures areas and writes the overlap rules (`npm run checklists:measure`, see "Measuring overlap"); `scripts/geometry-node.mjs`: the outline lookups (Geometry) for Node and `measureShares`.
- `public/checklists/`: the cache output (outside the module, served as static files).
- `modules/checklists/.cache/` (not committed): `data/`, the saved TaxonWorks data; `old/`, a copy of an earlier cache for comparing.
- `rules/placement.yml`, `placement/rules.js`: the placement rules file and its compiler (see "The rules file").
- `placement/engine.js`, `areas.js`, `checklists.js`, `states.js`, `format.js`: the placement engine (see "How checklists are formed" and "How a record is placed"); `states.js` also serves the page's state drill-down, `format.js` writes a decision as text.
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
  occurrences by their DwC country, else by their coordinates. Each record
  carries `part` (France: Corsica, Mainland France) and `state` (six
  countries) when the engine finds one.
- Distributions asserted for a biological association (e.g. "egg of Lixus
  bidens collected from stem of Opopanax", in Greece) are not in TaxonWorks'
  DwC export; the build adds them for each beetle side of the association,
  with the association's reading shown next to the place. They are asserted
  distributions on an area, so they are placed like any other.
- Only Curculionoidea, species and subspecies, present records. One taxon per
  name (several OTUs of a name count once).
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
own checklist's `bbox` are dropped. The state/province drill-down still uses
`public/checklists/subdivisions.geojson` (Natural Earth).

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
  `state_countries` list (`placement.yml:120`: United States, Canada,
  Australia, China, Russia, United Kingdom), the countries browsed by state. `parts` holds the part names
  from the `parts` section of the rules file (France: Corsica, Mainland France).

## The rules file

`modules/checklists/rules/placement.yml` is hand-edited. It holds what
TaxonWorks cannot say by itself, and the placement engine reads it through
`placement/rules.js` (`compileRules`), which turns it into plain data and notes
the line of every rule. Every explanation of a decision cites the rule that
made it as `placement.yml:<line>`, so the line number in an explanation is the
line to open and change. The header comment of the file describes every key;
in short:

- Sources of a decision: `[TaxonWorks]` (what TaxonWorks states), `[Natural
  Earth]` (another name of a state from `subdivisions.geojson`), `[manual]` (a
  hand-written line: the `manual` section, a checklist, a synonym, a part, the
  ignored name words), `[overlap]` (the `overlap` section). Manual lines win
  over overlap lines.
- `checklists`: checklists of their own that TaxonWorks files under another
  country (French Guiana, Guadeloupe, Martinique, Réunion, Mayotte, Northern
  Mariana Islands), and checklists the user decided to keep apart (Kosovo,
  ISO XK; Norfolk Island, ISO NF, TDWG 50NFK). Keys: `name`, `iso2`, `of`, `areas` (`GA 78`, `GZ 10453`),
  `names` (words in a DwC country, province or place), `box` (west, south,
  east, north), `why`.
- `state_countries`: the checklists browsed by state or province (United
  States, Canada, Australia, China, Russia, United Kingdom); their state
  outlines and other state names come from Natural Earth
  (`subdivisions.geojson`). The engine has no list of its own.
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
same code. `createContext({ checklists, rules, geometry, shapes })` builds the
lookups once (`shapes` is the set of cached outline keys such as
`GeographicArea/32253`). `placeArea(area, ctx)` places the area an asserted
distribution points to, without its state; `await placeRecord(record, ctx,
area?)` places a record (an asserted distribution with its area, a specimen or
a field occurrence) and finds its state. The answer is a `Placement`: the
checklist (or `null` and a `reason`), the part, the state, the outline to show
(`shape`, the checklist's or the part's outline, never the state's) and the
`steps` of the decision.

`geometry` answers the questions that need outlines; it is passed in, so the
engine itself stays pure (the build reads cached files, the browser fetches):
`checklistsAt([lng, lat])` gives the ids of the checklists whose outline holds
a point, `stateAt(checklistId, [lng, lat])` the state whose outline holds it
(or null), `partAt(checklistId, [lng, lat])` the part whose outline, else
whose `box` in the rules file, holds it (or null), and `stateNames(checklistId)`
the states of a checklist as `{ name, aliases }`, the aliases being the
Natural Earth names of `subdivisions.geojson` (`[]` when none). Only
records with coordinates make `placeRecord` wait for it; `placeArea` never
calls it.

Every step is one short sentence with its source:

- `TaxonWorks`: what TaxonWorks says (the country of a political area, the
  parent of an area, the ISO code of a gazetteer). Fix it in TaxonWorks.
- `Natural Earth`: a state found through one of its Natural Earth names
  (`aliases` in `public/checklists/subdivisions.geojson`), e.g. `DwC
  stateProvince Moskva is a Natural Earth name of the state Moscow`. These
  names are data, not rules; overrule a wrong one with a manual rule.
- `manual`: a hand-written line of the rules file (a checklist of its own, a
  synonym, a part, a manual rule), cited as `placement.yml:<line>`. Fix it there.
- `overlap`: a measured line of the overlap section, with its line and the
  measured share (`pct`). Overrule it with a manual rule.

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
   `not measured yet` (an outline is cached but no rule measured it yet), or
   `no outline` (nothing to measure).

Then the part, for a checklist with parts (France): the part that lists the
area or its parent in `areas`, or whose `names` appear in the area's or its
parent's name; else the `rest` part (Mainland France) when the area lies below
country level; else none. A manual rule may name the part itself. Last, the
outline: the first cached area of the part, else of the checklist. When none
is cached the record is still placed and a last step says `no outline cached
for <checklist>`.

Two worked examples (as the curator page shows them):

```
GA 8837 Cayenne  =>  French Guiana
  Cayenne is a subdivision of French Guiana (GA 78)            [TaxonWorks]
  French Guiana (GA 78) belongs to the checklist French Guiana [manual, placement.yml:69]
  outline: GeographicArea/32253

GA 33639 Borneo (TDWG 42BOR)  =>  not placeable
  reason: spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%
  Borneo spans several countries: Indonesia 72%, ...           [overlap, placement.yml:211]
```

Cayenne has no country in TaxonWorks, but its parent GA 78 is listed in the
French Guiana entry of the rules file, so step 2 decides before the country
step. Borneo is a TDWG area with no country; the measuring script found it in
three countries and wrote a `not_placeable` overlap line, whose shares become
the reason.

### Reading an explanation

`placement/format.js` turns one decision into plain text. The build prints it
with `--verbose` and `--explain`, and the curator page shows the same text.
`formatPlacement(subject, placement)` takes the subject (`kind`, `id`, `label`
and optionally the `area` behind it) and the `Placement`. Example:

```
AD 556796  Phaedropus candidus
  area     GA 8837 Cayenne (GA)
  step     Cayenne is a subdivision of French Guiana (GA 78)             [TaxonWorks]
  step     French Guiana (GA 78) belongs to the checklist French Guiana  [manual, placement.yml:69]
  result   French Guiana checklist
  shape    GeographicArea/32253 (French Guiana)
```

The first line is the kind, the id and the label. `area` appears only when an
area is given. Each `step` is one sentence of the decision, in order, followed
by its source tag in an aligned column. `result` names the checklist, with
`, part <P>` and `, state <S>` when set, or says `not placeable:` and the
reason. `shape` is the outline shown (`none (<reason>)` when the record could
not be placed, `none (no outline cached)` when it was placed but has no
cached outline).

Source tags:

- `[TaxonWorks]`: a fact from TaxonWorks data (parent area, ISO code).
- `[manual, placement.yml:N]`: a hand-written rule, with its line in the rules file.
- `[overlap 72% Russia, placement.yml:N]`: a measured overlap rule; the share
  and the country (or state) it refers to.
- `[overlap, placement.yml:N]`: an overlap rule without a share.
- `[overlap]`: a live coordinate step (a point tested against the cached outlines), no rule line.

The lookup box takes a kind and an id: `GA`, `GZ`, `AD`, `CO` or `FO`, in any
case, with or without a space (`ad 556796`, `AD556796`, `GZ 10453`).
`parseLookup(text)` returns `{ kind, id }`; a bare number or any other kind
gives `null`.

### Specimens and field occurrences

A specimen or field occurrence is placed by its DwC fields (`RecordInput`:
`country`, `stateProvince`, `county`, `locality`, `lat`, `lng`). The first
that applies decides:

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
   country without a checklist is not placeable: `no checklist for Kosovo`
   (and so for any other country text), even when coordinates exist.
3. No DwC country, but coordinates: `geometry.checklistsAt`. One checklist
   holds the point: placed, step `coordinates <lat>, <lng> lie inside
   <name>` `[overlap]` (measured live, no line, no share). Several:
   `coordinates in several countries (Russia, Ukraine)`, names sorted. None:
   `coordinates outside every outline`. This fallback is for the few records
   (252 in the test run) where TaxonWorks gives coordinates but no country;
   our outlines are simplified, so they never overrule a DwC country.
4. Otherwise not placeable: `locality text only` when the record has locality
   text, else `no locality at all`.

Then the part (France), as the old build did: a part name in `stateProvince`
or `county` (Corse goes to Corsica) `[manual]`; else the part whose outline, or
`box`, holds the coordinates (`geometry.partAt`, step `coordinates <lat>,
<lng> lie inside Corsica` `[overlap]`); else the `rest` part (Mainland France)
when the record has a stateProvince or coordinates, as it then lies below
country level; else no part.

### States and provinces

Only checklists with `states` (the rules file's `state_countries`,
`placement.yml:120`: United States, Canada, Australia, China, Russia, United
Kingdom) get a state; any other has none and no state step.
State names are matched with `placement/states.js` (`matchSubdivision`) and
only against the states of the chosen checklist: first the state's own name
`[TaxonWorks]` or one of its Natural Earth names (`aliases` in
`subdivisions.geojson`: Moskva for Moscow, Xinjiang Uygur for Xinjiang)
`[Natural Earth]`; then either of them with the rules file's
`ignored_name_words` left out (`DwC stateProvince "Krasnoyarsk Krai" matches
the state Krasnoyarsk (ignoring "krai")`, `[manual]` with the line of that
list). A state's own name wins over another state's alias. Country names never meet
state names: the US state Georgia stays a state of the United States, and a
specimen with DwC country Georgia and stateProvince Georgia lands in the
country Georgia, which has no states.

For an asserted distribution, the first that applies:

1. A manual rule for the area gives `subdivision_of: { country, state }`
   (`[manual]`, with its line). Manual rules win over names, as they do for
   countries: GA 20379 Chukot is Chukotka although Natural Earth lists Chukot
   among the names of Sakha.
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
   renamed units (Evenk to Krasnoyarsk, TDWG Yakutskiya to Sakha). The
   measuring script writes these lines.
5. No state, with a last step `no state: <reason>`: `record is for the whole
   country` (the area is one of the checklist's country areas), `spans several
   states: <shares>` (from an overlap or manual line `not_placeable: spans
   several states`; such a line only speaks about the state and never decides
   the country), or `not measured yet`.

For a specimen or field occurrence: the DwC `stateProvince` (TaxonWorks'
state) is a state of the checklist `[TaxonWorks]` (or through a Natural Earth
name or ignored words, as above); else the state outline
holding its coordinates (`geometry.stateAt`, `[overlap]`); else no state, with
the reason (`no state: Atlantis is not a state of United States`, `no state:
no DwC stateProvince and no coordinates`, or that the coordinates lie in no
state outline).

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
Central European Russia gets its country from one overlap line (line 201,
Russia 100%); a second line (521), `not_placeable: spans several states`,
tells why it has no state: no state holds even a fifth of it. The line
numbers are those of the rules file on 2026-11-20; they shift when lines are
added above.

## Measuring overlap

`npm run checklists:measure` (`scripts/measure-overlap.mjs`) writes the
`overlap` section of the rules file. It measures, on the cached outlines, how
the outline of an area is shared among other outlines, and appends one rule
per area. The build never measures; it only reads the rules.

When to run it: after a build reports areas as `not measured yet` (new TDWG
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
area's vertices, where a point up to 0.05 degrees (about 5 km) off a
simplified coast counts for the nearest outline. Each point is tested against
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
Areas without a cached outline, or outside every outline, get no rule and are
listed at the end of the run. `--dry-run` prints the rules instead of writing
them.

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
npm run checklists                                   # download (about 2 minutes) and build
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
- `association_otus.json`: OTU and taxon name of association OTUs without a
  DwC row; `otu_parents.json`: the parents of OTUs the DwC export leaves
  without classification. A stale or hidden OTU is kept as `{ error }`.

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
  `states` (true for the six countries browsed by state), `taxa` and
  `records`), and `unplaced` (records and taxa left out).
- `countries/<key>.json`: one checklist, a `checklist` header and then its
  records in the compact form of `data/compact.js`. Records carry `part` and
  `state` when the engine finds one.
- `taxa.json`: per higher taxon its number of taxa in each checklist, keyed by
  the checklist key; the page loads it for the taxon filter.
- `rules.json`: the compiled rules file (`compileRules`), for the browser.
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
numeric id appears in `public/checklists/`. When two checklists would get the
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
record by record and writes a report to read before approving:

```
npm run checklists -- --from                          # build the new cache from the saved data
node modules/checklists/scripts/compare.mjs .cache/old public/checklists
```

Arguments: the old cache (default `modules/checklists/.cache/old`), the new
cache (default `public/checklists`) and `--from <dir>`, the saved TaxonWorks
data the new cache was built from (default `modules/checklists/.cache/data`).
A folder is read relative to the working directory, else to
`modules/checklists/`. The new cache must come from that data and the current
rules file, because the explanations are made again from them.

It writes `modules/checklists/.cache/compare.md` and `compare-full.md` (not
committed). The report gives the counts (same checklist, moved, newly placed,
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
- The old cache stored no states; its page worked them out while showing a
  country. `compareCaches.mjs` (`oldState`) reproduces that: for the United
  States, Canada, Australia, China, Russia and the United Kingdom, the
  record's stateProvince, then the place name of its distribution, then its
  county, matched against the old `subdivisions.geojson` with its aliases
  and the old page's word list (`OLD_IGNORED_WORDS`, kept fixed there so the
  reproduction does not follow later edits of `ignored_name_words`).
- TaxonWorks edits are told apart from rule changes by dates: a record created
  in TaxonWorks after the old download day (`updated` in the old index.json)
  is "new in TaxonWorks", one updated after it "edited in TaxonWorks"; a
  record of the old cache that is nowhere in the new data is "gone from
  TaxonWorks".
- Questions for the curator that the report should carry go into
  `modules/checklists/.cache/compare-questions.md`; its text is added at the
  end of `compare.md` on every run.

## Updating

`npm run caches` rebuilds map shapes, then checklists, then the home
slideshow pool (about 5 minutes); `./scripts/update-caches.sh` also commits
and offers to push.
