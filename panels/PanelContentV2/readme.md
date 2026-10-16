# PanelContentV2

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.7.2 (npm package setup)

Panel id: `panel:content-v2`. Replaces the package's `panel:content` in `config/taxa_page.yml`.

Shows the topic texts ("content") of the taxon, grouped by topic, like the package panel. In addition it shows what was written on the taxon's other OTUs: the OTUs of its synonyms and other OTUs on its own taxon name ("Carex sp." on Carex L.). The package panel only reads the OTU of the page, and the search sends everyone to the valid OTU, so a text on a synonym's OTU was never seen. Example: *Lixus abdominalis* (OTU 733362) has no content, its synonym *Lixus punctiventris* (OTU 733360) has a "Synonymy" text.

A text from another OTU has a heading "Entered under *name*" above it, the name in semibold and one size larger than the text. The own texts of the page come first inside each topic.

## Requests

1. `GET /otus/:id/inventory/content` for the page's OTU, as in the package panel.
2. Only when the page's taxon is valid (`taxon.is_valid`): `GET /otus?otu_id[]=:id&coordinatify=true&extend[]=taxon_name` lists the OTUs of the same taxon: the valid one, its synonyms, and any other OTU filed on the page's own taxon name ("Carex sp." on Carex L.). All of them are used (restricting it to the synonyms was tried on 2026-10-13 and taken back the same day, the user wants the texts of OTUs on the same taxon name shown too). Asked from a synonym's OTU, it answers with the synonym and the valid OTU only, and a synonym's page stays with its own text.
3. If there are other OTUs: `GET /contents?otu_id[]=…` for all of them in one request, only to learn which have content.
4. `GET /otus/:id/inventory/content` for each of those.
5. `GET /citations?citation_object_type=Content&citation_object_id[]=…&extend[]=source`, one request for all texts shown. `inventory/content` does not carry the citations.

## Citations

A text whose content record is cited has a line "Source:" (or "Sources:") under it, with the short reference ("LeConte & Horn, 1876:184–185", three or more authors as "et al."), several separated by ";". A click opens the full reference in the shared `../_shared/ReferenceModal.vue`, the short form comes from `../_shared/citationText.js`. 19 citations on content in the project on 2026-10-12, at most 2 on one text.

The text itself always comes from `inventory/content`, never from `/contents`: `inventory/content` gives the rendered HTML and the topic name, `/contents` the raw Markdown and a topic id.

## Links in the text

TaxonWorks links three kinds of data in a text, OTUs, sources and taxon names, each written as a path of its own app: `[Otiorhynchus civis Stierlin, 1861](/otus/723793)`, `[Meregalli, 2017](/sources/226105)`. Rendered as is, the link points next to TaxonPages (in hash mode outside the app). `contentLinks.js` rewrites every text before it is shown:

| Link in the text | On the page |
|---|---|
| `/otus/:id` | the TaxonPages page of that OTU (a real link, opens in a new tab with Ctrl/middle click) |
| `/sources/:id` | opens the Reference modal (`GET /sources/:id`, its `cached` reference), there is no source page |
| `/taxon_names/:id` | the page of the name's OTU (`GET /otus?taxon_name_id[]=`, picked by `pickTaxonPageOtu()`) |
| any other app path, only if written by hand (`/images/12`) | the TaxonWorks app, new tab |
| external link | new tab |
| a bare URL in the text (a DOI written out) | made a link, new tab |

On 2026-10-16 the project's 40 texts had OTU, source and external links and bare DOIs. Taxon name links were not in use yet.

## Gotchas


- Never call `/contents` with an empty `otu_id[]`, it answers with every content record of the project.
- If the synonym lookup fails, the panel shows the page's own content and nothing else, without an error. If the citation lookup fails, the texts are shown without sources.
- `/contents` and `/citations` are read as one page each (1000 and 500 rows). The whole project has 37 content records, so this is far off. A taxon beyond that would lose texts or sources without an error.
- The name in "Entered under" follows the naming rule every display shares, `otuNaming()` in `../_shared/otuLink.js` (see `../_shared/readme.md`, "otuTag.js and otuLink.js"): the taxon name with author, or the OTU's own name when it differs from the taxon name ("Carex sp."). For that the coordinate request asks for `extend[]=taxon_name`. An OTU on the page's own taxon name without a name of its own reads the same as the page's taxon.
- If the request for the page's own content fails, the texts of the other OTUs are still shown.

Tests: `node --test 'panels/PanelContentV2/**/*.test.js'`
