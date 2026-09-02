# Filter a dichotomous key by geography

Design for the "Task Scope by Geography" item in `docs/Task_toDo.md`. Builds on
the feasibility probe in `docs/feasibility_key_geography_filter.md` (2026-08-30).

## 1. Goal

On a dichotomous key page (`modules/keys/`), let the reader pick one or more
countries, or a configured grouping such as "Europe". Terminal taxa that are not
recorded from the selected area are de-emphasised (never removed). Completeness
is then reported twice: the existing taxonomic measure, and a geographic measure
scoped to the selection.

## 2. Background: the reference vocabulary

The weevil project's distribution data follows the **Cooperative Catalogue of
Palearctic Curculionoidea, 2nd edition, Appendix I** (pp. 570 to 571): a code
system grouped into "E Europe", "N North Africa", "A Asia", China subdivisions,
and world zoogeographic regions.

The "Europe" grouping in this feature is Appendix I's "E" list. Appendix I treats
Russia in Europe as three territories, defined at oblast level in its footnotes
7, 8 and 9:

- **Central European Territory (CT):** Bryansk, Ivanovo, Kaliningrad, Kaluga,
  Kirov, Kostroma, Lipetsk, Moscow, Nizhni Novgorod, Novgorod, Oryol, Penza,
  Pskov, Ryazan, Samara, Smolensk, Tambov, Tula, Tver, Ulyanovsk, Vladimir and
  Yaroslavl Oblasts, the city of Moscow, Perm Krai, and the Republics of
  Bashkortostan, Chuvashia, Mari El, Mordovia, Tatarstan and Udmurtia.
- **Northern European Territory (NT):** Arkhangelsk, Leningrad, Murmansk and
  Vologda Oblasts, the city of St Petersburg, the Republics of Karelia and Komi,
  and the Nenets Autonomous Okrug.
- **Southern European Territory (ST):** Astrakhan, Belgorod, Kursk, Orenburg,
  Rostov, Saratov, Volgograd and Voronezh Oblasts, Krasnodar and Stavropol
  Krais, and the Republics of Adygeya, Chechnya, Dagestan, Ingushetia,
  Kabardino-Balkaria, Kalmykia, Karachay-Cherkessia and North Ossetia-Alania.

Appendix I also puts Turkey (TR) and Kazakhstan west of the Ural River in "E".
The TaxonWorks data is not granular enough to act on the oblast lists or the
Ural split; section 4 says how each ambiguous case is resolved.

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

Turns one distribution shape or one specimen country string into a **territory**
`{ key, label }`, or `null` when it cannot be resolved to a specific territory.

`key` is the ISO 3166-1 alpha-2 code where one exists, otherwise a lowercase
slug (`russia-european`, `west-siberia`).

| Input | Result |
|---|---|
| Country shape with `iso_3166_a2` | `{ key: ISO2, label: name }` |
| Country shape without ISO, name in the alias table (`"Russia"`) | table entry |
| Country shape without ISO, unknown name | `null` |
| TDWG Level 4 (`"11AUT-AU"`) | resolve `parent.name` as a country → its ISO2 |
| TDWG Level 3, name matches `/European Russia$/` (Central, East, North, South, Northwest) | `{ key: 'russia-european', label: 'European Russia' }` |
| TDWG Level 3, Asian Russia (`"West Siberia"`, `"East Siberia"`, `"Russian Far East"`, ...) | own slug key, own label |
| TDWG Level 3, other | resolve `parent.name` as a country, else `null` |
| TDWG Level 2 (`"Caucasus"`, `"Eastern Europe"`) | `null` (region level, per the decision that region ADs are not implementable) |
| Gazetteer with `iso_3166_a2` | `{ key: ISO2, label: name }` |
| Gazetteer without ISO (`"Illyria"`) | `null` |
| Specimen `country` string | match against a name and alias table → ISO2, else `null` |

Alias table (module constant, small): `"Russia" -> russia-european`,
`"USA" / "United States" / "U.S.A." -> US`, `"Great Britain" / "England" /
"Scotland" / "Wales" -> GB`, `"Czech Republic" / "Czechia" -> CZ`,
`"Macedonia" / "North Macedonia" -> MK`, and the handful of others the live data
turns up. The table is data in the file, easy to extend.

**Resolved decisions:**

- Bare `"Russia"` → `russia-european`. Appendix I's `[RU]` is `CT + NT + ST`
  (all European); in a Palearctic weevil key a bare "Russia" statement is
  overwhelmingly European Russia. Asian Russia is only ever stated as an explicit
  Siberian or Far East subregion, which keeps its own key.
- `Kazakhstan` → `KZ`, and `KZ` is **not** a member of the "Europe" grouping. The
  west-of-Ural split in Appendix I cannot be recovered from a shape that just
  says "Kazakhstan".
- `Turkey` → `TR`, and `TR` **is** a member of the "Europe" grouping, following
  Appendix I.

`is_absent` rows are filtered before normalization, in the composable.

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

`members` are **territory keys as `geoNormalize` emits them** (ISO 3166-1
alpha-2, plus the `russia-european` slug), not the Cooperative Catalogue's
Appendix I letter codes (those clash with ISO: the catalogue's `AZ` is the
Azores, `MA` is Malta, `MC` is Macedonia). Appendix I "E" is the conceptual
authority for which territories belong in "Europe"; the list above is its ISO
translation. Kosovo is omitted (no stable ISO 3166-1 code); Azores, Madeira and
the Canaries fall under `PT` / `ES` already.

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

Flow: one batched `/asserted_distributions?otu_id[]=...` call, drop `is_absent`,
normalize each shape, populate the map. Then fire the per-terminal
`/otus/:id/inventory/dwc.json` calls with bounded concurrency; normalize each
`country` string and merge the results in reactively, so `allTerritories` grows
and `unknownOtuIds` shrinks as specimen data arrives. Every call is guarded
against stale key navigation (a load generation counter, the pattern already in
`KeyView.vue`). Any single failure is tolerated (that terminal simply has fewer
territories); a total AD failure leaves `allTerritories` specimen-only or empty.

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

Couplet structure, numbering and navigation are untouched. Print view ignores
the de-emphasis.

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
