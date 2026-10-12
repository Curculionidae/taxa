# PanelBiologicalAssociationsV2

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.5.4 (npm package setup)

New experimental panel (`panel:biological-associations-v2`) displaying biological associations for a taxon. Based on the built-in `panel:biological-associations` panel.

Added features: with inline depictions, asserted distributions, and citations that can be clicked to show the full reference. URLs in references are clickable both in the citation popup and the image popup. 

> This panel was developed by vibe coding with [Claude.ai](https://claude.ai).

## Setup

Put this directory (PanelBiologicalAssociationsV2) into the panels folder on the setup branch of your TaxonPages. Add the panel to your `taxa_page.yml` layout:

```yaml
- panel:biological-associations-v2
```

## Field Assistant, Advanced and Raw data views

By default the panel opens in the **Field Assistant** on every taxonomic rank. The buttons at
the upper left select **Field Assistant**, **Advanced**, and **Raw data**. Raw data
preserves the original detailed table, family/genus summaries, citations, images
and specimen modals.

The chosen view is remembered for the next taxon page and for a newly opened
tab, the same way the Advanced column settings are: it is held in localStorage
and validated by the shared browser-session cookie, so it is not scoped to one
rank or target group, and it expires with the browser session. Someone
comparing several taxa in Advanced therefore keeps Advanced. The view is
restored on mount rather than in the initial state, because the server renders
this panel too and has no storage to read; both renders start in the Field
Assistant, and the restored view is in place before the first request. A
Records drilldown into Raw data is a round trip with its own back button and
does not overwrite the saved view; only the three buttons do. A stored view
this panel no longer has falls back to the Field Assistant.

> In code the first view is still called `standard`: `viewMode === 'standard'`,
> `StandardAssociationsTable.vue`, `standardEvidence.js`. Only its label changed.

The Field Assistant lists the **opposite side** of each association: a beetle page
lists associated plants, and a plant page lists associated beetles. The current
taxon is omitted from the table. If the page's taxon appears in both directions,
the lists remain separate. Descendant taxa are included on genus/family/higher
pages.

- The Field Assistant answers where it is worth looking for this beetle, so it
  **grades** its records rather than filtering them: each record is **green**
  (strong evidence), **orange** (moderate) or **red** (weak or vague). The grade
  depends on two things — the **stage** carried by the Subject's anatomical part
  (`egg`, `larva`, `pupa`, `nidus`, `adult`) and the **relationship**.
  **Which combination earns which colour is not hard-coded: it is the table in
  `evidenceRules.js`**, one line `[stage, relationship, colour]` per case, with
  `'*'` for "any". The most specific line wins regardless of its position
  (stage + relationship before stage + `*` before `*` + relationship before
  `*` + `*`), so `['pupa', '*', 'red']` plus
  `['pupa', 'reared from galls on', 'green']` reads exactly like the rule it
  states. The same file folds spellings (`larvae` → `larva`), says which stage a
  Subject with **no** anatomical part counts as (`NO_STAGE_COUNTS_AS`, currently
  `adult` — this covers most OTU and specimen records and every `[legacy]`
  one), and holds the short label of each colour. A wrong colour or a
  stage/relationship pair listed twice is reported in the browser console.
  Relationship names must match TaxonWorks (case is ignored); a misspelt one
  simply never matches and falls through to the `*` lines. Nothing is hidden: an
  earlier version kept the weaker grades behind a *Show uncertain records*
  switch, which made a plant with no records and a plant with poor records look
  exactly alike. The switch is gone.
- Each row aggregates the records of one associated taxon and can therefore mix
  evidence. It carries **one glowing dot**, the **best** category it has any
  record in: green before orange before red. In the field the question is how good
  the strongest evidence for this plant is, not how the pile splits — that
  breakdown is one tap away (below). The dot's priority order is
  `STANDARD_MARK_STYLES` itself, so it cannot drift from the legend. The count
  beside it sits left-aligned in a box as wide as the widest count in the table,
  so the dots read as one column down the table whether a row counts 1, 10 or
  100 records.
- What green, orange and red **mean** is the same for every row, so it lives once
  in the **Records** column heading, behind the same ⓘ control the Anatomical
  parts heading uses — not repeated in each row. `EvidenceLegendInfo.vue` reads
  `STANDARD_MARK_STYLES` from `standardEvidence.js`, the very list the rows
  render from, and lists under each colour the cases it covers, generated from
  the `evidenceRules.js` table — so editing the table updates the legend too.
- How a **particular row** splits between the categories is the row's own data,
  so it stays at the row: the dot is a **control**, and opening it shows that
  row's full breakdown (“Dianthus carthusianorum — 7 records”, then a line per
  category it actually has). The simplification is in the picture, not in the
  data. Pointing devices get it on hover; a tap or Enter opens it on a touch
  screen, where the native `title` it replaced never appeared at all. Its
  accessible name carries the whole breakdown (“Evidence for …: 3 of 13 records:
  weak or vague evidence”), so a screen reader needs no opening at all, and the dot
  itself is `aria-hidden` decoration. The visible disc stays 8 px, but the
  control is 24 px on both axes and sits 0.75 rem from the count button, so the
  tap target meets WCAG 2.5.8 without changing row height or the dot column's
  alignment. One popover serves the whole table and its anchor moves to the
  active row, rather than one composable instance per row.
- The dot carries no text, so copying the table is unaffected: the control holds
  only an empty span, its breakdown is an `aria-label`, and only the heading's
  ⓘ is marked `data-copy-ignore`. An empty table reads “No records found.” —
  with nothing filtered out, there is no second case to distinguish.
- The four columns are **Anatomical parts**, **Family**, **Associated taxon** and
  a clickable **Records** count. The first column always describes the plant:
  it comes from the associated plant on a beetle page and from the current
  plant on a plant page. The Field Assistant maps the recorded terms to the curated
  Plant Ontology display groups leaf, flower, stem, root and the coupled
  fruit/seed group. Bud has its own icon. The information
  control in the column heading lists every unique underlying term in the
  currently displayed page and any required simplification note. Terms without
  a valid existing icon remain text instead of receiving a biologically
  incorrect image. Raw data view keeps every original term.
- Associated taxa use the compact `Genus species` form. Subgenera, authors and
  years are omitted in Field Assistant; Raw data view retains the complete labels.
- Rows combine OTU, FieldOccurrence and CollectionObject associations, including
  AnatomicalParts wrapping those entities. A direct OTU association is not needed.
- Underlying OTUs are joined by their TaxonName ID, so different OTUs of the same
  taxon combine. Labels alone never merge potentially unrelated taxa.
- Field Assistant higher-rank pages collect both complete Basic-index directions before
  rendering the table. This prevents provisional counts, repeated Vue table
  renders and background enrichment from slowing Firefox. OTU names and the
  required specimen details are resolved in bounded batches before the single
  final table update.
- Raw data view takes each name from the participant's `otu_tag` span, with
  TaxonWorks' own italics, and follows the OTU naming rule every display shares
  (`../_shared/readme.md`, "otuTag.js and otuLink.js"): an OTU whose own
  name differs from its taxon name (`Carex L. Carex sp.`) reads "Carex sp." and
  links to the page of its taxon, Carex L.; one whose own name only repeats the
  taxon name shows the taxon name. A specimen row is not redirected, it links
  to the OTU it is filed under. An association recorded against a genus OTU
  reads "*Carex* L."; only a specimen determined to genus reads "*Carex* sp.".
  The Field Assistant view is unaffected: it groups by TaxonName and already
  shows and links the taxon.
- Associations stored under nomenclatural synonyms and combinations are included
  through TaxonWorks' `coordinatify` OTU expansion. The Field Assistant groups them under
  `cached_valid_taxon_name_id`, displays the accepted name and links its accepted
  OTU page. Raw data view retains each association's originally recorded name and
  its link to the OTU the association was recorded against, and prints the
  accepted name after it as `<name> now <accepted name>`, linked to the accepted
  OTU -- the record stays as entered while the OTU that actually carries the
  records is one click away. TaxonWorks writes that `now` construct into the
  `object_tag` of a synonym OTU itself but not into a combination's (which gets a
  `[c]` marker instead), so `extractNameHtml()` drops the tag's own copy whenever
  `resolveAcceptedNames()` supplied one, and both cases render through the same
  linked path.
- An Object without an AnatomicalPart names the plant rather than an organ of
  it. Both views leave the cell blank: every one of those rows is about a plant
  already, so a whole-plant filler repeated the column heading and told nobody
  anything. The Field Assistant's icon and its `PO:0000003` mapping were removed
  with it, `makeStandardParticipant()` no longer reports `hasAnatomicalPart`, and
  **Advanced view** dropped its **on plant** text in turn.
- The rows of all three views read at `text-sm`, set on the cells in the panel's
  own style block. TaxonPages' `VTableBody` puts `text-xs` on the `tbody`, a step
  below the panels next to this one — Descendants and synonyms, Nomenclature and
  Type all render their content at `text-sm` — and reading down the page should
  not mean changing text size. Column headings keep the package's `text-xs`, the
  size the Stats panel's headings read at. In the Field Assistant the family heading
  and the direction heading both stay at the row size and separate themselves by
  weight and spacing.
- Rows sort by family and associated taxon. Missing families sort last.
  Pagination is applied after aggregation.
- Explicit `Not available` and `Not specified` anatomy and missing
  classification render as blank cells. Biological properties are not
  interpreted as anatomy.
- The Field Assistant table omits the Relationship column, and has no
  relationship dropdown: the evidence rule above decides each row's colour, not
  whether the row is there. A
  checkbox dropdown in **Raw data** lists every available relationship. Raw data applies
  the selected relationship IDs on the server before pagination. Relationships containing `legacy` or
  `undefined relationship` are initially disabled; informative relationships
  are enabled. Manual choices apply across taxon pages and newly opened tabs
  during the browser session. A session cookie validates preferences held in
  localStorage; without that cookie, stored choices are ignored. Browsers that
  restore the previous session may also restore session cookies after restart.
  Blocked storage falls back to choices within the current panel.
  “Reset to default” at the top of the dropdown restores this initial selection.
  A Records drilldown out of the Field Assistant names its records by id and is
  therefore **not** narrowed again by that dropdown — Raw data would otherwise
  show fewer records than the count that was clicked. The count is every record
  of that taxon, whatever its colour, and the drilldown opens all of them.
  A separate, clickable ⓘ button explains the strength of the displayed
  evidence and links to the Biological relationships documentation. The filter
  itself has no hover hint.
- Normal copy of a selection within one Field Assistant table substitutes the original
  plant-part terms, including unknown terms, when icons are selected:
  it copies the intersected cells in full as both a text table and an HTML table.
  Other text selections keep native browser behavior.
- Clicking the record count opens those exact records in Raw data view; the back
  button returns to the Field Assistant.

For higher-rank Field Assistant pages, two directional
`/biological_associations/basic` requests (`subject_taxon_name_id[]` and
`object_taxon_name_id[]`, both with `descendants=true`) are used in parallel.
All server pages are collected locally and only then published to Field Assistant.
There is no progressive table update and no automatic visible-row enrichment.
`/otus?otu_id[]=...` with `extend[]=taxon_name` is requested only for the unique
OTUs needed to define the final Field Assistant groups, in bounded batches. The
complete, coordinatified Basic index remains available to Raw data where exact
full-scope behavior is required. Raw data reads that index at the summary page
size together with the same two directional requests the Field Assistant makes, all three in
one parallel round. The directional pair names which side of each association the
taxon is on, and each is cheaper than the coordinatified query it runs beside
(2.5 s and 1.3 s against 3.0 s on Entiminae), so the direction arrives with the
rows it describes and costs no request of its own. The taxon's own OTU scope is
never enumerated, and its participants are not asked about one by one either: a
subfamily owns tens of thousands of OTUs while its association index names a few
hundred, and neither reading that inventory page by page (minutes) nor asking
about every participant (nine requests, two seconds) answers more than the index
already holds.

A taxon-name filter cannot see an association that belongs to the taxon through a
specimen's determination, so a few rows of the coordinatified index appear in
neither directional response — 9 of 997 on Entiminae, all with a
CollectionObject subject; on a species page whose specimens are determined to a
synonym they can be most of the index. Only those rows' participants are put to
`/otus?otu_id[]=...&taxon_name_id[]=...&descendants=true&coordinatify=true`
(batches of at most 100, three at a time, one request in practice), and its answer
places those rows alone: their participants are ordinary OTUs that also occur in
rows the index already placed, so testing every row against that answer would pull
rows onto a side they are not on.

**This page's own OTU ID is added to every one of those batches.** TaxonWorks
applies `otu_id[]` first and `coordinatify` to whatever survives it, so an OTU
that belongs to the taxon only as a nomenclatural coordinate answers "no" when it
is asked about alone — nothing in the request matched for it to be a coordinate
of. With the anchor, the answer for *Brachypera dauci* is the same eight OTUs the
full-scope enumeration returns; without it, it is empty and four of the page's
five associations lose their side. The anchor and the coordinates `coordinatify`
adds are both dropped from the answer, which names requested IDs only.
`/otus?otu_id[]=...` with `extend[]=taxon_name` supplies
names and TaxonName IDs in batches of at most 100 OTUs. Synonym OTUs are resolved
to accepted OTUs through `cached_valid_taxon_name_id`, also in batches. Existing per-OTU DwC inventories
resolve specimens and missing families, with at most four requests in flight.
If a FieldOccurrence omits its family, the fallback uses inventory records with
the same complete scientific name and one unambiguous family; other descendants
cannot supply its classification.
Both views fill a missing indexed family from a unique value on the same
OTU or accepted TaxonName. If neither exists, it resolves the actual Family rank
through the documented TaxonName `ancestor_ids`, only when a TaxonName is linked;
these lookups are cached. Placeholder families count as missing. Thus
an AnatomicalPart and a FieldOccurrence retain the classification of their
underlying taxon even when their own `/basic` row has `family: null`.
Mode and taxon changes invalidate older loads. Primary responses are checked for
array data, valid pagination headers, missing row IDs, repeated pages and
incomplete totals. A failed primary load leaves the table empty and offers a
Retry action; optional family, image, distribution and classification failures
keep the base rows visible and are reported separately.
If unnamed OTUs were excluded from the index, Raw data selects each page from
the eligible index IDs before fetching full records (bounded by the page size).
This prevents excluded rows from reappearing or leaving gaps in server pages.
The Field Assistant/Raw data buttons clear previous record-group selections. Changing
relationships also re-evaluates the Raw data summary threshold. Header hints and
the relationship dropdown are teleported outside the scrolling table and kept
within the viewport; Escape and outside clicks dismiss them.

The aggregation is analogous to joining OTU metadata with `left_join()` and then
using `group_by(taxon_id)` / `summarise()` in R. Vue `computed()` values
automatically recompute the grouped table when relationship filters change.

## Advanced view

Advanced displays one row per BiologicalAssociation, including both participants.
Genus and Species are separate; Species preserves every species/subspecies epithet.
Subgenus and Tribe are optional columns. **Show author / year**, to the left of
**Columns**, adds roman authorship within Species and defaults to off; authorship
has no separate column. It reaches species names only. An OTU with no epithet of
its own — a genus, or a tribe or subfamily that stays in the Genus column
because its family is a different one — is shown without authorship, as the
Family column always is, and the Genus column therefore reads the same whether
the switch is on or off. Names are shown in current use by default: an OTU filed
under a name that is no longer valid is displayed under its accepted name and
links to the accepted OTU. The Subject and Object buttons name the action rather
than the state (**Show original names** / **Show current names**) and
independently switch to **original name now accepted name** for those records,
including specimen determinations. Both names are complete in the Species cell
and both receive authorship when enabled, but only the accepted name is a link:
the synonym's own OTU page carries its nomenclature and none of the records, so
the link leads where the data is. Names without a synonym
are displayed once. Cached synonym results
from the Field Assistant are reused rather than overwritten when the second side is loaded.
Active name filters are translated when switching synonyms or authorship.

- Each column cycles through ascending, descending and the original alphabetical
  order; the third click restores its neutral button and arrow. A null saved
  sort represents this unmodified order. Every column has a searchable checklist.
  Selections are drafted locally and applied together with **Apply**. Relationship
  selection lives in its own column and defaults to **all relationships**,
  including legacy/undefined. Depictions offers only **Present** and **Absent**;
  both are included when the column is enabled. **Depictions** and **Area** are
  hidden by default. Table buttons have transparent backgrounds in all states,
  with gray outlines when inactive and blue outlines when active. No extra dot
  marks a filtered column. The middle group heading is **Relationship**.
- **Columns** controls visibility and provides **Reset to default**. Subject/Object
  Subfamily, Tribe, Subgenus, Depictions, Area, Tags and Data attribute are optional.
  One **Data attribute** checkbox controls both Data attribute and Data value;
  previously saved individual selections are normalized to the pair.
  At least one column remains visible. Hidden column filters remain active and
  are counted above the table; **Reset filters and sorting** clears them.
- The Genus column only ever holds a genus. A participant identified no further
  than its family has no genus and no species, and TaxonWorks files it under a
  one-word name that `splitAdvancedName` can read as nothing but a genus — so the
  family used to sit in Genus, italic, repeating what Family already said. It is
  now shown in **Family**, roman, and keeps the link to its OTU. Two things
  decide: the Family column already carrying that exact name (the 5 family-rank
  OTUs in this project), or — when no family resolved and the OTU has no
  TaxonName at all, hence no rank — an ending of `-aceae` (ICN) or `-idae`
  (ICZN), which no genus in either code can have (Lauraceae, Myrtaceae). A tribe
  or subfamily is deliberately left in Genus: its family is a *different*,
  non-empty name, and Subfamily and Tribe are optional columns that are hidden by
  default, so moving it would drop the name from the table entirely.
- A vertical rule separates the four column groups (Subject, Relationship,
  Object, Metadata) and nothing else — there is none between Family and Genus.
- Both taxonomy sides have separate anatomical columns. Missing anatomy leaves
  the cell blank on either side — nothing is filled in.
- Tags and attributes belong to each **BiologicalAssociation**, not its
  BiologicalRelationship type. Attribute names and values appear in two aligned,
  numbered lists. A combined attribute-name/value filter matches the same
  annotation, never two unrelated annotations on that record.
- **Citations** uses the same individual `citation_source_body` short references
  as Raw data, including year suffixes and page locators. Only a reference is a
  link: an entry whose Source is a publication (`Source::Bibtex`) opens its full
  text in the shared modal. Everything else in the column is shown as plain,
  dimmed text — the `/basic` index files the collector or determiner in the very
  same field whenever a record has no citation of its own (783 of the 3000
  records in this project, e.g. "Yunakov N.N."), a specimen's `recordedBy` is the
  last fallback, and TaxonWorks also files photo credits as `Source::Verbatim`.
  None of those opens anything, so none of them may look like a link; the Field Assistant
  has always rendered them this way. A source whose type could not be resolved
  keeps its link, because losing every reference to one failed lookup is the
  worse failure. The column filter and the clipboard still see the whole column,
  references and names alike. The filter offers one term per publication
  (`Marshall, 1922` stands for both `Marshall, 1922:59` and `…:60`); the cell,
  the sort order and the clipboard keep the page locator.
- Filters and sorting cover **every** record of the taxon, not the records that
  happen to be on screen: a value that only occurs on page 3 is offered by the
  filter menu and selectable from page 1. That is why Advanced reads the whole
  index at once (see below) instead of one server page at a time.
- Paging is a slice of records already in hand, so turning a page is immediate
  and costs no request — which is also the only way the selected page can be
  marked as selected at the moment it is clicked. Filters and sorting return to
  page 1, because their first hit is what was asked for; switching a column,
  author / year or original names on leaves the reader where they were; a new page size keeps the first visible
  record in view, so 51–100 at 50 per page becomes page 2 at 100 per page. The
  count line names the records and the page, not the row range. The centered, unlabelled page-size
  dropdown offers **50 or 100**; pagination is available above and below. Saved
  200-row settings fall back to 50 and removed authorship columns/filters are
  discarded during normalization.
- The current page is marked with `--color-secondary`. `VPagination` itself uses
  `bg-primary`, which in the dark theme is `rgb(23,23,23)` on a `rgb(38,38,38)`
  card — a contrast of 1.2:1, i.e. no visible marking at all. The override is a
  scoped `:deep()` rule on `button[aria-current="page"]` in this panel and in
  Raw data; the package component is untouched.
- Settings are isolated by exact rank and nomenclatural target group (ICZN animals,
  ICN plants). A new tab in the same scope reads the latest selection, sorting,
  columns, name modes, authorship and page size. Existing tabs do not subscribe to storage
  changes, so they retain their own settings. Unknown groups are isolated to
  their taxon page. The existing browser-session cookie validates these settings;
  without it the defaults apply. Browser session restoration may restore cookies.
- Copying specimen cells writes the name followed by **(FieldOccurrence)** or
  **(CollectionObject)**, omitting the info button. Header sort/filter controls
  are omitted from copied tables. The shared copy handler supplies both TSV and
  escaped HTML for spreadsheet paste; Raw data uses the same specimen suffix.

Advanced is loaded as a separate asynchronous component. It reads the whole
taxon from `/biological_associations/basic` — the same cheap, precomputed index
the old panel used, with `otu_query[coordinatify]=true`, `otu_query[otu_id][]=...`
(species pages) or `otu_query[taxon_name_id][]=...&otu_query[descendants]=true`
(above species), and `extend[]=object,subject,biological_relationship,taxonomy,`
`biological_relationship_types` — but through `fetchAllAssociationPages` at
`per=3000`, so every record is in hand before anything is shown. Measured against
the live API: 490 records (genus *Hypera*) are one request of 238 KB in 2.3 s;
2882 (Curculionidae) are one request of 1.26 MB in 8 s; 3554 is the whole
project. The Field Assistant already reads the same volume as the panel's opening view, so
this is a cost the page was paying anyway, and it is paid once instead of once
per page turn. `ADVANCED_MAX_ROWS` stops the collection at 10 000 records with a
warning line rather than reading without end. Every index response is validated;
the first anomaly is the one reported.

Nothing is published until names and families are complete, so the table appears
finished rather than rewriting its own cells while being read. That means two
enrichments on the critical path:

- **OTUs** (`loadOtusByIds`, three batches in flight), because only the OTU
  payload carries the accepted TaxonName the name columns display. Synonyms are
  then resolved through the same `resolveAcceptedNames` helper the Field Assistant and Raw
  data use, which costs one batched request and nothing at all without synonyms.
- **Classification** (`loadAdvancedClassification`), which walks the parent chain
  level by level over `/taxon_names?taxon_name_id[]=…`, 100 ids per request,
  sharing every ancestor between rows. It yields Family, Subfamily, Tribe and the
  genus OTU at once. Advanced no longer uses `loadTaxonomicFamilies`: that helper
  spends one `/taxon_names/:id?extend[]=ancestor_ids` request **per name**, which
  is fine for a 50-row page (~11 requests) and impossible for a whole taxon
  (1061 names without a family on the project root). The Field Assistant and Raw data still
  use it through `enrichAssociationFamilies`.

`fillAssociationFamilies` still runs as a pure pass before publishing, because
the index is not consistent about `family`: the same OTU can carry one on one
record and none on the next. An OTU with no TaxonName at all — OTU 738229
*Vicia angustifolia* on the *Hypera postica* page, for instance — has no
ancestry to fall back on and keeps an empty Family, exactly as before.

Annotations stay progressive and batched per kind — one request per 100 records
for citations, one for depictions, and so on, never one per row. The citations
batch resolves the Sources it refers to in one further `/sources?source_id[]=…`
request (92 distinct sources across the whole project) before it is published,
so a reference is never briefly linked and then demoted, and the modal opens
without another round trip. The lazy per-association citation fetch remains only
as the fallback for a record whose source text was not resolved.

An index response that contradicts itself — a repeated record inside a page, a
record total smaller than the page, a page count that does not match the total —
no longer discards the response. The affected header is ignored and derived from
the data, repeated records are kept once, and the view shows what was read with
a warning line and a Retry. Only a response that cannot be attributed to the
requested page, or that carries a record without an id, still fails outright.

On a species page Advanced keeps the current-OTU scope, so it can legitimately
be empty even when the Field Assistant has descendant associations: the page's own OTU may
have no direct biological associations. Advanced reports that successful empty
state separately from a failed request; use Field Assistant or Raw data for the
higher-rank descendant scope.

`advancedAssociations.js` contains pure row/filter/sort functions;
`loadAdvancedAssociations.js` contains paginated API joins;
`AssociationSelectionMenu.vue` reuses the panel's anchored popover and global
TaxonPages inputs/buttons. In R terms, Advanced performs its joins once and then
`filter()`, `arrange()` and the page slice all operate on the complete table.

The panel owns rows, taxa and classification; `AdvancedAssociationsTable` owns
only the page number, the settings and the annotations. There is no server page
left to disagree about — the arrangement that let a stray write request a page
the reader never chose no longer exists, and neither does the `page-change`
round trip that made a click take a second to become visible.

`VSpinner` is an opaque overlay across the whole card, so it is raised only when
there is nothing to cover: the first build of the view. A retry from the warning
line reloads with rows already on screen and leaves the card uncovered,
announcing itself through `advancedLoadState` and the inline loading line.

## Configuration

Set via `bind:` in `taxa_page.yml`, same mechanism as `subMaxImages` on the gallery panel:

```yaml
- - - id: panel:biological-associations-v2
      bind:
        collapseAboveRank: 'GenusGroup'
        collapseThreshold: 15
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `collapseAboveRank` | String | `'SpeciesGroup'` | Rank-group cutoff, inclusive: this rank and anything narrower (e.g. `'GenusGroup'` → genus, species, infraspecies) shows the flat per-record table in Raw data view; anything broader always shows the grouped family/genus summary. One of `'HigherClassificationGroup'`, `'FamilyGroup'`, `'GenusGroup'`, `'SpeciesGroup'`, `'SpeciesAndInfraspeciesGroup'` (same values as `rank_group` elsewhere in `taxa_page.yml`). |
| `collapseThreshold` | Number | `Infinity` | A flat-eligible page still escalates to the grouped summary if its record count exceeds this. `Infinity` (the default) disables the escalation. |

In Raw data view, a flat-eligible page (per `collapseAboveRank`) loads the flat table first; if its total exceeds `collapseThreshold` it then re-fetches as the grouped summary instead. Pages above the rank cutoff go straight to the grouped summary and never pay for the flat fetch.

## Differences from the built-in panel

- **Depictions** shown as thumbnails inline in the table; clicking opens the shared `../_shared/ImageLightbox.vue` with figure label, attribution, and source reference
- **Asserted distributions** shown as a list of area names per row (absent records struck through)
- **Citations** shown as clickable short references (e.g. "Masur & Wartmann, 2025:93"); clicking opens a modal with the full formatted reference, with URLs rendered as clickable links
- Order and Genus columns removed to reduce horizontal clutter
- Families are resolved for OTUs, FieldOccurrences and CollectionObjects where
  classification is available; unresolved families remain blank.

## API calls

Advanced uses the same primary request as the built-in panel:
`/biological_associations/basic` with `otu_query[coordinatify]=true`,
`otu_query[otu_id][]=...`, the five legacy `extend` values, and one `page`/
`per` pair. Pagination is read from `pagination-page`,
`pagination-per-page` and `pagination-total`. This bounded page-wise flow is
intentional: it avoids the browser slowdown caused by loading the complete
association index before rendering Advanced.

In Raw data view, after loading the associations page (one call to `/biological_associations?extend[]=...`), four additional batch requests are fired in parallel:

1. `/depictions?depiction_object_type=BiologicalAssociation&depiction_object_id[]=...`  
   Returns depiction records for associations on the current page.

2. `/depictions/gallery?depiction_id[]=...`  
   Returns full image data in one call: thumb/original URLs, figure label, and attribution. This is the same endpoint used by the gallery panel internally (`useGallery.js`).  
   Followed by one batch call to `/images?image_id[]=...&extend[]=source` to fetch publication sources for all images at once.

3. `/asserted_distributions?biological_association_id[]=...`  
   Returns asserted distribution records grouped by association ID.

4. `/citations?citation_object_type=BiologicalAssociation&citation_object_id[]=...&extend[]=source`  
   Returns citation records with the full source object embedded — no separate `/sources` call needed.

The depiction, gallery, image-source, distribution and citation lists consume
all server pages, including server-capped page sizes. Stale loads stop paging.

## Lightbox

The shared `../_shared/ImageLightbox.vue` (see `../_shared/readme.md`). A BA plate is
not an Otu/CO/FO depiction, so `makeGalleryImage()` shapes each image with the plate
text as top-level fields the lightbox renders as a caption block (label bold, caption
beneath) rather than a fake `depictions` entry:

- `figure_label` — plate label, shown bold
- `caption` — free-text caption, shown beneath
- `attribution.label` — copyright and license
- `source.label` — full publication reference with clickable URLs
- `depictions: []` — no Otu/CO/FO structure, so no name block and no ⓘ button

## Notes

- `useOtuPageRequest` is called with key `panel:biological-associations-v2` to avoid cache collisions with the built-in panel
- The `citations` plain string from the basic endpoint is kept as a fallback for rows where no structured citations are found via `/citations`
- The subject/object "ⓘ" button opens `../_shared/DwcTable.vue` (shared with PanelMapV2 and PanelGallery — see `../_shared/readme.md`). A subject/object can be an `AnatomicalPart` wrapping a CollectionObject/FieldOccurrence (e.g. a nidus) rather than the specimen directly; `resolveSpecimenRef()` in `makeBiologicalAssociation.js` parses the wrapped specimen's type+id out of `object_label` so locality/collector lookup and the info button still work for those rows
- **Label cell for a CO/FO entity:** a CollectionObject/FieldOccurrence subject or object has no clean taxon-name span in its `object_tag` — only a catalog-string `object_label` (`"FieldOccurrence 5000; <uuid>; <locality>"`). The panel resolves the determination name from the specimen's DWC record (`scientificName`, authorship included), fetched in the same per-OTU `dwc.json` call that supplies the Area-column locality. `buildLabelParts()` renders it italic-name + roman-authorship and the template links it to the OTU page; the "Collection Object"/"Field Occurrence" tag + ⓘ button are unaffected. When the entity is an `AnatomicalPart` wrapping the specimen, its part name stays as a `"Nidus of …"` prefix. Falls back to the raw `object_label` only when no DWC record is found (undetermined specimen, or one absent from the OTU inventory).

## Verification

```bash
node panels/PanelBiologicalAssociationsV2/makeBiologicalAssociation.test.js
node panels/PanelBiologicalAssociationsV2/standardAssociations.test.js
node --test panels/PanelBiologicalAssociationsV2/panelBehavior.test.js
node --test panels/PanelBiologicalAssociationsV2/advancedAssociations.test.js
node --test panels/PanelBiologicalAssociationsV2/advancedTable.test.js
npm test
npm run build
```

`advancedTable.test.js` runs `AdvancedAssociationsTable.vue`'s own `<script setup>`
through the same fake HTTP boundary as `panelBehavior.test.js`. That component is
where the Advanced page number and the metadata loading live, and the panel-level
suite replaces every `.vue` import with `{}` — so anything only reachable there
was previously untested. It covers the batched citation request across every
record, metadata starting when the view becomes active, turning a page without a
single request, a filter reaching a record that is not on the visible page, the
filter menu offering values from records that are not on screen, sorting ordering
all records rather than one page, a filter returning to page 1 while a column
change leaves the reader put, a new page size keeping the first visible record in
view, the count line's records and page, the name and authorship switches reading
the panel's classification (they rebuild rows outside `displayRows`, so a name
filter would otherwise translate into a family that does not exist), and
fetching each metadata kind once when two watchers fire in the same tick.

The panel-level suite adds reading every index page before publishing, the
batched ancestor walk supplying families with no per-name `/taxon_names/:id`
lookup left on the Advanced path, an index family copied across records of the
same OTU, the accepted-name resolution for a synonym OTU,
the first index anomaly being the one reported, and the card-wide spinner staying
down when a retry reloads rows that are already on screen.
`advancedAssociations.test.js` covers what may be linked in the Citations column:
a publication is a reference with its full text, a `Source::Verbatim` credit and
an index collector name are dimmed notes, and both remain selectable in the
column filter. `standardAssociations.test.js` covers the bulk-load concurrency
returning identical rows in identical order, abandoning a stale bulk load, and
the row ceiling stopping with a labelled partial list. For the Records dot,
`standardEvidence.test.js` covers the frozen mark order and its theme tokens,
the best mark being the strongest category a row has (and `null` for a row with
nothing classified), all three categories surviving a row with no counts, the
breakdown listing only the categories a row has, and the accessible name built
from them; `standardTable.test.js` covers the one dot a row paints for each
evidence mix, opening and closing one row, a second row moving
the single popover rather than adding one, `closeMarks` clearing the click and
hover flags together, hover being ignored without a hovering pointer (otherwise
a tap leaves the popover stuck open), and a row leaving the table taking its
popover with it. `viewModePreference.test.js` covers the saved view: the three
views keeping their labels and their order, a choice read back by the next page
and the next tab, the preference dying with the browser session, a stored view
the panel no longer has falling back to the Field Assistant (and an unknown one
never being written), and blocked storage leaving the default in place instead
of throwing. The panel-level suite adds the restore itself and a Records
drilldown into Raw data leaving the saved view alone.

Each of these was checked once against the defect it exists for, by
reintroducing that defect in a throwaway copy under `panels/.redcheck/` — never
in the files the dev server is watching, which is what produced a half-applied
served module on 2026-09-16.

Regression cases cover FO-only associations, multiple OTUs of one taxon,
wrapped parts, colliding CO/FO IDs, both directions, higher ranks, alphabetical
ordering, complete server pagination and stale requests. Component-setup tests
also cover Field Assistant/Raw data transitions, filter threshold changes, and metadata
pagination using a fake HTTP client. OTUs without TaxonNames and placeholder
families have dedicated regression cases.

Advanced regression cases cover independent synonym switches, preserved name
filters, complete subspecies names, default relationships, attribute/value pairing,
rank/group session isolation, HTTP session support, bounded metadata batches,
shared ancestry caching and stale view transitions. Browser checks on 2026-09-14
covered Dianthus carthusianorum (FO details), Hypera conmaculata (both synonym
directions), Ixapion variegatum (attributes and subspecies), Donus elegans (tags),
Adosomus roridus (depictions and reference modals), and Hypera (490 records,
pagination and global filtering). New-tab persistence and rank/group
resets were checked; menus were verified at 390 px in both themes. A temporary
browser fixture verified actual copy events with FO/CO suffixes and icon text.

The later Advanced updates were checked on the same date: all relationships;
centered 50/100 selection; optional tribes on both
sides; full original/accepted pairs with optional roman authorship; preserved
name filters; transparent buttons with gray/blue outlines; and exclusion of Donus elegans' unnamed
plant OTU in all three views. Regression tests additionally exercise exclusion
before Raw data page slicing/counting and migration of removed settings. Mobile
menus were checked at 390 px in dark and light themes. The three-click sort cycle
restores the exact original order and neutral button. Depictions/Area default to
hidden; one Data attribute option toggles both columns. Citation short labels
and the individual Reference modal match Raw data (Skuhrovec, 2005b:228); citation
filters and Field Assistant's separate legacy/undefined defaults were also checked.
The production build is also required; if the local read-only `node_modules`
environment prevents it from writing its generated source asset, that
environmental limitation is reported separately from source/test failures.
