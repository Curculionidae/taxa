# GBIF concept alignment: engine and PanelGbifTaxon redesign

Date: 2026-08-31
Status: design agreed, ready for implementation planning
Scope: `panels/_gbifShared/` engine plus `panels/PanelGbifTaxon/`. The other three
GBIF panels (Images, Map, Type specimens) do not change behaviour.

This revision folds in the API spike (section 5), the independent critique, and
the design conversation that followed (visualization, protonym matching, copy
rules). A visual reference for the target panel is `docs/gbif-viz-options.html`,
built against the real *Larinus latus* data.

## 1. Problem

TaxonWorks and GBIF do not always circumscribe "the same" taxon the same way. A
taxon is a set of names treated as synonymous, one of which is the valid name
that labels the set. Through the Catalogue of Life checklist, GBIF sometimes
folds in names TaxonWorks places under a different species, and sometimes keeps
apart names TaxonWorks unites.

Worked case, all live data (section 5). TaxonWorks *Larinus latus* (Herbst,
1783), name `834447`: synonyms *mutabilis*, *cynarae* (Herbst 1795),
*subcostatus*, *cirsii*, *costirostris*, *teretirostris*. Catalogue of Life
`Larinus latus` (usage `6NXFP`): folds in *Lixus cardui* (Rossi, 1790),
*Curculio pollinosus*, *Lixus longirostris*, plus one misapplied name.
TaxonWorks places *Larinus cardui* Rossi, 1790 under *Larinus cynarae*
(Fabricius, 1787), a different species, and keeps *subcostatus / costirostris /
teretirostris* inside *latus* where Catalogue of Life lists each as its own
provisionally accepted species. Of 1593 occurrence records under the Catalogue
of Life key, 931 (58 percent) are identified as *Lixus cardui*, the name
TaxonWorks assigns elsewhere.

The current `PanelGbifTaxon` shows a two circle Venn built from GBIF's backbone
synonym list, keyed by a lenient epithet stem. It shows which names fail to
overlap but not where the non overlapping names go, and it reads from the
backbone while the sibling panels are scoped to Catalogue of Life.

We assume the TaxonWorks synonymy is correct. GBIF is queried for the
TaxonWorks name set, and the panel reports how GBIF's grouping diverges.

## 2. Background and framing

Three papers in `docs/` inform the framing.

**Franz and Peet 2009** (`docs/S147720000800282X.pdf`). Two independently
published concepts of a taxon relate by exactly one of five relations:
congruent, included in, includes, overlaps, excludes. Non congruent cases are
described by adding or subtracting concepts on one side. A relation can be split
into an intensional component (agreement on the diagnosis) and an ostensive
component (agreement on the members or pointed at specimens). Their Figure 2
draws the five relations as overlapping or nested rectangles; that is the icon
this redesign uses beside the verdict sentence.

**Franz and Thau 2010** (`docs/admin,+NF_revised_3927-5382-1-PB.pdf`). The
intensional and ostensive components routinely disagree. Core information (a
revision's focal taxon, defined with types and synapomorphies and specimens) is
distinct from peripheral information (vague pointers at neighbours). A catalogue
is entirely peripheral; their literal example is Alonso-Zarazaga and Lyal 1999,
the Curculionoidea catalogue, which is this project's group. Alignments cannot
be fully automated and cannot judge on their own whether a divergence is
significant for a task.

**Rees, Franz and Sterner 2026** (https://bdj.pensoft.net/article/191754/).
Aligns checklists by shared exemplars, primarily the type specimens implied by
names. Two names sharing a protonym share a type and are the same nomenclatural
entity. This redesign uses that idea in a limited form for name matching
(section 4.4).

### Citations and attribution

The work is not based on one source alone. Which source underpins which part:

- **Name matching engine** (`gbifNameMatch.js`: the protonym based match keys,
  the `homotypic` / `probable` / `weak` tiers, section 4.4): cite
  **Rees, T., Franz, N.M. and Sterner, B. (2026). A scalable exemplar based
  method for aligning biological taxonomies. Biodiversity Data Journal 14:
  e191754. https://doi.org/10.3897/BDJ.14.e191754**. The `homotypic` tier is a
  lightweight application of their exemplar method: the type implied by each
  name is the tie point, in place of harvested occurrence level type material.
- **The two layer split and why `probable` is weaker than `homotypic`**:
  **Franz, N.M. and Thau, D. (2010). Biological taxonomy and ontology
  development: scope and limitations. Biodiversity Informatics 7: 45 to 66.**
  Nomenclatural identity is fixed by type specimen identity and must be
  modelled separately from taxonomic concept relations.
- **The concept relation side** (`conceptRelation.js`, the `≡ ⊂ ⊃ ><` verdict,
  the Figure 2 icon, the OST framing, the plus and minus reconciliation):
  **Franz, N.M. and Peet, R.K. (2009). Perspectives: Towards a language for
  mapping relationships among taxonomic concepts. Systematics and Biodiversity
  7 (1): 5 to 20.**
- **The secondary homonym point** (why the original combination, not just
  epithet plus author plus year, is required to prove name identity):
  standard nomenclatural theory from the International Code of Zoological
  Nomenclature, which Franz and Peet 2009 Appendix 1 itself draws on via
  Hawksworth 1994 and Berendsohn et al. 2003. The specific articles:
  - **Art. 53.3** — primary homonymy is names established in the same original
    genus; secondary homonymy is same spelled names later brought together in
    one genus. This is the cite for grading `homotypic` on the original
    combination rather than the current combination.
  - **Art. 57.2 and 57.3** — a junior primary homonym is permanently invalid; a
    junior secondary homonym is invalid but reinstatable. Why `probable`
    (epithet, author, year agree, shared type unconfirmed) cannot be promoted
    to `homotypic`.
  - **Art. 58** — the spelling variants the Code deems identical (ae/oe/e, i/y,
    -i/-ii, gender and connecting vowel differences, and the rest). What the
    `weak` tier's `epithetKey` loosely approximates.
  - **Art. 61** — the Principle of Typification. The Code term "objective
    synonym" (same name bearing type) is the `homotypic` tier.

  Local mirror of the Code:
  `/home/jakobj/Data/Literatur/Biodiversity_Data/ICZN/code.iczn.org`.

If a single citation is needed for the matching engine, it is Rees, Franz and
Sterner 2026.

### What the panel can and cannot assert

The panel assembles two name sets:

* `N`: the TaxonWorks valid name plus that OTU's TaxonWorks synonyms.
* `G`: the Catalogue of Life accepted usage that `N`'s valid name maps to, plus
  that usage's Catalogue of Life synonyms.

Comparing `N` and `G` is a name set comparison. From it the panel **can** state
one of the five relations for the clear cases, label it as based on which names
each source groups together, name the added and dropped names, and soften to
"relation X or relation Y" when matches are weak. It **cannot** assert an
intensional relation (Catalogue of Life carries no diagnosis), claim the full
membership ostensive relation (two sources can use one name yet disagree at the
margins), or place a TaxonWorks name that Catalogue of Life does not contain
(those are reported as not comparable).

The comparison is core against peripheral and asymmetric in information. The
panel says so rather than implying two equal authorities in conflict.

## 3. Goals and non goals

### Goals

1. An engine in `panels/_gbifShared/` that, given the TaxonWorks name and taxon
   id, returns a concept alignment model: a name graph with a per name match
   tier, the four zone breakdown, an RCC-5 relation with a confidence level,
   reconciliation terms, exact per name occurrence counts, and the entry point
   URLs.
2. A rebuilt `PanelGbifTaxon` that presents that model so a reader with no
   background understands what they are looking at, and a reader with background
   can audit every claim. Facts are shown as facts, the inferred relation is
   shown as inferred and always attributed, and nothing is dressed up as
   verified.
3. Exact occurrence counts over the whole GBIF record set, via faceted search,
   not a sample.
4. One taxonomy for the analysis: Catalogue of Life, the checklist the sibling
   panels query.

### Non goals

* No change to how Images, Map, or Type specimens filter. They keep filtering on
  `N`.
* No resolution or correction of the divergence. The panel describes it.
* No backbone versus Catalogue of Life "second opinion". The spike found the
  backbone lumps the same names Catalogue of Life does; the apparent
  disagreement was a homonym artefact (`Lixus cardui` Aurivillius 1921). No
  confirmed real divergence between the two exists in this project's taxa. The
  backbone appears only as an entry point link.
* No alignment bars, no data bearing Venn (name chips inside shapes). The zone
  table carries the data; the Figure 2 icon carries the relation.
* No diagnosis or specimen content comparison.

## 4. Conceptual model

Two layers, kept separate because nomenclatural relationships (who is a synonym
of whom) and taxonomic relationships (how the concepts relate) are semi
independent.

### 4.1 Layer 1: the name graph

One node per name that appears in `N`, in `G`, or as the other TaxonWorks home
of a name Catalogue of Life folds in. Each node carries:

| field | values |
|---|---|
| `name` | full name string, best available |
| `short` | name without authorship, for display |
| `authorYear` | `{ surname, year }` parsed from the name |
| `originalCombination` | for TaxonWorks nodes: `cached_original_combination` plus author and year |
| `colKey` | Catalogue of Life alphanumeric usage key, when known |
| `twRole` | `accepted`, `twSynonym`, `twElsewhere` (valid or synonym of a different OTU), `twAbsent`, `twUnknown` |
| `twPlacement` | when `twElsewhere`: `{ valid: bool, validName, otuId }` or `{ synonymOf: { name, otuId } }` |
| `colRole` | `accepted`, `colSynonym`, `colSeparateAccepted` (own accepted usage, provisional or not), `colMisapplied`, `colAbsent` |
| `matchTier` | `homotypic`, `probable`, `weak`, `none` (section 4.4) |
| `records` | exact count of GBIF records identified as this name, from the facet; may be 0; `null` when the name has no Catalogue of Life key to count against |

### 4.2 Layer 2: the concept relation

Derived from Layer 1 by set logic over the match keys of section 4.4.

Let `Nk` be the match keys of `N` restricted to names with a Catalogue of Life
match. Let `Gk` be the match keys of `G`, excluding `colMisapplied` names. Let
`unmatched` be the `N` names with no Catalogue of Life match.

Evaluate in this order:

1. If `Nk` and `Gk` share no key, or either is empty: **no comparison**. Render
   as a match failure, not as the disjoint relation.
2. Otherwise compute `nExtra` (`Nk` minus `Gk` non empty) and `gExtra` (`Gk`
   minus `Nk` non empty), and:

| condition | relation | symbol | OtuRelationship | plain reading |
|---|---|---|---|---|
| not `nExtra`, not `gExtra` | congruent | `≡` | `Equal` | Both use the same set of names for *X*. |
| not `nExtra`, `gExtra` | included in | `⊂` | `ProperPart` | Catalogue of Life's concept of *X* is broader. It groups in names TaxonWorks places elsewhere. |
| `nExtra`, not `gExtra` | includes | `⊃` | `ProperPartInverse` | Catalogue of Life's concept of *X* is narrower. It keeps apart names TaxonWorks unites under *X*. |
| `nExtra`, `gExtra` | overlaps | `><` | `PartiallyOverlapping` | TaxonWorks and Catalogue of Life share a core of N names for *X*, but each also files names under it that the other does not. |

`OtuRelationship::Intersecting` and `::Disjoint` exist in TaxonWorks but this
engine never emits them (disjoint becomes "no comparison"; intersecting is
unused). Noted so a maintainer cross checking the TaxonWorks vocabulary is not
surprised.

Headline counts use distinct resolved targets, not raw name strings. "Groups in
N names TaxonWorks places elsewhere" counts distinct match keys in `gExtra`, and
the noun stays "names TaxonWorks places elsewhere" until the reverse lookup
(section 5.1) returns a valid separate TaxonWorks species, at which point that
specific name may read "a species TaxonWorks keeps separate".

Confidence:

* `clear`: no `unmatched` names, the accepted name's Catalogue of Life match is
  `EXACT` and a plain accepted usage, and no match key the relation depends on
  is `weak` tier.
* `provisional`: one or two `unmatched` names, or a `FUZZY` accepted match, or
  the accepted name resolves through a synonym chain, or the relation depends on
  a `weak` tier key. The relation stands; the wording hedges and states how many
  names could be checked.
* `uncertain`: the accepted name is itself only an ambiguous synonym, or the
  Catalogue of Life synonymy failed to load and `G` was reconstructed from the
  occurrence facet name set. The panel shows "relation X or relation Y" using
  the nearest neighbouring relation and leads with the softer one.

Catalogue of Life `AMBIGUOUS_SYNONYM` status on a member of `G` does **not**
lower confidence. It is a nomenclatural status (the epithet has been applied to
more than one taxon historically), not a statement that Catalogue of Life is
unsure the name belongs here. It appears as a per row note in the table.

Reconciliation terms, always computed:

* `adds` = distinct match keys in `G` not in `N`
* `drops` = distinct match keys in `N` not in `G`

Intensional component: not assessed. Stated once.

### 4.3 The four zones

Names are grouped for display. Column headers name each concept (section 8.5),
so zone headings and cells name a taxon only when pointing at a different one.

| zone | membership | extra detail shown |
|---|---|---|
| **In both circumscriptions of *X*** | match key in both `Nk` and `Gk` | `records` per name, `matchTier` tag |
| **TaxonWorks files under *X*; Catalogue of Life keeps separate** | `N` names whose match key is not in `Gk` | each name's `colRole` (`colSeparateAccepted`, provisional or not) |
| **Catalogue of Life files under *X*; TaxonWorks places elsewhere** | `G` names whose match key is not in `Nk` | each name's `twPlacement` from the reverse lookup; expand row shows the other genus combinations of the same name |
| **Misapplied to *X* in Catalogue of Life** | `G` names with `colMisapplied` | listed, excluded from `Gk` and the relation |
| **In the occurrence records, in neither circumscription of *X*** | facet names not resolved into the graph (BOLD BIN placeholders, blank names) | record count only |
| Not comparable | the `unmatched` `N` names | listed on their own |

### 4.4 Name matching: three tiers

The verdict must not rest on a lenient epithet stem (`epithetKey('Larinus
latus')` is `'lat'`, shared by every *-latus* weevil, and it conflates *Lixus
cardui* Rossi 1790 with *Lixus cardui* Aurivillius 1921). Match keys are built
from epithet plus normalised author surname plus year, and each match carries a
tier.

Author surname normalisation: take the family name token, drop initials and
particles (`de`, `van`, `von`), lowercase, keep the four digit year. `Herbst`,
`J.F.W.Herbst`, `Herbst, J.F.W.` all reduce to `herbst`. GBIF's
`/v1/parser/name` (a plain GET on `api.gbif.org`) may be used, or a local
reducer of about 30 lines.

| tier | test | meaning |
|---|---|---|
| `homotypic` | the TaxonWorks node's `original_combination` string (genus plus epithet plus author) is present verbatim in `G`'s name set for this concept, or a ChecklistBank `basionymId` link agrees | proven same name, shares the type |
| `probable` | epithet plus normalised surname plus year agree, year allowed to differ by one | almost certainly the same name; a secondary homonym sharing surname and year is not fully ruled out |
| `weak` | epithet plus surname agree, year differs by more than one or is missing; or only the gender tolerant epithet stem matches | last resort, flagged, downgrades confidence where the relation depends on it |
| `none` | no match | the `N` name is `unmatched`; the `G` name is a genuine fold in |

`epithetKey` from `gbifNameFilter.js` is kept only as the input to the `weak`
tier fallback.

## 5. Data sources

All calls read only, all on `api.gbif.org` or the project TaxonWorks API.
`CHECKLIST_KEY` is the existing Catalogue of Life dataset UUID.

### 5.1 TaxonWorks

* valid name: props via `deriveScientificName`, unchanged.
* `N` synonyms: `fetchTwSynonymNames(taxonId)`, unchanged. Confirm the list
  response carries `cached_original_combination` and `original_combination`; if
  not, one batched `/taxon_names?taxon_name_id[]=...` adding those fields.
* reverse placement for a Catalogue of Life folded in name: `/taxon_names?name=`
  (or the closest exact name parameter), then read `cached_is_valid` and
  `cached_valid_taxon_name_id`, and for an invalid name resolve the valid name
  and OTU. Lazy: run when the "TaxonWorks places elsewhere" zone is first
  expanded. Cache per name string. Run once per distinct match key target, not
  once per name string. Cap at 6 targets; beyond that show "and N more" without
  lookups. Multiple hits for one string return `ambiguous`; the panel says so
  rather than guessing.

### 5.2 GBIF, Catalogue of Life scope

The spike settled the endpoint shape. Two key spaces are in play and must not be
mixed:

* `/v2/species/match?checklistKey=<CoL>` returns an alphanumeric usage key (for
  example `6NXFP`). Occurrence search `taxonKey` wants this alphanumeric key.
* `/v1/species?datasetKey=<CoL UUID>&name=<canonical>` returns the same usage
  carrying both the alphanumeric `taxonID` and an integer `key` (for example
  `297459661`). `/v1/species/{key}/synonyms` wants the integer key; the
  alphanumeric key is rejected there.

`gbifChecklistConcept.js`:

1. `/v1/species?datasetKey=<CoL UUID>&name=<valid canonical>` to get the
   integer key and the accepted usage (follow to the accepted key if the name
   resolves as a synonym).
2. `/v1/species/{intKey}` for the accepted usage detail, and
   `/v1/species/{intKey}/synonyms?limit=200` for the synonym list. Each synonym
   carries `taxonomicStatus` (`HETEROTYPIC_SYNONYM`, `SYNONYM`, `MISAPPLIED`,
   and so on). `MISAPPLIED` maps to `colMisapplied`.
3. Homotypy check: for each `G` name, test whether it equals a TaxonWorks
   node's `original_combination` string. Where ChecklistBank is reachable and a
   `basionymId` is populated, use it as a second confirmation. ChecklistBank is
   only a confirmation source here, never the primary synonymy source; version
   skew between GBIF's Catalogue of Life copy and ChecklistBank `3LR` is real,
   so the primary synonymy and the counts stay on GBIF's copy.

If step 1 or 2 fails: reconstruct `G` from the occurrence facet name set,
`confidence` becomes `uncertain`, and the explainer gains a line "GBIF synonymy
could not be loaded; the comparison uses only the names seen in occurrence
data".

### 5.3 GBIF occurrence counts

`resolveGbifTaxonScope` already yields the union of Catalogue of Life keys for
`N`'s valid name and every TaxonWorks synonym. Facet across that whole union so
names Catalogue of Life files under other concepts are also counted:

* `GET /v1/occurrence/search?taxonKey=<each key>&checklistKey=<CoL>&limit=0&facet=scientificName&facetLimit=200`
  returns `facets[0].counts[]` as `{ name, count }`. The field comes back as
  `SCIENTIFIC_NAME`. Reduce each name with `canonicalName`, sum authorship
  variants, key by the section 4.4 match key.
* summary line, three `limit=0` calls reading `count`: plain; plus
  `mediaType=StillImage`; plus `hasCoordinate=true`.

Facet names like `BOLD:ADP3844` (no space, BIN placeholder) are filtered into
`inDataNotInModel`, which is routinely non empty on beetle taxa. A single
species facet holds a handful of names, so there is no cap handling and no
paging.

### 5.4 Call budget on a species page

Taxonomy: 1 match per `N` name (cached, usually 1 to 4), 1 checklist concept
call plus 1 synonyms call, optionally 1 batched `/taxon_names` for original
combinations. Counts: 1 facet call, 3 count calls. No record payloads at any
point. The backbone match call the old panel made is dropped.

Reverse lookups: one `fetchTwPlacement` per `colFoldsIn` row, fired in parallel
on load, `N` = the `colFoldsIn` row count, typically 1 to 5. Each is up to three
GETs (`/taxon_names?name=`, `/taxon_names/:id`, `/otus`), cached per name string
in `placementCache` so navigation and revisits do not re-pay it. This changed
from "0 on load" once the round 4 redesign removed the per-row `<details>`
expansion: the per-row relation icon and the inline "TaxonWorks places it under
X" link are always visible, so there is no expand event to hang a lazy fetch on,
and a lazy fill would leave the icon column blank until every row is opened.

## 6. Engine modules

Under `panels/_gbifShared/`, plain relative imports, no `main.js`.

| file | status | exports | notes |
|---|---|---|---|
| `conceptRelation.js` | new, pure | `deriveRelation(Nk, Gk)`, `relationLabel(relation, taxonName)`, `RELATIONS` | Section 4.2 logic and vocabulary: symbol, `OtuRelationship` name, plain reading, neighbouring relation for the uncertain case, the Figure 2 icon id. No IO. Fully unit tested. |
| `gbifNameMatch.js` | new, pure | `normalizeSurname(s)`, `matchKey(name, { originalCombination })`, `matchTier(twNode, colName, colNameSet)` | Section 4.4. The three tier logic and the author surname reducer. No IO. Unit tested. |
| `gbifChecklistConcept.js` | new | `fetchChecklistConcept(validName, twNodes, { checklistKey })` returns `{ accepted: { name, alphaKey, intKey }, synonyms: [{ name, status, matchTier }], misapplied: [...] }` or `null` | Section 5.2. Module level promise cache. |
| `gbifConceptAlignment.js` | new | `resolveConceptAlignment(primaryName, taxonId, opts)` returns the model in section 7; `fetchTwPlacement(nameString)` for the lazy reverse lookup | Orchestrator. Runs the TaxonWorks and Catalogue of Life fetches and the facet and count calls, builds the name graph and zones, calls `deriveRelation`, assembles the URLs. Memoised per page load like `resolveGbifTaxonScope`. |
| `gbifBackboneConcept.js` | keep, revise docstring | unchanged signature | No longer used by `PanelGbifTaxon`. `PanelGbifMap` still calls it for its density gate; leave it. Docstring notes it is unused here as of 2026-08-31 and why (backbone and Catalogue of Life agree on lumping; the old use matched homonyms). |
| `gbifNameFilter.js` | keep, unchanged | | `canonicalName`, `epithetKey`, `shortName` reused. `epithetKey` now only feeds the `weak` tier. |
| `gbifTaxonScope.js`, `twSynonymNames.js`, `useGbifMatch.js` | keep, unchanged | | Still used by all four panels. `resolveConceptAlignment` reuses `fetchTwSynonymNames`, `matchGbifKey`, and `resolveGbifTaxonScope`'s key union. |

## 7. The alignment model object

`resolveConceptAlignment` returns:

```
{
  matched: boolean,          // false: no confident Catalogue of Life match, panel shows only the no-match line
  rankEligible: boolean,     // reuses isSpeciesGroupMatch / rejectHigherRank; false suppresses the comparison
  twName: string,            // TaxonWorks valid name, display
  colAcceptedName: string,   // Catalogue of Life accepted name for this concept (may differ from twName on a synonym page)
  checklist: { key, label }, // { CHECKLIST_KEY, 'Catalogue of Life' }

  tw:   { accepted: string, synonyms: string[] },   // N
  gbif: { accepted: { name, alphaKey, intKey },
          ourNameIsColSynonym: boolean, ourColTarget: { name, alphaKey } | null },

  nameGraph: [ NameNode ],   // Layer 1, section 4.1

  zones: {
    consensus:   [ NameNode ],
    twKeepsIn:   [ NameNode ],
    colFoldsIn:  [ NameNode ],   // each: twPlacement filled lazily, otherCombinations: string[]
    misapplied:  [ NameNode ],
    inDataOnly:  [{ name, count }],
    notComparable: [ string ]
  },

  relation: {
    symbol: '≡' | '⊂' | '⊃' | '><' | null,
    icon: 'congruent' | 'included' | 'includes' | 'overlap' | 'none',
    otuRelationship: 'Equal' | 'ProperPart' | 'ProperPartInverse' | 'PartiallyOverlapping' | null,
    plain: string,             // already has twName / colAcceptedName substituted
    sharedCount: number,
    confidence: 'clear' | 'provisional' | 'uncertain',
    alternative: { symbol, icon, plain } | null,
    reconciliation: { adds: string[], drops: string[] },
    intAssessed: false,
    checkedNames: number,
    totalNames: number
  },

  counts: {
    total: number, withImage: number, withCoordinate: number,
    byMatchKey: Map<string, number>
  },

  urls: {
    colTaxon: string,           // www.gbif.org/taxon/<alphaKey>
    backboneTaxon: string,      // www.gbif.org/species/<backbone key from a match call, one call, only for the link>
    backboneOccurrence: string, // occurrence search taxon_key=<backbone key>, no checklist_key
    scopedOccurrence: string    // checklist_key=<CoL> + taxon_key per scope key
  }
}
```

`backboneTaxon` and `backboneOccurrence` need the backbone integer key. That is
one `/v1/species/match?name=` call whose only purpose is the two links; it does
not feed any comparison.

## 8. PanelGbifTaxon layout

Top to bottom. Card header keeps the GBIF mark and `PanelDropdown`; the title
becomes `<em>{twName}</em> in GBIF` (fallback "This taxon in GBIF" only when the
name is missing). All colour via tokens: `--pp-tw` and `--pp-gbif` for the two
sources, `bg-base-foreground` and `text-base-content` for surfaces,
`text-base-soft` for labels only, `border-base-muted` for separators. No
Tailwind default palette, no hex or rgb in the component. Content sits on
`bg-base-foreground`.

### 8.1 Matched name line

The Catalogue of Life accepted usage, italic, then one clause:

* accepted: "accepted in Catalogue of Life."
* our valid name is a Catalogue of Life synonym: "Catalogue of Life treats
  *{twName}* as a synonym of *{colAcceptedName}* and files its records there.
  The comparison below is against *{colAcceptedName}*."

If `matched` is false: only "No confident match could be found on GBIF for
*{twName}*." If `rankEligible` is false: this line, the occurrence summary, the
entry point links, and "Concept comparison is shown for species and lower
ranks." No verdict, no table.

### 8.2 Relation statement

A flex row: the Figure 2 icon (inline SVG, about 60 by 34, two `rect`s filled
`var(--pp-tw)` and `var(--pp-gbif)` at low opacity, shaped per `relation.icon`),
then the text.

Line 1 is `relation.plain`, which already has the names substituted, for
example: "TaxonWorks and Catalogue of Life share a core of 4 names for *Larinus
latus*, but each also files names under it that the other does not." For
`uncertain`, line 1 is `alternative.plain` then ", or " then `relation.plain`,
softer first.

Line 2, small, `text-base-soft`, middle dot separated:

1. `TaxonWorks {symbol} Catalogue of Life`, `{symbol}` monospace, "TaxonWorks"
   tinted `--pp-tw`, "Catalogue of Life" tinted `--pp-gbif`
2. "by name overlap"
3. a "how this is measured" button toggling 8.3

When `confidence` is `provisional`: append ", {checkedNames} of {totalNames}
TaxonWorks names could be checked against Catalogue of Life".

### 8.3 How this is measured, collapsed by default

One paragraph, four sentences, `text-xs`, with a `border-base-muted` top rule:

> This compares the names TaxonWorks treats as *{twName}* with the names
> Catalogue of Life groups under its own *{colAcceptedName}*. Each name is
> matched by its epithet, author and year, and where the original combination
> lines up on both sides the names are confirmed to share a type. It does not
> compare written diagnoses or the specimen records behind either concept. GBIF
> here is an aggregated checklist, not an authored revision, so read the result
> as a starting point for a person to judge.

### 8.4 Zone table

The data element. `<table>`, plain flow, no positioned layout. Columns: Name,
`TaxonWorks: {twName}`, a relation icon, `Catalogue of Life: {colAcceptedName}`,
GBIF records. The icon column sits **between** the two source columns and holds a
small Franz and Peet Figure 2 glyph for that one name's relation across the two
sources (`congruent` for the shared zone, `includes` = TaxonWorks broader for
`twKeepsIn`, `included` = Catalogue of Life broader or `overlap` for `colFoldsIn`
depending on the resolved placement, disjoint for misapplied, nothing for the
data only and not comparable rows). Rows grouped under the section 4.3 zone
headings in that order, each heading a full width row (`colspan` all five
columns) with a left accent (`--pp-tw`, `--pp-gbif`, or neutral for the shared
and data only groups).

Names and record counts in the table are plain text, never links: the only
links in the table body are the blue `--pp-tw` TaxonPages links on the
`colFoldsIn` placement entry (see below). The Catalogue of Life accepted taxon
keeps its link, in the "Open in GBIF" line (section 8.7), not in the header.

Cell wording, terse, a taxon named only when different from the column's:

* TaxonWorks column: "valid name", "synonym" for the shared and `twKeepsIn`
  rows; for `colFoldsIn`, the resolved placement as an inline entry:
  "synonym of *{Z}* ({author})" or "*{Z}* ({author}), valid species", with
  *{Z}* a blue `RouterLink` to that concept's OTU page when the OTU resolves
  (plain italic otherwise); "not in TaxonWorks"; "more than one match in
  TaxonWorks"; "—" for misapplied and data only rows. A small inline spinner
  shows while the placement lookup is in flight.
* Catalogue of Life column: "accepted name", "synonym", "separate accepted
  species" (plus " (provisional)" when the usage is provisional), "misapplied,
  excluded".
* GBIF records: exact facet count, right aligned, `tabular-nums`, 0 at reduced
  opacity, blank (not 0, not a dash) when the name has no key to count.

Match tier tag: a small inline tag after the name, `homotypic` or `probable` or
`weak`, `title` giving the reason. On `weak` the tag is more prominent since it
affects confidence.

A `colFoldsIn` row is a plain `<tr>`, no disclosure. The other genus
combinations of the same name in Catalogue of Life are a small faint sub line
under the name ("also written *X*, *Y* in Catalogue of Life"); the TaxonWorks
placement is the inline entry described above, resolved on load (section 5.4).

Only zone headings, `<th>`, and the "also written" sub line (an annotation, not
a value) may be faint. Every value cell is full contrast.

### 8.5 Column headers carry the referent

The two source columns are headed with the party and that concept's accepted
name. On a synonym page the two names differ (`TaxonWorks: Lixus cardui` and
`Catalogue of Life: Larinus latus`), which is itself the headline divergence.
Cells then never say "this taxon", "this concept", or "here"; they name a taxon
only when it is a different one.

### 8.6 Occurrence summary

Exact, no approximation marks, framed as current holdings, one line:

> GBIF holds **{total}** records ({withImage} imaged, {withCoordinate} mapped).

The `{total}` is a link to the scoped occurrence search. The parenthetical is
dropped when either sub count is not a number. The dominant identified name
sentence the earlier draft carried is **removed**: the `colFoldsIn` placement
entry in the zone table now states which TaxonWorks concept each folded in name
maps to, so the summary does not repeat it (and it no longer needs a reverse
lookup of its own). If `zones.inDataOnly` is non empty, add a `text-xs` line:
"{sum} further records carry names not resolved into the comparison above (for
example BIN placeholders)."

### 8.7 Open in GBIF

One `text-xs` line near the bottom: "Open in GBIF:" then up to four links,
middot separated, each carrying its explanatory clause as a `title` tooltip
rather than inline text, and each omitted when its URL is null:

* Catalogue of Life — the taxonomy the panels here use (`urls.colTaxon`).
* backbone — GBIF's default view, which may group the names differently.
* all occurrences — everything GBIF has, grouped GBIF's default way, not
  filtered by this project.
* panel set — the filtered set behind Images, Map and Type specimens.

(The earlier draft called for a multi line labelled list; it was compressed to
one line in the round 4 UI pass.)

### 8.8 Request store

Register the checklist concept call and the facet call with
`useOtuPageRequestStore` under `panel:gbif-taxon`, as the current panel
registers its match and summary calls.

## 9. Trust calibration, explicit rules

1. Layer 1 is fact and is shown plainly: who is a synonym of whom in each
   source, the match tier, the record count per name.
2. Layer 2 is an inference and never loses its qualifier. Line 2 of 8.2 always
   carries "by name overlap", and the confidence word is in the model even when
   only `provisional` and `uncertain` add visible text.
3. No "verified", no check marks, no success colouring on the relation. The
   strongest positive statement is "Both use the same set of names for *{X}*",
   which is checkable in the table.
4. Every number is attributed to GBIF and to "currently". Every relation is
   attributed to Catalogue of Life and named as a checklist comparison.
5. One explainer paragraph on the surface, the audit detail in the table, one
   summary line. Nothing more.
6. The panel never proposes an edit, never says TaxonWorks or GBIF is wrong,
   never auto resolves.
7. No "this taxon", "this concept", "here", or "the matching concept" anywhere
   on the surface. Referents are the column headers; anything else is named,
   always the relevant name in italics.
8. No dashes in any copy string. Use commas, colons, parentheses, or split the
   sentence.

## 10. Edge cases

1. No confident Catalogue of Life match for the valid name: `matched` false.
2. `N` and `G` both have no synonyms: `≡`, one calm line, no table. Summary
   still shown.
3. The valid name is itself a Catalogue of Life synonym: 8.1 explains the
   redirect, `G` is built from the accepted target, the relation still computes.
4. Genus or family page: `rankEligible` false, see 8.1. Reuses the existing
   `isSpeciesGroupMatch` / `rejectHigherRank` gate, no new rank concept.
5. Some `N` names unmatched in Catalogue of Life: listed under Not comparable,
   excluded from `Nk`, confidence at least `provisional`, count stated in 8.2.
6. `/v1/species?datasetKey=&name=` returns several usages: prefer the accepted
   one, then an exact author match; if still ambiguous, treat as a failed
   synonymy load (degraded mode).
7. Synonymy load fails entirely: reconstruct `G` from the facet name set,
   `confidence` `uncertain`, explainer line added.
8. Server side render: fetching in `onMounted` and watchers, guarded by
   `typeof window`. Until mounted the panel renders the header only. This is
   stricter than `PanelGbifImages` today; apply it here and note it in the
   panel readme.
9. Stale OTU navigation: capture `forName = scientificName.value` at the start
   of each fetch, bail on mismatch, as the current panel does.
10. Reverse lookup returns several TaxonWorks names for one string: node
    `matchTier` unaffected, table cell reads "more than one match in
    TaxonWorks", the row still renders.
11. Any secondary call fails (counts, a reverse lookup, the backbone key for the
    links): that piece degrades to "not loaded" text or a missing link, the
    relation and zones still render.
12. `counts.byMatchKey` has a key the graph does not: it went to
    `zones.inDataOnly` already; do not force it into a zone.
13. Author with no year in either source: match key falls to `weak` tier.

## 11. Loading and empty states

* Card visible once the header renders. Body shows the existing `VSpinner`
  until the taxonomy layer resolves.
* Counts arrive with or just after the taxonomy layer; until then the records
  column shows nothing and the summary line reads "loading record counts".
* Reverse lookups show a per row spinner on first expand only.
* Error resolving the taxonomy layer: "Could not load the GBIF comparison."
  plus the entry point links, matching current error handling.

## 12. Testing

Pure unit tests, no network:

* `conceptRelation.deriveRelation`: a table covering `≡`, `⊂`, `⊃`, `><`, and
  the no intersection case, each also in a variant with one unmatched `N` name;
  assert symbol, `icon`, `otuRelationship`, `confidence`, `alternative`,
  `reconciliation`.
* `conceptRelation.relationLabel`: the plain strings with names substituted, and
  the `OtuRelationship` names, for every relation.
* `gbifNameMatch.normalizeSurname`: `Herbst`, `J.F.W.Herbst`, `Herbst, J.F.W.`,
  `(P.Rossi, 1790)`, `de Motschulsky`, multiple authors, all reduce as
  specified.
* `gbifNameMatch.matchTier`: `homotypic` when the original combination string is
  in the Catalogue of Life name set; `probable` on epithet plus surname plus
  year, including the *mutabilis* Host 1789 versus 1790 one year case; `weak`
  when only the epithet stem matches; the *Lixus cardui* Rossi 1790 versus
  Aurivillius 1921 pair must key apart.
* zone assembly in `gbifConceptAlignment` with mocked inputs: the *Larinus
  latus* case must produce `><`, `sharedCount` 4, `zones.colFoldsIn` containing
  *Lixus cardui* with `records` 931 and a TaxonWorks placement of *Larinus
  cynarae* (Fabricius, 1787), `zones.twKeepsIn` containing *subcostatus*,
  *costirostris*, *teretirostris* each as a separate provisional Catalogue of
  Life species, `reconciliation.adds` and `.drops` with three keys each.
* facet reduction: authorship variants of one name collapse to one match key and
  sum; `BOLD:` names go to `inDataOnly`.

Fixtures under `panels/_gbifShared/__fixtures__/`: captured responses for the
*Larinus latus* overlap case (TaxonWorks synonyms and relationships, the
Catalogue of Life species and synonyms calls, the facet call, the three count
calls), plus a congruent case and a no match case. Pin the assertions to the
captured payloads, since `adds` contents vary by Catalogue of Life release.

Manual checklist: the four relation shapes render with the right icon; dark mode
keeps every value readable; the explainer and the table toggle independently; a
genus page shows only the short form; an offline secondary call does not blank
the panel; the *Lixus cardui* synonym page shows differing column headers.

## 13. Cleanup and migration

* `PanelGbifTaxon.vue`: the `nameVenn` computed, the `gv-*` template, and the
  `.gbif-venn` and `.gv-*` styles are removed. `synonymNote`, the sampled
  `summary`, `approx`, `overlap`, `twOnly`, `excludedTotal`, `lumpedList` are
  replaced by the section 7 model. The classification breadcrumb is removed
  (the relation statement and matched name line replace its orientation role;
  confirm with the user during review).
* `gbifBackboneConcept.js`: kept for `PanelGbifMap`, docstring updated.
* `resolveGbifTaxonScope`: unchanged, still used for the scoped occurrence link
  and the facet key union.
* `panels/_gbifShared/readme.md`: add the four new module rows, rewrite "The
  GBIF synonymy problem" to describe the alignment model, mark the Venn
  replaced, and record the backbone finding.
* `panels/PanelGbifTaxon/readme.md`: rewrite for the alignment model, the two
  layers, the Catalogue of Life choice, the three match tiers, and the SSR
  guard note.
* Memory: after implementation update `project_gbif_type_images_gallery.md` and
  `reference_gbif_synonymy_lumping.md` (the backbone correction is already in),
  and add a memory for the alignment engine.

## 14. Open questions for the planning stage

1. Does `fetchTwSynonymNames`'s list response already carry
   `cached_original_combination` and `original_combination`? If yes, no extra
   call; if no, one batched `/taxon_names` fetch.
2. Confirm the classification breadcrumb should be dropped rather than kept as a
   collapsed line.
3. Copy review of the 8.3 paragraph and the 8.2 lines with the user.
