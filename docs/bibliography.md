# Bibliography pages

Everything custom lives in `pages/bibliography/`. There is no local `modules/bibliography/`: a local module of that name would shadow the package's whole bibliography module. The package's own search page at `/resources/tw/filter/bibliography` is untouched and follows its updates. The header menu links to our two pages instead:

- `search.vue` (`/bibliography/search`): the package's search view (taken from `@sfgrp/taxonpages` 0.7.2) with the ⊕ pills modal, a "Download .bib" button, "Published between" ending at the current year (the package hardcodes 2025) and the placeholder example "Meregalli 2009 Pachycerus". The form parts (`YearPicker`, `VSlider`, `DropdownMenu`, `getPagination`) are imported from the package (`@/modules/bibliography/...`), only the view itself is a copy. When the package is upgraded, compare it with the package's `views/index.vue`. From 0.8 that view uses `$t()` translation keys.
- `recent.vue` (`/bibliography/recent`): Recent additions, see below.

Layout: `components/` holds the shared components (the page router skips `**/components/*.vue`) and `utils/` the plain `.js` helpers. Do not put a `.md` file in `pages/bibliography/`, it would become a route. That is why these notes are here.

## Recently added, recently published

A switch above the table, kept in the URL as `?sort=published`.

- Recently added: `/sources?recent=true&recent_target=created_at`, sorted and paged by the API.
- Recently published: `/sources` cannot sort by publication date (`recent_target` only honours `created_at` and `updated_at`, anything else is ignored without an error, and so is `order_by`). The page loads the in-project sources of the current and the previous year with `year_start` and `year_end` (118 sources on 2026-10-11) through `utils/publishedList.js` and sorts them in the browser (`utils/publicationDate.js`). The switch itself is `components/SortSwitch.vue`.
- Sort order, newest first: a full date sorts as that date. A source with only a year is placed by the date it was added, if it was added in that year, so it falls between the exactly dated ones. Added in another year, it goes to the end of its year. Month only works the same way inside the month. Ties go by date added.
- The Published column shows only what TaxonWorks has: "March 20, 2026", "February 2026" or "2026".
- A three-way switch on the search page ("By author | Recently added | Recently published", for any search) was tried on 2026-10-11 and dropped: the user did not like it there. `utils/publishedList.js` was written for it and can sort any search by publication date, see its docblock.
- `getPage` of that loader answers its calls one after the other, so two overlapping requests cannot load the same years twice.

## Search page behaviour

The table, the .bib download and the URL all follow the search that was answered, not what has been typed in the form since. A slow answer cannot replace a later one. A search from the form adds a history entry, one read from the URL (first load, Back, Forward) does not.

## The ⊕ modal

`components/OtuModal.vue` and `utils/sourceRecords.js`: the modal shows one row per taxon the source is cited for, followed by a pill for every kind of citation that paper has for it. Both pages use it. The package's modal only lists OTUs whose taxon name is cited.

1. Fetch the source's citations: `GET /citations?source_id=…&extend[]=citation_topics`.
2. OTU paths (`OTU_PATHS`): for each citation type present, one `/otus` request with that type's facet (name, OTU, content, specimen, image). Results are merged by OTU id.
   - Distributions also read `/asserted_distributions?source_id=…`. A distribution can be asserted for a biological association instead of an OTU (366 of about 53,000 in this project). The facet misses those, so they are listed with the association's subject OTU. Reading the distributions also gives the pages per OTU. Example: Jilg & Hoffmann 2022, *Ixapion variegatum*.
3. Biological associations are listed with their **subject** OTU only. The `/otus` facet returns both sides (the host plant too), so this path reads `/biological_associations/basic?source_query[source_id][]=…` and keeps `subject_otu_id`, which is also set when the subject is a specimen or an anatomical part.
4. Name-bound citations (`NAME_RESOLVERS`) are resolved to a taxon name and shown on that name's rows:
   - name relationship: `/taxon_name_relationships?taxon_name_relationship_id[]=…`, listed with the subject name
   - name status (classification): `/taxon_name_classifications/:id`, one request each, because the list endpoint ignores an id filter
   - type material: there is no type material endpoint. The only route is backwards, `/collection_objects?type_specimen_taxon_name_id=<name>&extend[]=type_material`, one name per request (the array form is ignored). Candidates are the names the source already cites, same pages first, stopping as soon as every type material citation is matched.
5. A cited name with no OTU gets a row of its own (plain text, or linked to the OTU of its valid name when there is one). Example: Van Dyke 1916, *Cossonus pacificus*.
6. What a pill says is decided in `utils/citationLabels.js` (label and hover text), from the record type plus a `kind` where the type alone says too little:
   - A name citation reads "Nomenclature". If TaxonWorks flags it as the origin citation of that name (`is_original`) it reads "Original description", on a combination "New combination" (the flag then only means the first use of the combination), on a misspelled name ("[sic]" in its label) "Misspelling".
   - A name relationship citation reads as the kind of relationship: "Synonymy", "Homonymy", "Type species", "Misspelling", "Classified as", "Original combination" and so on (`RELATIONSHIP_KINDS`, anything else by the last part of its TaxonWorks type).
   - A name status citation reads as the status: "Valid", "Nomen nudum", "Nomen dubium", "Homonym", or "Gender: feminine" for the grammar records, which are not statuses.
7. Topics are shown inside the pill of the citation they are tagged on, after the pages: "OTU: 22 · Distribution, description". Nearly all topics in this project sit on OTU citations, and pooled at the end of the row they could not be told from a claim about the name or from a distribution record. Topics take the colour of their pill, the separate topic colours (green for "Biology") were removed with the separate topic pills.
8. Pills are blue for taxonomy (name, name relationship, name status, type material, OTU, key), green for biology (biological association), yellow for distribution and everything else. Every pill has a hover text (`title`) saying what it means, including the definitions of its topics.
9. A failed lookup shows an error, not "No records found".
10. Whatever cannot be tied to a taxon (data attributes, collecting events, keys, any type TaxonWorks adds later) is counted under "Also cited on". The count is per citation: if a source has ten distribution citations and two of them lead to no taxon, those two are counted there. The exception is a type whose path only tells which OTUs are involved (content, specimen, image): once it finds any OTU, all its citations count as shown.

## BibTeX export

`utils/bibtex.js` and the "Download .bib" button on the search page: downloads the search results as one BibTeX file, built in the browser. The API has no BibTeX output (`/sources.bib` answers 500), but every source carries the BibTeX fields. The button downloads the results of the last search that was run (same filters as the table, all pages). Without a search it downloads the whole project bibliography (`/sources?in_project=true`, 1,000 per page in parallel): about 7,900 sources take roughly 12 seconds and give a 2.4 MB file. The default year range alone does not count as a search and is not sent, because it would drop the few sources without a year (3 on 2026-10-11).

- Keys are first author surname + year + year suffix (`VanDyke1916`, `Fahraeus1840b`), with `_2`, `_3` for clashes, compared without case. A source without author or year gets `source<id>`. A stored `key` is used only if it is a valid key.
- `<i>` in titles becomes `\textit{}`. The file is UTF-8, so it wants biber or a UTF-8 aware BibTeX.
- An author or editor field BibTeX cannot parse (people separated by commas, a doubled "and") is written in double braces, so the entry survives with the text as one literal name. 10 sources as of 2026-10-10: these are data errors worth fixing in TaxonWorks.
- Checked with `biber --tool` on the full export: all 7,894 entries parse with no warnings.

## Gotchas

- Only add a facet to `OTU_PATHS` after testing it against the API. An unknown `/otus` parameter is ignored and returns every OTU in the project. `field_occurrence_query[source_query]` is a known trap: it ignores the source filter.
- Pagination is client side (50 per page), because the list is a union of several requests. The heaviest source (about 9,000 citations, 3,700 rows) takes roughly 27 seconds.
- One-record-at-a-time lookups (name statuses, type material candidates) are capped at 150 requests each (`MAX_SINGLE_REQUESTS`). Beyond that the citations stay in "Also cited on".
- Type material whose name the source does not otherwise cite is not found (source 46533 is an example).
- `components/OtuModal.vue` started as a copy of the package's 0.7.2 modal. Both pages use it.

Tests: `node --test 'pages/bibliography/**/*.test.js'`
