# PanelGbifTaxon

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.5.4 (npm package setup)

Originally copied from [MortenHofft/taxonpages](https://github.com/MortenHofft/taxonpages) by [Morten Høfft](https://github.com/MortenHofft) on 2026-05-21. **Rebuilt 2026-08-31** from a name-overlap Venn into a concept alignment; almost nothing of the original remains.

**Links open `www.gbif.org`.** The GBIF v2 Catalogue of Life API returns alphanumeric usage keys (e.g. `LPL3Q`); these resolve on the main portal under `/species/search?q=` and, for an accepted taxon, `/species/:alphaKey`. The legacy integer-keyed backbone still lives at `/species/:intKey`.

---

## What it shows

The alignment between **the TaxonWorks concept** of the current taxon and **the Catalogue of Life concept** of the same name. Species and lower ranks only (a genus or family page shows a short line and stops).

1. **Matched-name line** — the CoL accepted name, or, when CoL treats the TaxonWorks name as a synonym, a sentence saying so and naming the concept the comparison is actually against.
2. **Relation statement + icon** — one RCC-5 verdict (`≡` congruent, `⊂` included, `⊃` includes, `>` overlap, or "cannot be compared"), with the Franz and Peet 2009 Figure 2 glyph (two rectangles, nested / overlapping / apart). A collapsed "how this is measured" explainer sits under it.
3. **Zone table** — every name either source files under this concept, in four groups: in both circumscriptions, TaxonWorks files under X / CoL keeps separate, CoL files under X / TaxonWorks places elsewhere, misapplied. Plus rows for names seen only in the occurrence data and names not in CoL. Each row carries its own Figure 2 icon (in a column between the two source columns) for that one name's cross-source relation. Names and record counts are plain text; the one link in the table body is the blue TaxonPages link on a "CoL folds in" row's TaxonWorks placement entry ("synonym of *Z* (Author, Year)" / "*Z* (Author, Year), valid species"), pointing at that concept's OTU page.
4. **Occurrence summary** — one exact line: "GBIF holds N records (X imaged, Y mapped)", the total linking to the scoped occurrence search.
5. **Open in GBIF** — one line of up to four links (Catalogue of Life, backbone, all occurrences, panel set), each with a `title` tooltip.

## How it works

Two layers, kept separate (Franz and Thau 2010):

- **Name graph (fact).** `N` = the TaxonWorks valid name + that OTU's TW synonyms; `G` = the CoL accepted usage `N` maps to + its CoL synonyms. Both sides are reduced to genus-independent `matchKey`s and each `G` name is graded against `N` at three tiers: `homotypic` (original combination lines up both sides → shared type), `probable` (epithet + author + year, ±1 yr), `weak` (epithet only).
- **Relation (inference).** `deriveRelation` reads the two key sets → the RCC-5 verdict + a confidence (`clear` / `provisional` when some `N` name was uncheckable / `uncertain` when only `weak` keys carry it).

Engine lives in `panels/_gbifShared/` (`gbifNameMatch`, `conceptRelation`, `gbifChecklistConcept`, `assembleAlignment`, `gbifConceptAlignment`). Full design: `docs/superpowers/specs/2026-08-31-gbif-concept-alignment-design.md`.

**Why Catalogue of Life, not the GBIF backbone:** CoL is the checklist the sibling GBIF panels query (`CHECKLIST_KEY`), so the alignment matches what Images / Map / Type specimens show. A backbone "second opinion" was tried and cut — for this project's taxa the backbone lumps exactly as CoL does.

## Notes and limits

- **SSR guard:** `load()` returns early when `typeof window === 'undefined'`; the panel renders nothing until mounted on the client.
- **Reverse lookups on load:** one `fetchTwPlacement` per "CoL folds in" row (usually 1 to 5), fired in parallel, cached per name string. Needed for the per-row relation icon and the inline placement link. This is a deliberate change from the spec's original "0 on load" (spec section 5.4).
- **Match gate:** uses `matchGbifRaw` / `isSpeciesGroupMatch`. No confident CoL match → the "no match" line. A genuine genus / family EXACT match → the short rank-ineligible line.
- **Link colour encodes destination:** green (`--pp-gbif`) for gbif.org, site blue (`--pp-tw` = `--tp-secondary`) for a TaxonPages page.
- **Abbreviated authors** ("Woll." vs "Wollaston") are not reconciled, so a genuinely congruent pair can show as "cannot be compared" — conservative, not a wrong verdict.
