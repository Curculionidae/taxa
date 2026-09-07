# Key geography filter: lazy per-country redesign

Revises the loading strategy of the geography filter first specified in
`docs/superpowers/specs/2026-09-02-key-geography-filter-design.md` and shipped
across `f25a722`..`d90517d`. The **UI, the selection model, the region presets,
and the two completeness measures are unchanged.** What changes is how
`modules/keys/composables/useKeyGeography.js` and the geographic-completeness
half of `modules/keys/KeyView.vue` fetch their data.

Builds on `docs/feasibility_key_geography_filter.md` (the 2026-09-05 update in
particular) and a measurement spike run 2026-09-07 (scripts:
`scratchpad/geo_probe_bench.py`, `geo_probe_subsp.py`).

## 1. Problem

The shipped design is **eager and global**: before the picker is usable it
probes every terminal against the full candidate country list (~197), so the
picker's country list can be "only countries this key covers". On the worst
case in the system (key 5024, "Key to Families of Weevils", 8 higher-taxon
terminals) that is a 45-60 s load. The recent flat-column pass (`d90517d`)
roughly halved the higher-taxon portion but kept the eager-global shape.

Root cause: the key computes "every country every terminal occurs in" up front,
when the reader only ever wants "is this key complete for *my* country".

## 2. Spike findings (2026-09-07, live against sfg.taxonworks.org)

| Probe | Result |
|---|---|
| Lazy cost: 1 selected country, 4 families + 30 gap genera, concurrency 8 | **~1.0 s wall** (34 requests, ~165 ms median) |
| Eager cost being removed: 1 family x 197 countries, concurrency 8 | ~6 s -> x8 terminals ~= **45-50 s** |
| "Has any data at all" (`family=X&occurrenceStatus=present&per=1`, no country) | **~420 ms**, flat regardless of taxon size (Curculionidae 70 k rows == Anthribidae 893) |
| `inventory/dwc.json` at family level (Curculionidae) | **timeout > 90 s** (~172 s / 107 MB) |
| `/dwc_occurrences?taxon_name_id[]=<species>` alone, all countries | 0.47 s, **42 countries, identical to the server's self+descendant+synonym union** |
| `/dwc_occurrences?taxon_name_id[]=<species>&country=C` | **~0.3 s / country** (the doc's "~2.8 s fixed" only bites at superfamily-scale ids) |
| `?scientificName=<full name>` | broken (stored value carries authorship -> exact match returns 0) |
| `?specificEpithet=y` alone | fast, indexed, but **unsafe** — 7 extra countries from epithet homonyms in other genera |
| `?genus=X&specificEpithet=y` + `country` + `occurrenceStatus=present` | **exact, indexed, ~0.2 s**, 42 countries = identical to bulk |
| Does `genus=X&specificEpithet=y` catch **subspecies** rows? | **Yes** — a `X y z` row (even one with `taxon_name_id = null`) is a subset of the genus+epithet result |

**Conclusion.** One flat per-country probe covers every terminal rank. The
`/asserted_distributions` descendant walk and the `/otus/:id/inventory/dwc.json`
pass are both removed from the common path. Subgenus stays the lone exception
(0 % flat-column population on this project).

## 3. Architecture: lazy, per-country

### 3.1 Lifecycle

1. **Key load.** No distribution fetch. Resolve terminal OTUs to
   `{ otuId, rank, validTnId, name, epithet }` (the existing `/otus` +
   `/taxon_names` calls, plus `effectiveTaxonNameId` synonym redirect). Nothing
   else.
2. **Picker open.** The country list is `geoNormalize.allCountries()` (static) +
   the region presets from `panels/PanelKeys/geographyCategories.js`. **Every
   country is always selectable.** No fetch.
3. **First country selected.** Fire, at concurrency 8:
   - one **has-data** probe per in-key terminal (`<cols>&occurrenceStatus=present&per=1`,
     no `country`) -> `hasDataByOtu: Map<otuId, bool>` (default; see Q2);
   - one **presence** probe per in-key terminal per selected country;
   - one **presence** probe per expected modal-rank taxon (in-key targets and
     gaps) per selected country, for the completeness pill (section 5).
4. **Country added / removed.** Probe only the newly added countries. Removal is
   a pure recompute from cache.

### 3.2 State

The eager store `territoriesByOtu` (`Map<otuId, Set<territoryKey>>`, filled by
the up-front global sweep) is replaced *as the source of truth* by:

```
probeCache      : Map<countryKey, Map<probeSig, boolean>>   // present? by (country, probe signature)
hasDataByOtu    : Map<otuId, boolean>                       // has ANY present row anywhere
```

`probeSig` is a canonical string of the flat columns, e.g. `"genus=Curculio"` or
`"genus=Otiorhynchus&specificEpithet=sulcatus"`. Both the dropdown pass and the
pill pass compute a `probeSig` per taxon and share `probeCache`, so a taxon that
is both an in-key terminal and an expected modal-rank target is probed once.

`reset()` clears both on key change (existing `myGen` / generation-guard
pattern is kept).

### 3.3 Backward-compatible provides

`GuidedView.vue` and `TaxonLink.vue` inject `keyGeo.territoriesByOtu` and read a
per-terminal `Set` of territory keys. Keep that exact shape: derive
`territoriesByOtu` as a computed from `probeCache` — for each terminal, the set
of *selected* countries it probed present in. `KeyView`'s `geoTerritories`
(the picker option list) becomes the static country list.

## 4. The unified probe

`modules/keys/lib/geoProbe.js` (new, pure):

```
probeParams(term) -> { params: Record<string,string>, sig: string } | { fallback: 'inventory' }
```

| terminal rank | params |
|---|---|
| family / subfamily / tribe / genus | `{ [rank]: name }` |
| species | `{ genus, specificEpithet }` |
| subgenus | `{ fallback: 'inventory' }` — 0 % flat-column population |
| no taxon name (informal OTU) | `{ fallback: 'inventory' }` — call is cheap at that scale |

Every flat probe adds `occurrenceStatus=present` and `per=1`. Presence is read
from the `Pagination-Total` response header, with response-body length as the
fallback (matches `fetchAllAD`'s existing policy). The `inventory` fallback
issues `GET /otus/:otuId/inventory/dwc.json` once and client-filters its
`country` strings.

Name/epithet are taken **after** `effectiveTaxonNameId` synonym redirect (already
in `useKeyGeography`). `species` splits its valid name on whitespace:
`genus = parts[0]`, `epithet = parts[parts.length - 1]` (drops any subgenus
parenthetical).

`findHomonymTnIds` is kept: a family/genus/tribe/subfamily name — or a species
probe's genus component — that collides with a same-rank taxon of a different id
elsewhere in the project falls back to `{ fallback: 'inventory' }` on the
terminal's own OTU (ID-exact) rather than the ambiguous bare-string probe.

## 5. The completeness pill

*Modal rank* = the rank `buildCompletenessReport` groups the report at (its
`modalRank`), e.g. genus for a family-scoped key.

"Query all of root's descendants" is not one call — it is the expected-taxa set
`buildCompletenessReport` already computes (root's descendants at the modal
rank), queried as N flat probes.

- **Trigger:** a country is selected **and** `completenessInput` (the base
  report) is ready. No dependency on any global `geo.loading`.
- **Per selected country C**, probe **every expected taxon at the modal rank**
  (in-key targets and gaps) with `<modalRankCols>&country=C&occurrenceStatus=present&per=1`,
  through the shared `probeCache`. ~40 genera for a family key ~= 1 s / country.
- `completeness` (computed) is unchanged downstream: for the selected countries
  it restricts the expected set to taxa that occur there, flags
  in-key-but-out-of-area terminals, counts gaps.

**Deleted from `KeyView.vue`:** `assembleExpectedTerritories`,
`fetchTaxonTerritories`, `territoriesByExpectedId`, `geoTerrGen`, and
`geoLoading`'s `geo.loading` term. `geoCompletenessLoading` stays (it now tracks
just the modal-rank probe batch). `territoriesByTn` is dropped from
`useKeyGeography` — it existed only to feed this pass.

The `completeness` computed's `territoriesByTaxonId` input is rebuilt from
`probeCache`: for each expected taxon, the set of selected countries its
`probeSig` is present in.

## 6. Edge cases

| Case | Handling |
|---|---|
| **Out-of-scope terminals** (not beneath root: outgroup, compound "except" OTU) | Probed for the **dropdown** (greyed correctly). **Excluded from the pill** — not in root's descendant set. Reuse `loadCompleteness`'s existing `descIds` partition; do not recompute in `useKeyGeography`. |
| **Root-membership check** | Only the pill needs it, and the pill is already downstream of the report. **`useKeyGeography` drops `scopeOtuIdRef` and `resolveRootCandidates` entirely** (committed in `a7295ba`) — they only narrowed the eager sweep, which is gone. `effectiveTaxonNameId` extraction from that commit stays. |
| **Subgenus terminals** | `inventory` fallback on the terminal's OTU, client-filtered by country. Cheap while the clade is small (subgenera almost always are). |
| **Informal OTU, no taxon name** | `inventory` fallback — call is cheap at that scale. |
| **Compound "except" terminals** (`Brentidae (except Nanophyinae)`) | Not special-cased (2026-09-05 decision, carried: `attribute_value_negator` is broken, no structured signal). Probes as plain `family=Brentidae`, slightly over-broad. |
| **`occurrenceStatus=present`** | Mandatory. AD-sourced rows carry it; 24 `absent` rows project-wide would otherwise be false positives. |
| **Country-name spelling** | The probe sends a name string; the cache uses specific spellings (`"Bosnia and Herz."`, `"Czech Republic"`, `"Cote d'Ivoire"`). The candidate list must use the cache's exact spellings; `geoNormalize.NAME_ALIASES` groups display variants. Needs a one-off reconciliation against the live `country` value set at implementation. |
| **Homonym guard** | `findHomonymTnIds` covers the genus/genus-homonym case for the species probe (pinning `genus=` already removes epithet-homonym over-match). |
| **Unknown vs out-of-area** | The one-time no-country has-data probe per in-key terminal. Data somewhere but not in any selected country -> *out of area*; no data anywhere -> *unknown*. |
| **Key switch / restored selection** | `probeCache` + `hasDataByOtu` reset on key change (`myGen` guard). A persisted non-empty selection on mount triggers the probe batch for those countries. |

## 7. Data-fidelity tradeoff

The flat `dwc_occurrences.country` column is populated by the cache's own
upsert-time shape resolution. It resolves ISO countries and country-resolvable
TDWG / gazetteer shapes (the spike saw 47 AssertedDistribution rows for
`family=Curculionidae&country=Germany`). It does **not** expand a vague
higher-level shape: an AD stated only for TDWG L2 `"Caucasus"` has no single
`country`, so it is invisible to a `country=` probe.

The current (removed) path normalises `"Caucasus"` client-side to
{Armenia, Azerbaijan, Georgia, Russia, ...} via `geoNormalize`. The new path
does not: such a terminal reads as *unknown* for those countries rather than
*present*. Given the current expansion is itself flagged as approximate ("a
species stated only for 'Caucasus' will match a filter for any Caucasus
country"), this is a defensible change from over-broad to conservative, but it
**is** a visible behaviour difference on region-only records and should be
called out in review.

## 8. Removed / kept

**Removed:** `useKeyGeography`'s steps 1-3 (direct-on-OTU AD, descendant-AD walk,
`inventory/dwc.json` specimen pass), `fetchAllAD`, `AD_*` constants,
`resolveRootCandidates`, `scopeOtuIdRef`, `territoriesByTn`; `allTerritories`
collapses to the static list (its `otuCount` pending Q3); `KeyView`'s
`assembleExpectedTerritories`, `fetchTaxonTerritories`,
`territoriesByExpectedId`, `geoScopeOtuId`, and the hoisted `resolvedScopeOtuId`
(it can move back down next to `resolveScope()`).

**Kept:** `geoNormalize.js` (country list + alias grouping + `normalizeCountryString`),
`geoScope.js` (`needsDescendantAd` / `needsSpecimenPass` become unused but
`fieldForRank` is reused by `geoProbe.js` for the single-column ranks),
`findHomonymTnIds`, `effectiveTaxonNameId`, `mapPool`, the `myGen` generation
guard, the persisted-selection flow, `GeoFilter` / `KeyHeader` / `TaxonLink` /
`GuidedView` interfaces.

## 9. Testing

Pure units (`node --test`, matching the repo's existing `modules/keys/lib/*.test.js`):

- `geoProbe.test.js` — `probeParams` for each rank; species name splitting
  (with and without subgenus parenthetical); synonym-redirected name; homonym ->
  `inventory` fallback; missing name -> `inventory` fallback.
- `geoNormalize.test.js` — extend for the exact cache spellings once reconciled.

`useKeyGeography` and the `KeyView` pill are integration-tested by hand against
key 3605 (genus key, fast baseline) and key 5024 (families, the worst case):
verify one country selection settles in ~1-2 s, country switching is
incremental, out-of-scope and subgenus terminals still resolve, and the pill's
gap count matches the pre-redesign result for a country with known coverage.

## 10. Open questions for review

1. **Region-only records (section 7)** — accept the over-broad -> conservative
   change, or keep a client-side TDWG expansion as a fallback for terminals that
   probe empty in every selected country but have data via a region shape?
2. **Has-data probe timing** — eager for all in-key terminals on first
   selection (adds ~0.5 s once), or lazy per terminal only when it first probes
   empty in a selected country?
3. **Picker "N terminals here" count** — drop it, or fill it in per selected
   country after the probe batch?
