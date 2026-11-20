# Placement engine for the country checklists (design)

Status: draft for approval, 2026-11-20. Based on the test report
"How to place records in country checklists" (https://claude.ai/artifact/3ee4FUmej8KFmqFMxsmBGV).

## Why

The country checklists must say reliably which country (and state or province) each
record belongs to, and curators must be able to see why, so problems get fixed where
they belong: in TaxonWorks, or in our rules. Today the rules are hard-coded in
`scripts/build-checklists.mjs` (ALIASES, SEPARATE, PARTS, gazetteer prefixes, name
matching for states), records on TDWG areas mostly fall out, and nobody can see how a
single record was placed.

## Goals

- One placement function decides everything, for the cache build and for curators.
- Every decision is a short list of steps; each step names its source:
  `[TaxonWorks]`, `[manual, file:line]` or `[overlap NN% Country, file:line]`.
  The last line is the outline the record is drawn with.
- All rules that are not TaxonWorks data live in one hand-edited file.
- Curators can look up a GA, GZ, AD, CO or FO id and see where it lands, how, and both
  outlines on a map (the record's own area, the assigned checklist or state).
- States and provinces work as today (six countries), from the same engine.
- What visitors see stays the same except where the new rules place more records
  correctly; every change is reviewed in a difference report before switching.

## Non-goals

- Defining the grouping rules inside TaxonWorks (later; the rules file is shaped so it
  could move there).
- Placing specimens that have no locality data (only fixable in TaxonWorks).
- New public features on the checklist page.

## Approaches considered

1. **One placement function, decisions stored at build time, also run live for single
   lookups (chosen).** The build places every record through it and stores per area
   decisions for the curator tree. The curator lookup runs the same function in the
   browser on one record fetched live, with the same rules and stored measurements.
   No drift is possible because there is only one implementation.
2. Decisions stored at build time only: no live lookup of records changed since the
   build. Rejected: curators want to check a record right after fixing it.
3. Written description of the rules: rejected, it drifts.

## Decision order

Asserted distribution (by its area):
1. manual rule in the rules file
2. political, GADM or Natural Earth area: its country (`level0_id`) [TaxonWorks]
3. gazetteer: its ISO code [TaxonWorks]
4. overlap rule in the rules file
5. otherwise not placeable, with the reason

Specimen / field occurrence:
1. DwC country [TaxonWorks], through manual country name synonyms
2. coordinates inside one checklist outline [overlap, measured live]
3. otherwise not placeable, with the reason

Then: own-checklist rules (French Guiana etc.) and parts (France: Corsica, mainland);
then the state or province (AD: area name matches a state [TaxonWorks], else area
overlap; specimen: DwC stateProvince [TaxonWorks], else coordinates); then the outline.

Relations the engine speaks in: "Subdivision of X", "Synonymous with X",
"Not placeable: reason".

## Everything in one place

The whole feature is one local module, `modules/checklists/` (like `modules/keys/`;
the framework registers a module by its `router/` folder). Only generated output sits
elsewhere, because the browser downloads it: `public/checklists/` (rebuilt, never
edited by hand). The shared map shape cache (`public/map-shapes/`) is not part of it.

```
modules/checklists/
  README.md            how records are placed, how to update (replaces scripts/checklists.md)
  DESIGN.md            this file
  package.json         module metadata, as in modules/keys
  router/index.js      /checklists and /checklists/curator
  ChecklistsPage.vue   the public page (now pages/checklists/index.vue)
  CuratorPage.vue      curator mode only
  components/          ChecklistMap.vue, curator components
  data/                map helpers, colour tokens, compact cache format
  placement/
    engine.js          pure placement functions, no network
    context.js         lookup context from index.json, rules.json, subdivision data
    format.js          steps as short text (CLI and curator page)
    engine.test.js     real cases
  rules/placement.yml  the hand-edited rules file (manual + overlap sections)
  scripts/
    build.mjs          the cache build (now scripts/build-checklists.mjs)
    measure-overlap.mjs
    compare.mjs        old cache vs new placement
    data/country-iso.json
```

`npm run checklists` points into the module. `scripts/update-caches.sh` stays where it
is, because it rebuilds all of the site's caches, not only this one.

## Rules file

`modules/checklists/rules/placement.yml`, hand-edited, two sections:

- `manual`: own checklists (code, ISO 3166-1, which areas), country name synonyms,
  area rules (subdivision of, synonymous with, not placeable), each with `why`.
- `overlap`: one line per measured area (TDWG areas, gazetteers without ISO), with the
  result and `measured: "Russia 100% (2026-11-20)"`. Written by the measuring script,
  never by the build. Manual lines win over overlap lines.

The build compiles the file to `public/checklists/rules.json` (with line numbers) for
the browser. A rule that matches nothing is reported.

## What the build and the curator page do

- `scripts/build.mjs`: downloads as today, places through the engine, writes the same
  compact country files plus `areas.json` (every used area: tree position, decision,
  record count) and `unplaced.json` (record ids by reason). `--verbose` prints every
  decision; `--explain AD 556796` prints one.
- `scripts/measure-overlap.mjs`: measures areas missing from the overlap section and
  appends them (slow; only new areas).
- `scripts/compare.mjs`: old cache vs new placement, record by record.
- `CuratorPage.vue` (curator mode only, linked from the checklist page in curator
  mode): lookup box (GA, GZ, AD, CO, FO), steps, Leaflet map with both outlines; area
  tree (TaxonWorks trees, each area (GA)/(GZ), linked to TaxonWorks, with its
  decision); unplaced records by reason, loaded from TaxonWorks on opening; the
  decision order and the rules rendered from `rules.json`. Replaces the debugging overview page the old build wrote.

## Live lookup limits

- AD, CO, FO: fetched live, placed live.
- GA, GZ: found through any AD using it (`/asserted_distributions?geo_shape_id[]=`);
  an area no record uses can only be shown as "used by no record" (no area endpoint).
- An area not yet measured shows "not measured yet; the next build measures it".

## Defaults (change if wrong)

- Threshold 90%.
- States and provinces for the six countries of today.
- Northern Mariana Islands becomes its own checklist; Kosovo stays unplaced with the
  reason "no checklist for Kosovo" until decided.
- Work on branch `placement-engine` (off `country-checklists`), so PR 43 can land first.

## Left to the builder

File names inside the modules, the exact text of the step messages (short, plain),
page layout details within the project's styling rules.
