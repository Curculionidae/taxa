# `panels/_gbifShared/`

Shared helpers for the GBIF panels. `_`-prefixed, no `main.js`, so the panel
loader ignores it — panels pull pieces in with plain relative imports.

Consumers: `PanelGbifTaxon`, `PanelGbifImages`, `PanelGbifMap`,
`PanelGbifTypeSpecimens`, and `PanelGallery` (its "Type material via GBIF" tab).

## Modules

| File | Exports | Notes |
|---|---|---|
| `useGbifMatch.js` | `useGbifMatch(nameRef)` composable · `matchGbifKey(name, {speciesGroupOnly})` · `isSpeciesGroupMatch(match)` · `deriveScientificName` · `recordRequest` · `CHECKLIST_KEY` · `GBIF_TAXON_BASE` / `GBIF_OCCURRENCE_BASE` / `GBIF_OCCURRENCE_DETAIL` · `gbifMenuOptions` | Matches a name against the **CoL** checklist (`v2/species/match`, alphanumeric usage keys). `matchGbifKey` is the one-shot form for looping over a name list (the composable wraps a single ref). |
| `typeStatuses.js` | `TYPE_STATUSES` | 47 GBIF `typeStatus` values, **CamelCase** — the occurrence-search API wants `Holotype`, not the all-caps `HOLOTYPE` from `/enumeration/basic/TypeStatus` (that returns 0 hits). |
| `twSynonymNames.js` | `fetchTwSynonymNames(taxonId)` | TaxonWorks synonym name strings for a taxon-name id (invalidating relationships → subject names). The AssertedDistributions two-step. |
| `gbifTaxonScope.js` | `resolveGbifTaxonScope(primaryName, taxonId, {speciesGroupOnly})` → `{ names, keys }` | The taxon's accepted name **+ every TW synonym** → the name set for filtering and the **union of CoL usage keys** to OR as `taxonKey` params (each synonym may carry its own GBIF records). Every occurrence-based GBIF panel uses this. |
| `gbifBackboneConcept.js` | `fetchGbifBackboneConcept(name)` → `{ acceptedName, synonymNames }` | GBIF **taxonomy-backbone** view: `/v1/species/{intKey}/synonyms` for the accepted taxon — a taxonomy fact, no occurrence sampling. Backbone (integer keys) on purpose: that synonyms route only exists on the backbone. Feeds the TaxonWorks/GBIF name-overlap Venn in `PanelGbifTaxon`. |
| `gbifNameFilter.js` | `canonicalName` · `epithetKey` (genus-independent match key — weevils get recombined a lot) · `shortName` (drop authorship) · `occurrenceName(rec, checklistKey)` · `makeGbifNameFilter(names)` · `partitionByName` / `tallyOccurrenceNames` · `scopeCaption({shown, total, lumpedNames, noun, taxonName, includesSynonyms})` | See **The GBIF synonymy problem**. `tallyOccurrenceNames(rows, names, ck)` → `{ included:{name,count}[], excluded:{name,count}[], keptRows }` — per-name counts split by whether the identified name is in the TW concept (accepted + TW synonyms); `partitionByName` is the thin wrapper (`{kept, lumpedNames}`). `scopeCaption({shown, total, lumpedNames, noun, taxonName, includesSynonyms})` renders the shared caption for the Map / Images panels: pass `match.usage.canonicalName` as `taxonName` (falls back to "this taxon") and `includesSynonyms: names.length > 1` → "identified as *Larinus latus* or a TaxonWorks synonym out of N under GBIF's broader concept, which also includes …". |
| `gbifTypeImages.js` | `gbifOccurrencesToImages(results, {max, names})` | Pure mapper: occurrence-search `results[]` → flat image objects for `ImageLightbox`'s plain-caption path (`figure_label` + `captionHtml` + image-level `attribution`/`source`, `depictions: []`). Also carries `occurrenceKey`, `typeStatus`, `taxonName`, `specimenLabel`, `href` for grouping / direct links. Applies the name filter when `names` is given. |
| `gbif-mark.svg`, `gbif-tokens.css` | — | Logo; `--pp-gbif` brand-green token (`:root` + `.dark`). |

## The GBIF synonymy problem

**GBIF (via its CoL backbone) lumps taxa that TaxonWorks keeps split.** Example
seen in this project: CoL treats **_Lixus cardui_** (Rossi, 1790) as an
`AMBIGUOUS_SYNONYM` of **_Larinus latus_** (Herbst, 1783). TaxonWorks keeps both
as valid species (separate OTUs). GBIF *does* hold occurrence records for the
true _Larinus latus_ **and** the true _Lixus cardui_ — it just files them under
one accepted name.

Consequence: an occurrence-search filtered by `taxonKey` (which includes
synonyms) returns the _Lixus cardui_ lectotype when you query the _Larinus
latus_ key, and vice-versa. Without mitigation, the _Larinus latus_ page shows
"_Lixus cardui_" images / type specimens, and the type-specimen count is
inflated.

**GBIF preserves the original identification** — but not where its docs say.
GBIF's advice ("use the verbatim scientific name filter") is useless here: the
MNHN dataset left `verbatimScientificName` null, so `?verbatimScientificName=…`
returns 0. The distinction lives in the interpreted fields:

| field | _Lixus cardui_ lectotype (occ 583421989) | meaning |
|---|---|---|
| `verbatimScientificName` | `null` | raw dataset string, often absent |
| `scientificName` | `Lixus cardui (P.Rossi, 1790)` | **identified name — survives the merge** |
| `acceptedScientificName` | `Larinus latus (J.F.W.Herbst, 1783)` | the lumped name — **never filter on this** |

`occurrenceName(rec, CHECKLIST_KEY)` returns `verbatimScientificName ||
scientificName || classifications[ck].usage.name` — original-most first, and
never `acceptedScientificName`.

**Mitigation — filter results to the TaxonWorks name set.** Build the allowed
set from the TW accepted name **plus that taxon's own TW synonyms**
(`fetchTwSynonymNames`), make a predicate with `makeGbifNameFilter(names)`, and
drop occurrences whose `occurrenceName` isn't in it. `canonicalName` reduces a
name to `"genus epithet"` (lowercase, subgenus/authorship/year stripped) and the
predicate also accepts either-direction infra/supra-specific containment so a
subspecies type of the taxon still passes.

Every occurrence-based panel resolves the scope with `resolveGbifTaxonScope`
(union of CoL keys for the accepted name + all TW synonyms), ORs those as
`taxonKey` params, then keeps only rows whose `occurrenceName` is in the
matching name set.

Two guards on the match, don't confuse them:
- `speciesGroupOnly` — keep only species/subspecies/variety/form. Only the
  **Gallery GBIF tab** uses it (type material is species-group only; the panel
  is already rank-gated on the TW side).
- `rejectHigherRank` — drop **only** `matchType: HIGHERRANK` (name absent from
  CoL → silently upgraded to its genus). A *genuine* genus or family EXACT match
  is kept. Images / TypeSpecimens / Map / Taxon use this so genus and family
  pages still resolve (an earlier `speciesGroupOnly` here made those panels
  vanish entirely).

- **`PanelGallery`** GBIF tab — `gbifOccurrencesToImages(..., { names })`, then
  `new Image()` probe. Type specimens with no loadable image → a direct link
  each. If the auto-selected GBIF tab turns out links-only, the default hands
  off to iNaturalist / TaxonWorks (user can still pick GBIF).
- **`PanelGbifTypeSpecimens`** — one `limit=300` fetch, filter, client-side
  pagination; header count is the filtered count.
- **`PanelGbifImages`** — rebuilt on `/occurrence/search?…&mediaType=StillImage`
  (old `occurrence/experimental/multimedia/species` endpoint 404s everywhere);
  `limit=100`, filter, flatten `media[]`, slice 20.
- **`PanelGbifTaxon`** — a GBIF summary for the whole TW concept: one
  `limit=300` sample → name-filtered ratio + with-image / with-coordinate rates,
  scaled by `count` → **"~N occurrences — ~M with images, ~K georeferenced"**
  (`~` when estimated). Below it a **"Records by identified name"** `<details>`
  from `tallyOccurrenceNames`, split **Included** (this taxon on TaxonWorks) vs
  **Excluded** (GBIF folds in, not a TW synonym), each name with its sample
  count; plus a one-line "GBIF also folds N records identified as … into this
  key" summary. When the match's `acceptedUsage` is a *different* taxon (GBIF
  treats our name as a synonym) it hides the misleading accepted-taxon
  breadcrumb and shows *"GBIF treats X as a synonym of Y … filtered back to
  records identified as X"* — driven by the match response.
- **`PanelGbifMap`** — density-tile mode needs **two** signals to agree, since
  the tiles can't be name-filtered: (a) the 300-record probe has no
  out-of-concept names, **and** (b) `fetchGbifBackboneConcept` shows the
  backbone lists no synonym whose `epithetKey` is outside the TaxonWorks name
  set. Both → GBIF **hex-density tiles** (`/v2/map/occurrence/density`, all
  records, one `taxonKey`). Otherwise → **point markers**, name-filtered, paged
  to 3 × 300 = 900 (`L.circleMarker` via `--pp-gbif`), caption via
  `scopeCaption`. The (b) signal catches a lumped species whose records sort
  past the probe page.
  Basemap defaults to Dark Gray. `PanelGbifTaxon` states the match/mismatch in
  words too.

## Other GBIF gotchas

- **MNHN media (`mediaphoto.mnhn.fr`) is behind a Cloudflare managed challenge** —
  every URL returns 403 to a cross-origin `<img>` (no JS context to solve the
  challenge), in any browser, on any third-party site (gbif.org included). MNHN
  is a major weevil type-image contributor, so many type images simply can't be
  embedded. `PanelGallery` probes each image with `new Image()` and, for type
  specimens with no loadable image, shows a **direct link per record** instead.
- GBIF's image cache (`api.gbif.org/v1/image/cache/...`) needs signed requests;
  there is no usable unsigned proxy.
- `matchType: HIGHERRANK` from `v2/species/match` = the name isn't in the
  checklist and GBIF silently returned its genus. Treat as "no species match".
