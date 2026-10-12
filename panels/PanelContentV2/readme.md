# PanelContentV2

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.7.2 (npm package setup)

Panel id: `panel:content-v2`. Replaces the package's `panel:content` in `config/taxa_page.yml`.

Shows the topic texts ("content") of the taxon, grouped by topic, like the package panel. In addition it shows what was written on the taxon's other OTUs: the OTUs of its synonyms and other OTUs on its own taxon name ("Carex sp." on Carex L.). The package panel only reads the OTU of the page, and the search sends everyone to the valid OTU, so a text on a synonym's OTU was never seen. Example: *Lixus abdominalis* (OTU 733362) has no content, its synonym *Lixus punctiventris* (OTU 733360) has a "Synonymy" text.

A text from another OTU has a heading "Entered under *name*" above it, the name in semibold and one size larger than the text. The own texts of the page come first inside each topic.

## Requests

1. `GET /otus/:id/inventory/content` for the page's OTU, as in the package panel.
2. Only when the page's taxon is valid (`taxon.is_valid`): `GET /otus?otu_id[]=:id&coordinatify=true` lists the OTUs of the same taxon: the valid one, its synonyms, and any other OTU filed on the page's own taxon name ("Carex sp." on Carex L.). All of them are used (restricting it to the synonyms was tried on 2026-10-13 and taken back the same day, the user wants the texts of OTUs on the same taxon name shown too). Asked from a synonym's OTU, it answers with the synonym and the valid OTU only, and a synonym's page stays with its own text.
3. If there are other OTUs: `GET /contents?otu_id[]=…` for all of them in one request, only to learn which have content.
4. `GET /otus/:id/inventory/content` for each of those.
5. `GET /citations?citation_object_type=Content&citation_object_id[]=…&extend[]=source`, one request for all texts shown. `inventory/content` does not carry the citations.

## Citations

A text whose content record is cited has a line "Source:" (or "Sources:") under it, with the short reference ("LeConte & Horn, 1876:184–185", three or more authors as "et al."), several separated by ";". A click opens the full reference in the shared `../_shared/ReferenceModal.vue`, the short form comes from `../_shared/citationText.js`. 19 citations on content in the project on 2026-10-12, at most 2 on one text.

The text itself always comes from `inventory/content`, never from `/contents`: `inventory/content` gives the rendered HTML and the topic name, `/contents` the raw Markdown and a topic id.

## Gotchas

- Never call `/contents` with an empty `otu_id[]`, it answers with every content record of the project.
- If the synonym lookup fails, the panel shows the page's own content and nothing else, without an error. If the citation lookup fails, the texts are shown without sources.
- `/contents` and `/citations` are read as one page each (1000 and 500 rows). The whole project has 37 content records, so this is far off. A taxon beyond that would lose texts or sources without an error.
- The name in "Entered under" is the OTU's own `name` when it has one ("Carex sp."), because the tag of such an OTU holds the taxon name and the own name run together. Otherwise it is the `object_tag` from TaxonWorks, cut before "now", where TaxonWorks appends the valid name. An OTU on the page's own taxon name without a name of its own reads the same as the page's taxon.

Tests: `node --test 'panels/PanelContentV2/**/*.test.js'`
