# Checklist Placement Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded country placement of the checklist build by one engine that explains every decision with sourced steps, used by the cache build and by a curator page that looks up single records live and shows both outlines on a map.

**Architecture:** A pure engine (`modules/checklists/placement/`) places an area or a record with a context (checklists, compiled rules, a geometry provider) and returns a `Placement` with steps. The build (Node) and the curator page (browser) each supply their own geometry provider and call the same functions. Rules not in TaxonWorks live in `rules/placement.yml` (manual + overlap sections), compiled to `public/checklists/rules.json` with line numbers.

**Tech Stack:** Vue 3 (TaxonPages local module), Node 20 scripts, `node --test`, `yaml` 2.9 (line numbers), Leaflet (already used by `ChecklistMap.vue`).

**Spec:** `modules/checklists/DESIGN.md` (approved 2026-11-20). Test evidence: https://claude.ai/artifact/3ee4FUmej8KFmqFMxsmBGV, spike scripts in the session scratchpad (`spike/`).

Repo: `taxa_fork/taxa`, branch `placement-engine`.

## Global Constraints

- Everything of the feature lives in `modules/checklists/`; only generated output in `public/checklists/`.
- Step sources are exactly `[TaxonWorks]`, `[manual, placement.yml:N]`, `[overlap NN% Name, placement.yml:N]`; the last line of every explanation is `shape  <GeographicArea/ID or Gazetteer/ID> (<name>)` or `shape  none (<reason>)`.
- Overlap threshold: 90% of the area's land points (points outside every outline are not counted).
- States/provinces for: United States, Canada, Australia, China, Russia, United Kingdom; France keeps its parts (Corsica, Mainland France).
- Northern Mariana Islands (MP) is its own checklist; Kosovo stays unplaced with reason `no checklist for Kosovo`.
- TaxonWorks calls in the browser use `makeAPIRequest` (`@/utils/request`); curator gating uses `const isCuratorMode = useCuratorMode()` from `panels/_shared/curatorMode/curatorMode.js`; TaxonWorks links use `twRecordUrl` / `twEditUrl` from the same file.
- Colours only from theme tokens (CLAUDE.md "Every colour is a theme token"); content on `bg-base-foreground`.
- UI copy and docs: plain prose, no em or en dashes and no " - " as punctuation.
- The public page must look the same except for records the new rules place differently; every such change is listed in the comparison report (Task 9) and approved by the user before the new cache is committed.
- No new runtime dependency in the browser bundle. `yaml` is a devDependency used by Node scripts only.

## Review Focus

- An area without a cached outline (25 of 2,458 today): placement still works by TaxonWorks data or a manual rule; overlap reports `not measured: no outline`; the curator map shows only what exists, without an error.
- A broken rules file (unknown key, unknown country, a match on an area kind that does not exist): the build stops with `placement.yml:N: <problem>`; a rule matching no used area is a warning, not an error.
- Curator lookup input typed loosely (`ad 556796`, `AD556796`, `556796`, trailing spaces) or an id TaxonWorks does not know (404): parsed or answered with a plain message, never a blank page.
- A specimen point on a border inside two checklist outlines: `not placeable: coordinates in several countries (A, B)`, deterministic order.
- Base URL `/taxa/` and history mode: all fetches of `public/checklists/*` use the framework `base_url`; the curator route works with and without hash mode.

---

### Task 1: Move the feature into `modules/checklists/`

**Files:**
- Move: `pages/checklists/index.vue` → `modules/checklists/ChecklistsPage.vue`; `pages/checklists/components/` → `modules/checklists/components/`; `pages/checklists/data/` → `modules/checklists/data/`
- Move: `scripts/build-checklists.mjs` → `modules/checklists/scripts/build.mjs`; `scripts/data/country-iso.json` → `modules/checklists/scripts/data/country-iso.json`; `scripts/checklists.md` → `modules/checklists/README.md`
- Create: `modules/checklists/router/index.js`, `modules/checklists/package.json` (as `modules/keys/package.json`)
- Modify: `package.json` (`checklists` script, test glob `modules/checklists/**/*.test.js` replacing `pages/checklists/**`), `scripts/update-caches.sh` comments

**Interfaces:**
- Produces: routes `{ name: 'checklists', path: '/checklists' }`, `{ name: 'checklists-curator', path: '/checklists/curator' }` (the latter added in Task 10; Task 1 only `checklists`).

- [ ] **Step 1:** `git mv` the files; fix relative imports (`../../panels/` becomes `../../panels/` from `modules/checklists/`, i.e. unchanged depth: verify), the build's `OUT_DIR`/`SHAPE_DIR` URLs (`../../../public/...`) and the `compact.js` import path.
- [ ] **Step 2:** Run `npm test` → all pass; `npm run build` → succeeds; dev server: `/#/checklists?country=Ukraine` renders 1366 species (headless check as in the earlier session).
- [ ] **Step 3:** Commit `Checklists: one module for the whole feature`.

### Task 2: Rules file and its compiler

**Files:**
- Create: `modules/checklists/rules/placement.yml`, `modules/checklists/placement/rules.js`, `modules/checklists/placement/rules.test.js`
- Modify: `package.json` (devDependency `"yaml": "2.9.0"`)

**Interfaces:**
- Produces: `compileRules(yamlText: string, file = 'placement.yml') -> CompiledRules`

```
CompiledRules = {
  checklists: [{ name, iso2, of?, areas: AreaKey[], names: string[], box?: [w,s,e,n], why, ref }],
  synonyms:   [{ names: string[], ref }],          // first name is the checklist name
  parts:      { [country]: [{ name, areas: AreaKey[], names: string[], box?, rest?: true, ref }] },
  manual:     [Rule], overlap: [Rule]
}
Rule = { match: { area?: AreaKey, tdwg?: string, gazetteerPrefix?: string, iso2?: string },
         action: { subdivisionOf: { country, part?, state? } } | { synonymousWith: AreaKey } | { notPlaceable: string },
         why?: string, measured?: string, pct?: number, ref: 'placement.yml:12' }
AreaKey = 'GA 78' | 'GZ 10453'
```

- [ ] **Step 1: Write the rules file** from the build's `ALIASES` (→ `synonyms`), `SEPARATE` (→ `checklists`, plus MP, and `areas: [GA 32253, GA 78, GA 34200]` for French Guiana), `PARTS` (→ `parts.France`: Corsica `areas: [GA 32254]`, `names: [Corse, Corsica]`, box; Mainland France `rest: true`), the manual lines from the report (12FRA → France / Mainland France approximately; 10IRE-NI → United Kingdom; synonyms Tanzania, Macedonia, Congo, Korea, Ivory Coast), and the overlap section copied from the spike's `placement.draft.yml` (YAML keys in snake_case: `subdivision_of`, `synonymous_with`, `not_placeable`, `gazetteer_prefix`).
- [ ] **Step 2: Write failing tests** `rules.test.js`:
  - `compiles a manual rule with its line`: rule for `tdwg: 12FRA` has `ref` equal to `placement.yml:<line of its "- match" in the fixture>` and `action.subdivisionOf` `{ country: 'France', part: 'Mainland France' }`.
  - `overlap rule keeps measurement`: `measured: "Russia 100% (2026-11-20)"` gives `pct: 100`.
  - `rejects an unknown key with its line`: `throws /placement.yml:3: unknown key "subdivison_of"/`.
  - `rejects an action-less rule`, `rejects two actions in one rule`.
  - `the real file compiles` (reads `../rules/placement.yml`, no throw, ≥ 100 overlap rules).
- [ ] **Step 3:** Run `node --test modules/checklists/placement/rules.test.js` → FAIL.
- [ ] **Step 4: Implement `compileRules`** with `yaml.parseDocument` + `LineCounter` (line of each sequence item from its range); convert snake_case to the camelCase model; validate keys.
- [ ] **Step 5:** Tests pass. Commit `Checklists: rules file and compiler`.

### Task 3: Areas and checklists from TaxonWorks data

**Files:**
- Create: `modules/checklists/placement/areas.js`, `modules/checklists/placement/checklists.js`, `modules/checklists/placement/checklists.test.js`, `modules/checklists/placement/fixtures.js` (small real shapes copied from the spike data: GA 77, 78-as-parent-stub, 8837, 32253, 34200, 32254, 33696, 33876, 33639, 19713, GZ 3529, GZ 10453, GA 236, GA 34271, GA 15)

**Interfaces:**
- Produces:
  - `toArea(shapeType: 'GeographicArea'|'Gazetteer', shape) -> Area` where `Area = { key: AreaKey, kind: 'GA'|'GZ', id, name, origin, type, tdwg, iso2, level0, level1, parentId, parentName }`
  - `deriveChecklists(areas: Area[], rules: CompiledRules) -> Checklist[]`, `Checklist = { id: number, name, iso2, areaIds: number[], parts?: string[], states: boolean, ref?: string }`. A country area is one with `id === level0`; country areas whose names are synonyms merge (id = the one with ISO code); every `rules.checklists` entry becomes its own checklist; `states` true for the six countries of the Global Constraints.

- [ ] **Step 1: Failing tests:** `merges Bosnia and Herz. with Bosnia and Herzegovina` (one checklist, two areaIds); `French Guiana is its own checklist with GA 32253, 78, 34200`; `Northern Mariana Islands exists with iso2 MP`; `United States has states, France has parts Corsica and Mainland France`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Pass. **Step 5:** Commit `Checklists: areas and checklists from TaxonWorks data`.

### Task 4: Engine for areas (asserted distributions)

**Files:**
- Create: `modules/checklists/placement/engine.js`, `modules/checklists/placement/engine.test.js`

**Interfaces:**
- Consumes: `Area`, `Checklist`, `CompiledRules`.
- Produces:
  - `createContext({ checklists: Checklist[], rules: CompiledRules, geometry: Geometry, shapes: Set<string> }) -> Context` (`shapes`: cached outline keys like `GeographicArea/32253`)
  - `placeArea(area: Area, ctx: Context) -> Placement`
  - `Placement = { checklist: { id, name } | null, part: string|null, state: string|null, shape: { key, name } | null, reason: string|null, steps: Step[] }`
  - `Step = { text: string, source: 'TaxonWorks'|'manual'|'overlap', ref?: string, pct?: number }`

Order (spec "Decision order"): manual rule → own checklist (area id in a `rules.checklists[].areas`, or parent id in it, or gazetteer ISO equal, or area/parent name in `names`) → `level0` → gazetteer ISO → overlap rule → not placeable (`spans …` from the overlap rule, `no outline`, `not measured yet`, `no country information`). Then part (France) and state (Task 5 fills state). Shape: the checklist's (or part's) outline key.

- [ ] **Step 1: Failing tests** (all with fixtures; assert `checklist.name`, `steps.map(s => s.source)`, `reason`):
  - `Cayenne lands in French Guiana through its parent` → steps sources `['TaxonWorks', 'manual']`, step 1 text `Cayenne is a subdivision of French Guiana (GA 78)`.
  - `Natural Earth French Guiana (GA 32253) lands in French Guiana, not France`.
  - `TDWG Central European Russia lands in Russia by overlap` → source `overlap`, `pct` 100, `ref` `placement.yml:N`.
  - `TDWG Borneo is not placeable` → `checklist null`, reason `spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%`.
  - `NZCC: Northland lands in New Zealand by its ISO code` → source `TaxonWorks`.
  - `Corse lands in France, part Corsica`; `TDWG 12FRA lands in France, part Mainland France, manual`.
  - `TDWG Northern Ireland: manual beats overlap` → United Kingdom, one `manual` step that names the overridden overlap.
  - `an area without outline and without rule` → reason `no outline`.
  - `the shape is the checklist outline` → Cayenne: `shape.key === 'GeographicArea/32253'`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `placeArea`. **Step 4:** PASS. **Step 5:** Commit `Checklists: placement engine for areas`.

### Task 5: Records (specimens), coordinates and states

**Files:**
- Modify: `modules/checklists/placement/engine.js`, `modules/checklists/placement/engine.test.js`
- Move: `modules/checklists/data/subdivisions.js` name matching into `modules/checklists/placement/states.js` (same `normalizePlace`, `buildSubdivisionIndex`, `resolveSubdivision`); the page keeps importing it from there.

**Interfaces:**
- Produces:
  - `Geometry = { checklistsAt(point: [lng, lat]) -> Promise<number[]>, stateAt(checklistId: number, point) -> Promise<string|null>, stateNames(checklistId) -> string[] }`
  - `placeRecord(record: RecordInput, ctx, area?: Area) -> Promise<Placement>`, `RecordInput = { type: 'AssertedDistribution'|'CollectionObject'|'FieldOccurrence', id, country?, stateProvince?, county?, lat?, lng? }`. AD uses `placeArea(area)` then the state; CO/FO: DwC country through synonyms and `rules.checklists[].names` on `country`/`stateProvince` → coordinates (`checklistsAt`; one hit = placed with source `overlap` and text `coordinates inside <name>`; several = reason `coordinates in several countries (A, B)` sorted by name; none = `coordinates outside every outline`) → reasons `locality text only` / `no locality at all`. Kosovo: reason `no checklist for Kosovo`.
  - State: only when the checklist has `states`; AD: area name (or parent name) matches a state name [TaxonWorks] → overlap rule `state` [overlap] → none with step `no state: <reason>`; CO/FO: `stateProvince` matches [TaxonWorks] → `stateAt(point)` [overlap].
- [ ] **Step 1: Failing tests:** `Tanzania specimen through synonym` (country `United Republic of Tanzania` → Tanzania, steps `['TaxonWorks', 'manual']`); `specimen France + stateProvince French Guiana lands in French Guiana`; `coordinates only` (fake geometry returning `[id of Ukraine]`); `border point` (two ids → reason as specified); `Hawaiian gazetteer gets state Hawaii by overlap rule`; `Evenk (political) gets state Krasnoyarsk by overlap rule`; `Central European Russia has no state, reason spans`; `Kosovo specimen reason`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `Checklists: placement of specimens, coordinates and states`.

### Task 6: Short text form

**Files:**
- Create: `modules/checklists/placement/format.js`, `modules/checklists/placement/format.test.js`

**Interfaces:**
- Produces: `formatPlacement(subject: { label: string, area?: Area }, placement: Placement) -> string`; `parseLookup(text: string) -> { kind: 'GA'|'GZ'|'AD'|'CO'|'FO', id: number } | null`.
- [ ] **Step 1: Failing tests:** Cayenne output equals exactly

```
AD 556796  Phaedropus candidus
  area     GA 8837 Cayenne (GA)
  step     Cayenne is a subdivision of French Guiana (GA 78)        [TaxonWorks]
  step     French Guiana (GA 78) belongs to the checklist French Guiana  [manual, placement.yml:N]
  result   French Guiana checklist
  shape    GeographicArea/32253 (French Guiana)
```
  (column of the source tag: padded to the longest step text); `parseLookup` cases: `'ad 556796'`, `'AD556796'`, `' GZ 10453 '`, `'556796'` → `null` (kind required), `'XY 1'` → `null`.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5:** Commit `Checklists: short text form of a placement`.

### Task 7: Node geometry and overlap measuring

**Files:**
- Create: `modules/checklists/scripts/geometry-node.mjs`, `modules/checklists/scripts/geometry.test.js`, `modules/checklists/scripts/measure-overlap.mjs`
- Modify: `package.json` (`"checklists:measure": "node modules/checklists/scripts/measure-overlap.mjs"`)

**Interfaces:**
- Produces: `createNodeGeometry({ shapeDir, fallbackFile, subdivisionsFile, checklists }) -> Geometry` plus `measureShares(polygons, targets: [{ name, polygons }]) -> { points, outside, shares: [[name, pct]] }` (grid 24×24, then 80×80 if < 30 land points, then vertices; bbox prefilter).
- `measure-overlap.mjs`: for every used area without a manual or overlap rule that needs one (TDWG, gazetteer without ISO, political area in a `states` country whose name matches no state) measure and append rules to the `overlap:` section with `measured: "<shares> (<YYYY-MM-DD local>)"`; `--recheck` re-measures existing overlap lines and prints those whose top share moved by more than 5 points. Never edits the manual section.
- [ ] **Step 1: Failing tests:** `measureShares` with two unit squares: area inside square A → `[['A', 100]]`; area straddling 70/30 → `[['A', 70], ['B', 30]]` (±2); area partly over sea → `outside > 0`, shares over land only.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5:** Run `npm run checklists:measure` on the downloaded data (Task 8 provides `--from`); it must add nothing new compared with the copied spike lines except areas changed since; commit `Checklists: overlap measuring`.

### Task 8: Build through the engine

**Files:**
- Modify: `modules/checklists/scripts/build.mjs` (keep sections 1, 2, status tags, reassessments, association distributions, classification, counting, `taxa.json`; replace sections 3 to 5 placement code, `SEPARATE`, `PARTS`, `ALIASES`, `countryOf`, `separateOf`, `partOf`, `countryByPoint`, `overviewHtml`)
- Modify: `.gitignore` (drop `overview.html`; add `modules/checklists/.cache/`)

**Interfaces:**
- Consumes: Tasks 2 to 7.
- Produces (in `public/checklists/`): country files as today plus `state` on records (replacing page-side matching), `part` as today; `index.json` checklists gain `bbox` and keep `shape`, `parts`; `rules.json` (= `CompiledRules`); `areas.json` = `[{ key, name, origin, type, tdwg, iso2, parentId, parentName, records, placement: Placement }]`; `unplaced.json` = `{ [reason]: [[type, id], …] }`.
- Flags: `--verbose` (every record's `formatPlacement`), `--explain "AD 556796"` (one, then exit), `--from <dir>` / `--save <dir>` (read or write the downloaded TaxonWorks data in `modules/checklists/.cache/` for offline runs).
- [ ] **Step 1:** Run the current build with `--save` before changing it (keeps the old cache output for Task 9 in `.cache/old/`).
- [ ] **Step 2:** Rewrite placement; `node modules/checklists/scripts/build.mjs --from .cache --explain "AD 556796"` prints the Task 6 text for Cayenne.
- [ ] **Step 3:** Full offline build; `npm test` passes; counts printed: placed, unplaced by reason.
- [ ] **Step 4:** Commit code only (`git add` without `public/checklists/`): `Checklists: build through the placement engine`.

### Task 9: Comparison report and user review (checkpoint)

**Files:**
- Create: `modules/checklists/scripts/compare.mjs`

**Interfaces:**
- `node modules/checklists/scripts/compare.mjs .cache/old public/checklists` writes `modules/checklists/.cache/compare.md`: counts (same, moved, newly placed, no longer placed, state changed) and every changed record with `formatPlacement` output, grouped by checklist.
- [ ] **Step 1:** Implement, run, read the report; every change must be explained by a rule or a TaxonWorks fact. Fix rules where it is not.
- [ ] **Step 2:** Publish the report for the user (artifact) and wait for approval.
- [ ] **Step 3:** After approval commit the regenerated `public/checklists/`: `Checklists: cache from the placement engine`.

### Task 10: Public page uses the engine's states

**Files:**
- Modify: `modules/checklists/ChecklistsPage.vue` (`recordRegion` uses `record.state || record.part`; drop the runtime name matching and `distributionPlacesByOccurrence` lookup for regions; keep drawing from `subdivisions.geojson`)
- [ ] **Step 1:** Headless check: United States list by state, Russia (Tver' etc.), Australia, France parts; counts per state equal `compare.md` expectations.
- [ ] **Step 2:** Commit `Checklists page: states from the placement engine`.

### Task 11: Curator page: lookup with steps and map

**Files:**
- Create: `modules/checklists/CuratorPage.vue`, `modules/checklists/components/PlacementLookup.vue`, `modules/checklists/components/PlacementMap.vue`, `modules/checklists/placement/geometry-browser.js`, `modules/checklists/placement/live.js`
- Modify: `modules/checklists/router/index.js` (route `/checklists/curator`), `modules/checklists/ChecklistsPage.vue` (curator-mode link "How records are placed")

**Interfaces:**
- `createBrowserGeometry({ baseUrl, index }) -> Geometry` (fetches only outlines whose `bbox` holds the point; `subdivisions.geojson` once).
- `lookupLive({ kind, id }) -> Promise<{ subject, area?: Area, record: RecordInput } | { error: string }>`: AD `GET /asserted_distributions/:id?extend[]=asserted_distribution_shape`; CO `GET /collection_objects/:id/dwc`; FO `GET /field_occurrences/:id/dwc`; GA/GZ `GET /asserted_distributions?geo_shape_id[]=&geo_shape_type[]=&per=1&extend[]=asserted_distribution_shape` (no result → `{ error: 'used by no record' }`).
- Page (curator mode only; otherwise a short "Open with ?curator=1" note): input + Find; the `formatPlacement` text in a `<pre>`; links to the record and its area in TaxonWorks; `PlacementMap` with two layers: the record's own area (or point) and the assigned shape.
- [ ] **Step 1: Failing tests** for `live.js` with a stubbed request function: 404 → `{ error: 'TaxonWorks has no AD 999999' }`; GA without records → `used by no record`; AD 556796 fixture → `area.key === 'GA 8837'`.
- [ ] **Step 2–4:** FAIL, implement, PASS; headless: `/#/checklists/curator?curator=1`, look up `AD 556796` → text as Task 6, map shows Cayenne and French Guiana; `GZ 10453`; `CO <a Ukraine specimen id>`; `ad 999999999` → message.
- [ ] **Step 5:** Commit `Checklists: curator lookup with steps and map`.

### Task 12: Curator page: area tree, unplaced records, rules

**Files:**
- Create: `modules/checklists/components/AreaTree.vue`, `modules/checklists/components/UnplacedList.vue`, `modules/checklists/components/RulesView.vue`
- Modify: `modules/checklists/CuratorPage.vue`
- **Interfaces:** reads `areas.json`, `unplaced.json`, `rules.json`. Tree: three roots (Political, TDWG, Gazetteers); each area `Name (GA)`/`(GZ)`, link `twRecordUrl('/geographic_areas/:id' | '/gazetteers/:id')`, record count, its decision in one line, click opens it in the lookup. Parent stubs (areas known only as parents) shown in grey with "used by no record". Unplaced: one section per reason with count; records load on opening in pages of 50 (`/asserted_distributions?asserted_distribution_id[]=…`, CO/FO through `/dwc_occurrences?dwc_occurrence_object_id[]…` or one `/collection_objects/:id/dwc` each, max 50), each linked with `twEditUrl`. Rules: decision order text and every rule with its `ref`.
- [ ] **Step 1:** Headless: tree shows French Guiana's three areas with decisions; Borneo under TDWG "not placeable"; unplaced "locality text only" loads 50 linked records.
- [ ] **Step 2:** Commit `Checklists: area tree, unplaced records and rules on the curator page`.

### Task 13: Documentation and cleanup

**Files:**
- Modify: `modules/checklists/README.md` (method from the report, how to edit the rules file, `npm run checklists`, `checklists:measure`, `--explain`, curator page), `scripts/update-caches.sh`
- Delete: remaining `overview.html` mentions
- [ ] **Step 1:** `npm test`, `npm run build` pass; README examples run as written.
- [ ] **Step 2:** Commit `Checklists: documentation of the placement engine`.
