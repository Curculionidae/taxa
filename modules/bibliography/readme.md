# Bibliography module (local override)

Local copy of the package's `src/modules/bibliography/` (taken from `@sfgrp/taxonpages` 0.7.2). It registers the same route name, `resources-tw-filter-bibliography`, so it replaces the core page at `/resources/tw/filter/bibliography`. `pages/bibliography/recent.vue` imports its `OtuModal` and `DropdownMenu` from here too.

## What differs from the package

`components/OtuModal.vue` and `utils/sourceRecords.js`: the ⊕ modal shows one row per taxon the source is cited for, followed by a pill for every kind of citation that paper has for it. The package version only listed OTUs whose taxon name is cited.

1. Fetch the source's citations: `GET /citations?source_id=…&extend[]=citation_topics`.
2. OTU paths (`OTU_PATHS`): for each citation type present, one `/otus` request with that type's facet (name, OTU, content, specimen, image). Results are merged by OTU id.
   - Distributions also read `/asserted_distributions?source_id=…`. A distribution can be asserted for a biological association instead of an OTU (366 of about 53,000 in this project). The facet misses those, so they are listed with the association's subject OTU. Reading the distributions also gives the pages per OTU. Example: Jilg & Hoffmann 2022, *Ixapion variegatum*.
3. Biological associations are listed with their **subject** OTU only. The `/otus` facet returns both sides (the host plant too), so this path reads `/biological_associations/basic?source_query[source_id][]=…` and keeps `subject_otu_id`, which is also set when the subject is a specimen or an anatomical part.
4. Name-bound citations (`NAME_RESOLVERS`) are resolved to a taxon name and shown on that name's rows:
   - name relationship: `/taxon_name_relationships?taxon_name_relationship_id[]=…`, listed with the subject name
   - name status (classification): `/taxon_name_classifications/:id`, one request each, because the list endpoint ignores an id filter
   - type material: there is no type material endpoint. The only route is backwards, `/collection_objects?type_specimen_taxon_name_id=<name>&extend[]=type_material`, one name per request (the array form is ignored). Candidates are the names the source already cites, same pages first, stopping as soon as every type material citation is matched.
5. A cited name with no OTU gets a row of its own (plain text, or linked to the OTU of its valid name when there is one). Example: Van Dyke 1916, *Cossonus pacificus*.
6. Pills: blue for taxonomy (name, name relationship, name status, type material, OTU, key), green for biology (biological association), yellow for distribution and everything else, with pages where the citation can be matched to the taxon. Citation topics are grey pills, except the ones named in `TOPIC_COLORS` (currently "Biology", green).
7. Whatever cannot be tied to a taxon (data attributes, collecting events, keys, any type TaxonWorks adds later) is counted under "Also cited on".

`views/index.vue`: "Published between" defaults to the current year (was hardcoded 2025), and the search placeholder example is "Meregalli 2009 Pachycerus".

`utils/bibtex.js` and the "Download .bib" button in `views/index.vue`: downloads the whole project bibliography as one BibTeX file, built in the browser. The API has no BibTeX output (`/sources.bib` answers 500), but every source carries the BibTeX fields. The button always fetches all in-project sources (`/sources?in_project=true`, 1,000 per page in parallel) and ignores the search filters. About 7,900 sources take roughly 12 seconds and give a 2.4 MB file.

- Keys are first author surname + year + year suffix (`VanDyke1916`, `Fahraeus1840b`), with `_2`, `_3` for clashes, compared without case. A source without author or year gets `source<id>`. A stored `key` is used only if it is a valid key.
- `<i>` in titles becomes `\textit{}`. The file is UTF-8, so it wants biber or a UTF-8 aware BibTeX.
- An author or editor field BibTeX cannot parse (people separated by commas, a doubled "and") is written in double braces, so the entry survives with the text as one literal name. 10 sources as of 2026-10-10: these are data errors worth fixing in TaxonWorks.
- Checked with `biber --tool` on the full export: all 7,894 entries parse with no warnings.

## Gotchas

- Only add a facet to `OTU_PATHS` after testing it against the API. An unknown `/otus` parameter is ignored and returns every OTU in the project. `field_occurrence_query[source_query]` is a known trap: it ignores the source filter.
- Pagination is client side (50 per page), because the list is a union of several requests. The heaviest source (about 9,000 citations, 3,700 rows) takes roughly 27 seconds.
- One-record-at-a-time lookups (name statuses, type material candidates) are capped at 150 requests each (`MAX_SINGLE_REQUESTS`). Beyond that the citations stay in "Also cited on".
- Type material whose name the source does not otherwise cite is not found (source 46533 is an example).
- When the package is upgraded, compare this copy with the new core module. From 0.8 the core module uses `$t()` translation keys.

Tests: `node --test 'modules/bibliography/**/*.test.js'`
