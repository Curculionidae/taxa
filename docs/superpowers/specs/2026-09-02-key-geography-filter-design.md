# Filter a dichotomous key by geography

Design for the "Task Scope by Geography" item in `docs/Task_toDo.md`. Builds on
the feasibility probe in `docs/feasibility_key_geography_filter.md` (2026-08-30).

## 1. Goal

On a dichotomous key page (`modules/keys/`), let the reader pick one or more
countries, or a configured grouping such as "Europe". Terminal taxa that are not
recorded from the selected area are de-emphasised (never removed). Completeness
is then reported twice: the existing taxonomic measure, and a geographic measure
scoped to the selection.

## 2. Background: the distribution data

The Palearctic Catalogue's regional code system (Appendix I: "E Europe", "N North
Africa", "A Asia", ...) is **deferred**; v1 works purely from what the API
returns. It stays a candidate later for a richer set of groupings.

The TaxonWorks distribution shapes are a mix of ISO countries, TDWG WGSRPD units
at Levels 2 to 4, subdivision shapes, and gazetteers. Confirmed field shapes
(OTU 732686, live):

- `"Ukraine"` — `type: GeographicArea`, `geographic_area_type.name: "Country"`,
  `iso_3166_a2: "UA"`.
- `"Caucasus"` — `TDWG Level 2`, no ISO, `parent.name: "Asia Temperate"`.
- `"European Russia"` — `type: "Gazetteer"`, **`iso_3166_a2: "RU"`**,
  `geographic_area_type: null`, `parent: null`.
- `"Austria"` — `TDWG Level 4`, no ISO, `parent.name: "Austria"`,
  `level0_id: null`.
- `"Baden-Württemberg"` — `geographic_area_type.name: "Unknown"`,
  `parent.name: "Germany"`, `level0_id: 84`.
- `"Italy"` — `TDWG Level 3`, no ISO, `parent.name: "Southeastern Europe"` (the
  name itself resolves to a country).

So: `iso_3166_a2` is present on true countries and on some gazetteers but absent
on most TDWG and subdivision shapes; those resolve by their own name or their
`parent.name`. `level0_id` is unreliable (null even on a country-scoped TDWG L4
row). The `"Europe"` grouping is a plain geographic-Europe country list (section
5), not a catalogue construct.

## 3. What the API gives us (confirmed against the live API)

- **No server-side geo query.** `geographic_area_id[]` on `/asserted_distributions`
  is ignored. All filtering is client-side over a full fetch.
- **Asserted distributions, batched:**
  `GET /asserted_distributions?otu_id[]=<every terminal OTU>&per=1000`. Each
  record inlines `asserted_distribution_shape` with `type`
  (`GeographicArea` or `Gazetteer`), `name`, sometimes `iso_3166_a2`,
  `geographic_area_type.name` (`Country`, `TDWG Level 2/3/4`, ...), `parent.name`,
  and `is_absent` (a "does not occur" statement, dropped).
- **Specimen countries, per terminal:** `GET /otus/:id/inventory/dwc.json` gives a
  plain DwC `country` string per row (covers specimens, material citations, and
  AssertedDistribution rows). One request per terminal OTU.
- **Descendants' distributions, batched:**
  `GET /asserted_distributions?taxon_name_id[]=<scope>&descendants=true&per=1000`.
  Used only by the completeness geographic pass.
- Observed shape mix in the real data: Country (usually with ISO), TDWG Level 4
  (e.g. `"11AUT-AU"`, parent is the country), TDWG Level 3 (e.g.
  `"Central European Russia"`, parent `"Eastern Europe"`, no ISO), TDWG Level 2
  (e.g. `"Caucasus"`), Gazetteer (e.g. `"European Russia"`, `"Illyria"`).

## 4. Normalization: `modules/keys/lib/geoNormalize.js` (pure, Node-tested)

`normalizeShape(shape)` and `normalizeCountryString(str)` each return a
**territory** `{ key, label }`, or `null` when it cannot be pinned to one
territory. `key` is an ISO 3166-1 alpha-2 code where one applies, otherwise a
lowercase slug (`russia-european`, `west-siberia`).

`normalizeShape` algorithm, in order:

1. **Russia special-case:** if `iso_3166_a2 === 'RU'` or the name contains
   "Russia" / "Siberia", branch by name: `/(^|\s)(central|east|north|south|
   northwest)?\s*european russia$/i` or name `"European Russia"` →
   `{ key: 'russia-european', label: 'European Russia' }`; `"West Siberia"`,
   `"East Siberia"`, `"Russian Far East"`, `"Altai"`, `"Amur"`, `"Buryatiya"`,
   `"Chita"`, `"Irkutsk"`, `"Kamchatka"`, `"Khabarovsk"`, `"Krasnoyarsk"`,
   `"Kurile Is."`, `"Magadan"`, `"Primorye"`, `"Sakhalin"`, `"Tuva"`,
   `"Yakutiya"` (WGSRPD Siberia + Russian Far East units) → `{ key: slug(name),
   label: name }`; bare `"Russia"` → `{ key: 'RU', label: 'Russia' }`.
2. `geographic_area_type.name === 'TDWG Level 2'` → `null` (region level; the
   decision stands that region ADs are not resolvable).
3. `iso_3166_a2` present → `{ key: ISO2, label: countryName(ISO2) ?? name }`.
4. name resolves in the country-name map (`nameToIso`) → that ISO2 (handles
   `"Italy"` as a TDWG L3 name, `"Ukraine"` when ISO is missing, ISO-bearing
   gazetteers named for a country). **Skipped when the shape is a sub-national
   GADM / Natural Earth unit that merely shares a name with an unrelated
   country** (e.g. the municipality of `"Albania"` in Caquetá, Colombia; the
   Shire of `"Denmark"`, Western Australia; the US state of `"Georgia"`).
   Detected by GADM hierarchy pointers: `level0_id` present and not equal to the
   shape's own `id`, or `level1_id` / `level2_id` present (a genuine country
   record has `level0_id` null or equal to its own `id`).
   Such shapes fall through to step 5, so `"Georgia"` / parent
   `"United States of America"` still resolves (to `US`), while `"Albania"` /
   parent `"Caquetá"` becomes `null`.
5. `parent.name` resolves in the country-name map → that ISO2 (handles TDWG L4
   `"Austria"` / parent `"Austria"`, `"Baden-Württemberg"` / parent `"Germany"`).
6. otherwise `null` (`"Caucasus"`, `"Illyria"`, `"Eastern Europe"`).

`normalizeCountryString(str)` (specimen DwC `country`): trim, run an alias table
(`"USA" / "United States" / "U.S.A." -> US`, `"Great Britain" / "England" /
"Scotland" / "Wales" / "U.K." -> GB`, `"Czechia" -> CZ`, `"Macedonia" ->
MK`, `"Russia" -> RU`, ...), then `nameToIso`, else `null`.

`nameToIso` / `countryName` are backed by a compact embedded ISO 3166-1 name map
(~250 entries, all countries, ~6 KB) in the module. Unmapped names fall through
to `null` rather than a guess.

`is_absent` rows are filtered before normalization, in the composable.

**Grouping-membership calls (see section 5):** `RU` (bare Russia) is **not** in
`"Europe"`; `russia-european` **is**. `TR` **is** in `"Europe"`. `KZ` is **not**.
All three are one-line edits in the grouping data file.

## 5. Grouping config: `panels/PanelKeys/geographyCategories.js` (pure data)

Per the chosen file placement. Plain default export:

```js
export default [
  {
    id: 'europe',
    label: 'Europe',
    members: ['AL','AD','AT','BY','BE','BA','BG','HR','CZ','DK','EE','FO','FI',
      'FR','DE','GR','HU','IS','IE','IT','LV','LI','LT','LU','MT','MD','MC','ME',
      'MK','NL','NO','PL','PT','RO','SM','RS','SK','SI','ES','SJ','SE','CH','TR',
      'UA','GB','VA','russia-european']
  }
]
```

`members` are **territory keys as `geoNormalize` emits them**: ISO 3166-1
alpha-2, plus the `russia-european` slug. It is a plain geographic-Europe list
(EU, rest of the continent, `TR`, `russia-european`; not `RU`, not `KZ`). Kosovo
is omitted (no stable ISO 3166-1 code); Azores, Madeira and the Canaries fall
under `PT` / `ES`. Editing which territories count as "Europe" is editing this
one array.

`modules/keys/` imports it with a relative path
(`../../panels/PanelKeys/geographyCategories.js`). This cross-folder import is
noted as unusual for the codebase but is the placement the project owner chose.
v1 ships only `europe`; further groupings (Central Europe, Western Palearctic,
Neotropical) are later one-entry additions.

## 6. Fetch layer: `modules/keys/composables/useKeyGeography.js`

`useKeyGeography(terminalOtuIdsRef)` returns:

- `territoriesByOtu: Ref<Map<otuId, Set<territoryKey>>>`
- `allTerritories: Ref<{ key, label, otuCount }[]>` sorted by label, for the
  picker; `otuCount` is how many terminals are recorded from it
- `unknownOtuIds: Ref<Set<otuId>>` terminals with no resolved territory yet
- `loading: Ref<boolean>`

Flow:

1. Resolve each terminal OTU to its taxon-name id + rank
   (`/otus?otu_id[]=…`, `/taxon_names?taxon_name_id[]=…`).
2. One batched `/asserted_distributions?otu_id[]=…` for ADs stated directly on
   the terminals; drop `is_absent`, normalize each shape, populate the map.
3. For every terminal **above species rank** (`lib/geoScope.js#needsDescendantAd`),
   `/asserted_distributions?taxon_name_id[]=<tn>&descendants=true`. Each such
   query fetches page 1 to read `Pagination-Total(-Pages)`, then pages 2..N
   concurrently. No page cap that matters (200-page safety ceiling; Curculionidae,
   the worst real case, is 49). This is cheap to page — a normal indexed query,
   unlike `/inventory/dwc.json`.
4. **Specimen countries** — `/otus/:id/inventory/dwc.json` per terminal, but
   only where that call is cheap: species terminals, name-less informal OTUs,
   and genus/subgenus terminals whose descendant-AD total (from step 3) is under
   `LARGE_TAXON_AD_TOTAL`. A family/tribe or giant-genus terminal is skipped —
   step 3 already covers it, and its inventory call is ~100 MB / minutes
   (the endpoint rebuilds the whole DWC set server-side on every request, so
   there is no cheap size probe). See `lib/geoScope.js#needsSpecimenPass`.

Results merge in reactively, so `allTerritories` grows and `unknownOtuIds`
shrinks as data arrives. Every call is guarded against stale key navigation (a
load generation counter, the pattern already in `KeyView.vue`). Any single
failure is tolerated (that terminal simply has fewer territories); a total AD
failure leaves `allTerritories` specimen-only or empty.

Measured cost of a cold scope of the pathological key 5024 ("Key to Families of
Weevils", 11 family/subfamily terminals, Curculionidae among them): **~50–65 s,
~96 MB**, versus ~283 s / ~160 MB with a serial 25-page cap that also dropped
~half of Curculionidae's 48 391 descendant ADs. A genus- or tribe-scoped key is
1–3 s. Deferred until the picker opens and cached for the session either way.

## 7. Selection state and persistence

Selection is `{ groupings: Set<string>, territories: Set<territoryKey> }`.

The **effective territory set** = the union of every selected grouping's full
`members` list, plus every explicitly selected `territories` key. Groupings
expand to their whole member list, not just the members present in this key, so
the completeness denominator in section 9 is not silently narrowed.

Persisted in `localStorage` under one global key (new
`modules/keys/lib/geoPrefs.js`, mirroring `lib/format.js` `readFormat` /
`writeFormat`), so a chosen area carries across keys. Restored as-is; the picker
and matcher tolerate keys not present in the current key. No URL query parameter
in v1.

## 8. UI

### 8.1 Picker: `modules/keys/components/GeographyPicker.vue`

Rendered in `KeyHeader.vue`, in the row with `FormatToggle`. A dropdown button
labelled with the current selection ("All areas", "Europe", "Germany, Poland",
"Europe + 1"). Panel contents:

- the configured groupings as toggle rows ("Europe")
- a divider
- `allTerritories` for this key as a checkbox list, alphabetical, each line
  `Label (n)` where `n` is `otuCount`
- a "clear" action

`v-model` is the selection object from section 7. Selecting a grouping toggles
its id in `groupings`; selecting a checkbox toggles its key in `territories`.
The control is hidden entirely while `loading` is true and `allTerritories` is
empty, and shown disabled with a "no distribution data" note if loading finished
with nothing.

### 8.2 De-emphasis in the key body

`KeyView.vue` `provide()`s the effective territory set and `territoriesByOtu`
(same mechanism as the completeness `synonymyByOtuId` provide / inject). Terminal
rendering (`FullKeyView.vue`, `GuidedView.vue`, via `TaxonLink.vue`) injects
them and, when the effective set is non-empty:

- terminal territory set is **non-empty and disjoint** from the effective set →
  `opacity-50` plus a short muted note "not in {selection label}"
- terminal territory set is empty (unknown) → rendered normally, no note
- terminal intersects the selection → rendered normally

Numbering and navigation are untouched. Print view ignores the de-emphasis.

**Path roll-up (added after first review).** A couplet (branch) lead is also
dimmed when its whole reachable subtree is out of area, so a decision that leads
nowhere useful for the selection is visible. Per lead: gather its reachable
terminal OTU ids (`descendantOtus`), then `leadGeoStatus` in
`modules/keys/lib/geoMatch.js` returns `in` if any reachable terminal is in
area, `unknown` if any is unknown, else `out`. Only `out` couplet leads dim;
terminal leads keep dimming through `TaxonLink` so the two never compound.

For this to mean anything on a genus / tribe key, `useKeyGeography` resolves
each terminal OTU to its taxon-name and rank, and for terminals above species
rank also fetches `?taxon_name_id[]=<tn>&descendants=true` (one call each),
unioning the descendant territories onto the terminal.

## 9. Two-measure completeness

`buildCompletenessReport` in `modules/keys/lib/completeness.js` gains an optional
`geoScope` argument: `{ effectiveKeys: Set<string>, territoriesByExpectedId:
Map<taxonNameId, Set<string>>, label: string }`. When absent or
`effectiveKeys` is empty, the report is exactly as today.

When present, the report gains a `geographic` block:

- `expectedCount`: in-scope taxa of the modal rank whose territory set
  **intersects** `effectiveKeys`
- `keyedCount`: of those, how many are keyed out in this key
- `missing`: the expected-in-area taxa not keyed out
- `unknownExpected`: in-scope taxa of the modal rank with **no** resolved
  territory, listed separately, excluded from `expectedCount`
- `outOfAreaTerminals`: key terminals whose territory set is non-empty and
  disjoint from `effectiveKeys`

`KeyView.vue` builds `territoriesByExpectedId` from a
`/asserted_distributions?taxon_name_id[]=<scope>&descendants=true&per=1000` call
(one request), normalized with `geoNormalize`. AssertedDistribution rows carry
`otu_id`, not a taxon-name id, so the plan resolves the AD → expected-taxon join
one of two ways (whichever the AD payload supports): the `asserted_distribution`
extend for inline taxonomy, or a batched `/otus?otu_id[]=` lookup for
`otu_id → taxon_name_id`, keyed onto the descendant set the completeness pipeline
already fetches. If the AD call or the join fails, `geoScope` is omitted and only
the taxonomic measure shows.

`CompletenessReport.vue` renders the taxonomic block exactly as now, always.
Below it, only when a `geographic` block is present, a second block:
"In {label}: {keyedCount} of {expectedCount} {rank} keyed out", the
`missing` list, an `unknownExpected` count with a tooltip, and an
`outOfAreaTerminals` line.

## 10. Units and dependencies

| Unit | Kind | Depends on | Tested |
|---|---|---|---|
| `modules/keys/lib/geoNormalize.js` | pure | none | Node table test |
| `panels/PanelKeys/geographyCategories.js` | pure data | none | trivial |
| `modules/keys/lib/geoPrefs.js` | pure + localStorage | none | manual |
| `modules/keys/composables/useKeyGeography.js` | composable | geoNormalize, `makeAPIRequest` | manual |
| `modules/keys/components/GeographyPicker.vue` | view | geographyCategories | manual |
| `modules/keys/lib/completeness.js` (extended) | pure | geoNormalize output shape | Node test extended |
| `modules/keys/components/CompletenessReport.vue` (extended) | view | completeness report shape | manual |
| `KeyView.vue`, `KeyHeader.vue`, `FullKeyView.vue`, `GuidedView.vue`, `TaxonLink.vue` | view wiring | the above | manual |

Consistent with the module: `lib/*.js` pure logic is Node-tested (`geoNormalize`,
extended `completeness`), Vue components and composables are not.

## 11. Testing

- `modules/keys/lib/geoNormalize.test.js`: a table of real shape fixtures →
  expected territory, covering every row of the section 4 table, the alias table,
  the `russia-european` collapse, Asian Russia keeping its own key, TDWG Level 2
  → `null`, ISO-less gazetteer → `null`, and specimen strings.
- `modules/keys/lib/completeness.test.js`: extended with a `geoScope` fixture,
  asserting `expectedCount` / `keyedCount` / `missing` / `unknownExpected` /
  `outOfAreaTerminals` against a hand-built descendant set with known territory
  sets and a known selection.
- `modules/keys/` has no Node tests yet (`completeness.js` and `tree.js` were
  written testable but never got a suite). These are the first two. The plan
  extends `package.json` `"test"` to
  `node --test 'panels/_gbifShared/**/*.test.js' 'modules/keys/**/*.test.js'`
  (the glob form the gbif suite already uses, verified working on Node 22).

## 12. Error handling and edge cases

- AD batch fails → picker specimen-only or hidden with a note; no geo completeness.
- One `dwc.json` fails → that terminal has fewer territories; tolerated.
- Descendants AD fetch fails → `geoScope` omitted; taxonomic completeness intact.
- Empty selection → no de-emphasis, no geographic block (today's behaviour).
- Key with no terminal OTUs → picker hidden.
- A restored territory or grouping not present in the current key → kept in state,
  matches nothing, no error.
- Terminal points at a genus or higher taxon → its `otu_id[]` ADs still resolve.
- Non-Palearctic territory in the data (e.g. `US`) → just another picker entry.

## 13. Out of scope for v1

- Saved / named custom country lists (ad-hoc multi-select only).
- Groupings other than "Europe".
- A URL query parameter for the selection.
- Oblast-level or Ural-split resolution of Russian and Kazakh distributions.
- Any server-side change.
