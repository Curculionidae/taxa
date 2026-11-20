# Country checklists (`/checklists`)

Adapted, with permission, from the country checklists of Fleas of the World
Online (jrpletch/fleasoftheworld, `pages/checklists.vue` at 2afe35c).

## Files

- `ChecklistsPage.vue`: the page (route `checklists`, `/checklists`).
- `router/index.js`, `package.json`: register the module with the framework.
- `components/ChecklistMap.vue`: the Leaflet map.
- `data/`: map helpers, the compact file format (`compact.js` and its test), colour tokens.
- `scripts/build.mjs`: builds the cache (`npm run checklists`); `scripts/data/country-iso.json` holds extra ISO codes it uses.
- `public/checklists/`: the cache output (outside the module, served as static files).
- `rules/placement.yml`, `placement/rules.js`: the placement rules file and its compiler (see "The rules file").
- `DESIGN.md`, `PLAN.md`: design and implementation plan.

## Data

Nothing is fetched from TaxonWorks while browsing. `npm run checklists`
writes `public/checklists/index.json` (countries, taxon counts, update date,
each country's cached outline) and `countries/<id>.json` (that country's
records, with citations and place names). Country files are compact
(`data/compact.js`): each taxon, record kind and reference
text once per file, records point to them; the page expands them on load into
the same records. Only fields the page shows are kept (no collector, date or
occurrenceID: they were CSV-only and made up most of the size). See the comment at the top of the
script for how records are placed in countries. In short:

- Asserted distributions by their area's `level0_id`, gazetteers by the
  territory in their name ("TAAF: …") or ISO code, else the DwC `country`
  text; specimens and field occurrences by DwC `country`, else by their
  coordinates: the one cached country outline containing the point, or the
  nearest within about 5 km (coasts are simplified). The DwC export alone leaves gazetteers and many TDWG areas
  without a country.
- Distributions asserted for a biological association (e.g. "egg of Lixus
  bidens collected from stem of Opopanax", in Greece) are not in TaxonWorks'
  DwC export; the build adds them for each OTU side of the association, with
  the association's reading shown next to the place.
- Only Curculionoidea, species and subspecies, present records. One taxon per
  name (several OTUs of a name count once).
- Duplicate TaxonWorks country areas are merged (`ALIASES`). A gazetteer
  named after a territory ("TAAF: Île Saint-Paul") goes to that territory
  before its ISO code is used.
- French Guiana, Guadeloupe, Martinique, Réunion and Mayotte are filed under
  France in TaxonWorks but have ISO 3166-1 codes of their own, so they get
  their own checklists (`SEPARATE`): by their areas (and children), ISO code,
  name or coordinates. They are cut out of France's outline.
- Selectable parts (`PARTS`): France's checklist has Mainland France (TDWG
  "France" 12FRA, whose outline is the mainland only, and France's other
  subdivisions) and Corsica. Records carry `part`; the page shows parts like
  states. Records on the political France area or without province count for
  France only ("no part" in the overview).
- `/dwc_occurrences` is not paged: that index has no stable order and loses
  about 5% of the rows. The script uses `/dwc_occurrences.csv` (one request).

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

## Overview of what each checklist contains

The build also writes `public/checklists/overview.html`, open it locally in a
browser (it is gitignored, so it is not deployed). For every checklist its
TaxonWorks country areas, map outline, split-off parts, and every place its
records come from with the rule that placed them; then everything left out,
by reason. It is a debugging page like curator mode: areas, gazetteers,
the distribution filter of an area, every listed record's editor and its
OTU link into TaxonWorks (URL builders from `panels/_shared/curatorMode/`).
Up to 30 records per row of a checklist, all left-out records.

## Map

Country outlines come from the species map's shape cache
(`public/map-shapes/`). A country no record uses directly (Spain, used only
through its provinces) is not in that cache, and TaxonWorks gives out a shape
only through a record using it, so those come from
`public/checklists/fallback-shapes.geojson` (Natural Earth). The script lists
countries that have neither. The state/province drill-down still uses
`public/checklists/subdivisions.geojson` (Natural Earth).

## How checklists are formed

The list of checklists comes from `placement/checklists.js` (`deriveChecklists`),
which reads the areas that asserted distributions use (`placement/areas.js`,
`toArea`) and the rules file.

- Country areas come from TaxonWorks. A country area is a geographic area whose
  id equals its `level0_id`. Each becomes a checklist, named after the area.
- Merging by synonyms: TaxonWorks has several country-level areas for some
  countries (for example "Bosnia and Herz." and "Bosnia and Herzegovina"). Areas
  whose names are listed together in `synonyms`, or are the same after
  normalizing (accents, case and punctuation ignored, see `normalizeName`),
  become one checklist. Its name is the first synonym and its `areaIds` list
  every merged area. Its id is the area with the only ISO code; with none or
  several ISO codes, the lowest id.
- A country-level area whose parent is not "Earth" (England under United
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
- Ids: a merged country has the id of its area with an ISO code (else the first
  area), the same as before, because country files are named `<id>.json`. An
  own checklist has the numeric id of its first listed GA area (French Guiana:
  32253, Guadeloupe: 90), or its ISO code when it lists none (Northern Mariana
  Islands: `MP`). So the `areas` of Guadeloupe, Martinique, Réunion and Mayotte
  list the areas of today's country files; do not remove them.
- `states` is true for United States, Canada, Australia, China, Russia and
  United Kingdom, the countries browsed by state. `parts` holds the part names
  from the `parts` section of the rules file (France: Corsica, Mainland France).

## The rules file

`modules/checklists/rules/placement.yml` is hand-edited. It holds what
TaxonWorks cannot say by itself, and the placement engine reads it through
`placement/rules.js` (`compileRules`), which turns it into plain data and notes
the line of every rule. Every explanation of a decision cites the rule that
made it as `placement.yml:<line>`, so the line number in an explanation is the
line to open and change. The header comment of the file describes every key;
in short:

- Sources of a decision: `[TaxonWorks]` (what TaxonWorks states), `[manual]`
  (the `manual` section), `[overlap]` (the `overlap` section). Manual lines win
  over overlap lines.
- `checklists`: checklists of their own that TaxonWorks files under another
  country (French Guiana, Guadeloupe, Martinique, Réunion, Mayotte, Northern
  Mariana Islands). Keys: `name`, `iso2`, `of`, `areas` (`GA 78`, `GZ 10453`),
  `names` (words in a DwC country, province or place), `box` (west, south,
  east, north), `why`.
- `synonyms`: spellings of one country; the first name is the checklist name,
  e.g. `[Tanzania, United Republic of Tanzania]`.
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
  (`npm run checklists:measure`, added later). Do not edit it by hand except to
  delete a line; to overrule a line, add a manual rule.

To add a rule: put it in the section where it belongs (a checklist, a synonym
list or a manual rule), keep exactly one action per rule, and run
`node --test modules/checklists/placement/rules.test.js`. A mistake stops the
compiler with `placement.yml:<line>: <message>`, for example an unknown key such
as `subdivison_of`.

## Updating

`npm run caches` rebuilds map shapes, then checklists, then the home
slideshow pool (about 5 minutes); `./scripts/update-caches.sh` also commits
and offers to push.
