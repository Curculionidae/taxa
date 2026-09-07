# Feasibility — filter a dichotomous key by geography

Investigation for `docs/Task_toDo.md` → "Task Scope by Geography". Probed against
`sfg.taxonworks.org` API v1, 2026-08-30, using key **3977** (Adosomus, 9 species) as the
sample. No code written.

## Verdict

**Feasible, client-side, with a normalization layer.** There is no server-side "species in
country X" query, so the module fetches all distribution data for the key's taxa and filters
in the browser. The main work is turning TaxonWorks' heterogeneous distribution *shapes* into
countries. Region-level statements ("Caucasus") stay fuzzy.

## What the API gives us

### Asserted distributions (the curated statement) — one batched call

`GET /asserted_distributions?otu_id[]=<every terminal OTU>&per=1000`

- Accepts many `otu_id[]`; **key/3977's 8 terminals → 53 records in one call.**
- Each record inlines `asserted_distribution_shape`:
  - `type`: `"GeographicArea"` **or** `"Gazetteer"` (Gazetteer shapes are newer, added 2026, and increasingly used)
  - `name` (e.g. `"Ukraine"`, `"Caucasus"`, `"European Russia"`, `"Austria"`)
  - `iso_3166_a2` — present for country-type areas and *some* gazetteers, absent for many
  - `geographic_area_type.name` — `"Country"`, `"TDWG Level 2"`, `"TDWG Level 4"`, …
  - `level0_id` — the country-level geo-area id, **only** for GeographicArea rows that carry it
  - `parent` — `{ name }`, one level up
- `is_absent` — must be filtered out (a "does NOT occur here" statement).
- `citations[]` — sources, already inlined.
- Also `GET /asserted_distributions?taxon_name_id[]=<scopeTN>&descendants=true&per=1000` →
  every descendant's ADs in one call. This is the primitive for **re-scoping completeness**.

**No server-side geo filter.** `geographic_area_id[]` on `/asserted_distributions` is silently
ignored (total stays 51 426 with or without it). All geo filtering is client-side.

### Specimen / field-occurrence records — one call per taxon

`GET /otus/:id/inventory/dwc.json` → rows with a plain DwC **`country`** string
(`"Ukraine"`, …), covering material citations, specimens **and** AssertedDistribution rows
(`dwc_occurrence_object_type` distinguishes them). 36 rows for OTU 732686.

- **One request per terminal OTU** — fine for a 9-taxon key, ~30 calls for a big multi-series
  key. Concurrency helps; still, make the specimen layer **opt-in / lazy** or ship AD-only first.
- The project-wide `GET /dwc_occurrences` endpoint filters on `country=<name>` (scalar) but
  **ignores `otu_id[]` and `country[]`** — so it can't be scoped to a key's taxon set. Not
  usable here; the per-OTU inventory endpoint is the reliable path.

### Country lookup

`/geographic_areas/:id` and `/geographic_areas?name=` both 404 — there is no public
country-directory endpoint. Not needed: the country list is built from the `name` /
`iso_3166_a2` on the shapes we already fetch.

### Higher-taxon terminals — DwC inventory rolls up descendants (verified 2026-09-04)

TaxonWorks staff confirmed: **there is no periodically-updated per-OTU distribution index**.
The only aggregate is the cached map/shape (`distribution.json` → `cached_map.geo_json`), which
is dissolved geometry with zero attributes — you cannot read countries off it (see
`memory/reference_cached_map_aggregate.md`). Staff's suggested proxy: *"the DwC acts as a
proxy of sorts, as you could quickly query it and get the countries."*

Tested — it works and is better than the per-terminal AD call:

`GET /otus/<genusOtuId>/inventory/dwc.json` **rolls up every descendant's occurrences in one
call.** Genus OTU 732685 (Adosomus) → 75 rows spanning 7 descendant species; the 36 rows of
species OTU 732686 are a subset. Rows carry the plain DwC `country` string and both
`AssertedDistribution` and `CollectionObject` / `FieldOccurrence` in
`dwc_occurrence_object_type`. No pagination params, full set returned (~0.37 s for 75 rows).

Consequences:
- A genus / subgenus couplet target needs **one call, no descendant walk** — and it brings
  specimen-derived countries for free, not just curated ADs.
- This supersedes the "one `asserted_distributions?taxon_name_id[]=<TN>&descendants=true` call
  per higher terminal" path — use the DwC inventory instead.
- Trade-off: a very large genus returns thousands of rows in that one response. Still one
  request; fetch lazily per higher terminal.
- Species that have **no** distribution data at all don't appear in the rollup. For the
  *taxonomic* completeness side ("are all species of the genus keyed?") you still need the
  nomenclature call (`taxon_names` descendants); the DwC rollup only answers "which species
  occur where". The two completeness checks stay separate queries.
- Same shape → country normalization problem as below (the DwC `country` string is already
  normalized to country level, so region-level ADs like "Caucasus" collapse to their member
  countries or drop out — simpler, but lossy).

## The hard part — shape → country normalization

One OTU (732686) carries ADs at four different granularities at once:

| shape type | example | maps to a country? |
|---|---|---|
| Country | Ukraine, Armenia, Kazakhstan | yes — `name` / `iso_3166_a2` directly |
| TDWG Level 4 | `"11AUT-AU"` (an Austrian subdivision) | yes — `parent.name` is usually the country |
| TDWG Level 2 | `"Caucasus"` | **no** — spans ~5 countries |
| Gazetteer | `"European Russia"`, `"Illyria"` | partial — some have `iso_3166_a2`, many don't |

Needs a small normalization layer:
- Country type → use as-is.
- TDWG L4 → `parent.name`, fallback to a `tdwgID`-prefix table.
- TDWG L1/L2 region → a static TDWG-region → member-countries table, or treat "occurs in
  Caucasus" as matching **any** country in that region.
- Gazetteer → `iso_3166_a2` if present, else best-effort by name, else ignored (documented gap).

## Proposed shape (for a later build — not started)

1. `terminalOtus(nodes)` already gives the endpoint OTU ids.
2. Batched `GET /asserted_distributions?otu_id[]=…&per=1000` → `{ otuId: Set<countryCode> }`
   via the normalization layer (drop `is_absent`).
3. Optional lazy per-OTU `inventory/dwc.json` pass to add specimen-derived countries.
4. UI: a country multi-select + hard-coded presets (`Western Palearctic`, `Central Europe`,
   `Neotropical`, …) defined as country-code sets in the module — no API support needed.
5. Terminals whose country set doesn't intersect the selection render greyed / de-emphasised
   (don't remove — the key structure must stay intact).
6. Completeness: `GET /asserted_distributions?taxon_name_id[]=<scope>&descendants=true` →
   restrict the `expected` set in `buildCompletenessReport` to descendants that occur in the
   selected countries; mark in-key-but-out-of-area terminals.

## 2026-09-05 update: a faster, single-endpoint replacement for the family/tribe pass

Measured live against key 5024 ("Key to Families of Weevils", the worst case in the
system: Curculionidae alone is 48,407 descendant AD rows / 49 pages).

**Current shipped method** (`modules/keys/composables/useKeyGeography.js`,
`AD_PAGE_CONCURRENCY=5`, `AD_TERMINAL_CONCURRENCY=3`), replicated exactly and timed:

| Step | Time |
|---|---|
| Step 1, direct-on-OTU AD, all 11 terminals in one call | 2.4s |
| Step 2, descendant AD, 8 higher-rank terminals | 59.8s |
| **Total** | **62.2s** |

**Alternative**, using `dwc_occurrences`'s denormalized rank columns instead of
`asserted_distributions` + `descendants=true`, one presence probe per terminal per
country:

```
GET /dwc_occurrences
  ?family=<Name>              (or subfamily=, genus=, tribe=, matching the terminal's rank)
  &country=<CountryName>
  &occurrenceStatus=present   (excludes explicit "not found here" statements, see caveats)
  &per=1
```
Read presence from the `pagination-total` response header, not body length.

Same 8 higher-rank terminals of key 5024, all 197 countries, 8-way concurrency:
**31.4 to 36 seconds total** (measured for 7 terminals at 31.4s, the 8th extrapolated
at the same per-terminal rate). Close to twice as fast as the current method.

**It also sees more data, in the same request.** `dwc_occurrences` is a cache built
from a union of three source tables (`asserted_distribution`, `collection_object`,
`field_occurrence`, see `Queries::DwcOccurrence::Filter::OCCURRENCE_SOURCES`), so one
family/country probe returns a natural mix of both kinds of evidence. Confirmed live:

```
family=Curculionidae&country=Germany&occurrenceStatus=present&per=50
  -> Counter({'AssertedDistribution': 47, 'CollectionObject': 3})
```

The current shipped method only gets this mix for species and non-huge genus
terminals; `needsSpecimenPass` in `lib/geoScope.js` deliberately skips the specimen
pass for family/tribe/superfamily rank, because the naive way to get specimen data at
that scale (`/otus/:id/inventory/dwc.json`, no server-side country filter) is
prohibitively expensive there (confirmed: 172s / 107MB / 76,554 rows for the
Curculionoidea-scale case). The flat-column probe above does not have that problem,
so it can replace the family/tribe branch of `needsSpecimenPass` outright rather than
skipping it.

**Why the flat columns are cheap and correct at any specimen count:** each
`dwc_occurrences` row's `family`/`genus`/`subfamily`/`tribe` fields are resolved once,
per row, at cache build time (`Shared::Taxonomy#ancestor_at_rank`, walked from the
specimen's own identified taxon name up to the target rank, in
`dwc_occurrence_upsert_job.rb`), not at query time. A query against them is a flat,
indexed string match, never a live taxonomic join, so its cost does not grow with how
many specimens the taxon has (confirmed: Anthribidae and Curculionidae, the smallest
and largest families in the key, both cost about the same per country, roughly 25ms).

### Caveats specific to this method (established this session)

- Only safe for ranks with a populated flat column on this project. Measured
  population rates: family 99.7%, genus 98.2%, subfamily 99.3%, tribe 95.5%. Subgenus
  is 0% populated (nobody in this project records an explicit subgenus), so this
  method silently returns nothing for a subgenus-rank terminal; use the
  `/otus/:id/inventory/dwc.json` rollup on that terminal's own OTU instead (correct at
  any rank, but only cheap while that specific clade stays small).
- Must include `occurrenceStatus=present`. The same cache stores explicit "does not
  occur here" statements (`occurrenceStatus: absent`, 24 rows project-wide,
  confirmed); omitting this filter risks a terminal reading present on the strength of
  a documented absence.
- The API's generic field-exclusion mechanism (`attribute_value_negator`) does not
  work, confirmed twice on two different fields (`occurrenceStatus`, `subfamily`) via
  otherwise-correct parameter shapes. So a compound terminal like key 5024's
  "Brentidae (except Nanophyinae)" cannot be queried exactly this way. Decision
  2026-09-05: accepted as a known limitation, not special-cased. There is also no
  structured signal for such an OTU anywhere in the API, the exclusion exists only in
  its free-text `name` field, so automatic detection was never reliable either.
- No server-side country aggregation exists. "Every country a taxon occurs in" always
  means probing a candidate list one country at a time (this method), or fetching
  every matching row and deduping client-side, there is no cheaper third option.
- Do not use `taxon_name_id[]` + `descendants=true` on `/dwc_occurrences` for this or
  anything else: `descendants` is silently ignored there
  (`Queries::DwcOccurrence::Filter#taxon_name_id_facet` hardcodes `descendants: false`),
  and even the resulting self-only match costs a fixed ~2.8s and scales badly with the
  id-array size (34s measured at 100 ids). This is unrelated to, and much worse than,
  both the shipped method and the one documented here.

### Recommendation

Replace the family/tribe/subfamily branch of `needsDescendantAd`'s AD pass (and the
skipped branch of `needsSpecimenPass`) in `useKeyGeography.js` with the flat-column
probe above, looped over the key's candidate country list with modest concurrency.
Leave the species / small-genus path (the existing `inventory/dwc.json` pass) as is,
it is already correct and cheap at that scale.

## Caveats to accept up front

- All filtering is client-side over a full fetch (no server geo filter).
- Region-level ADs (TDWG L1/L2, vague gazetteers) are approximate — a species stated only for
  "Caucasus" will match a filter for any Caucasus country.
- Specimen-derived countries cost one call per taxon; AD-only is the cheap, curated default.
- `is_absent` ADs and Gazetteer shapes without ISO codes need explicit handling.
- Distribution data completeness varies wildly by taxon — a "no countries known" terminal
  should be shown as *unknown*, not *out of area*.
