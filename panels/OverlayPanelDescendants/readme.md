# OverlayPanelDescendants

The package's built-in descendants panel, unchanged, plus curator-mode pencils. Id
`panel:overlay-descendants`, used instead of `panel:descendants` in `config/taxa_page.yml`.
Experimental (2026-10-19).

In curator mode (`?curator=1`, see `panels/_shared/curatorMode/`) every taxon name and every
synonym in the tree gets a pencil linking to its TaxonWorks edit page
(`/tasks/nomenclature/new_taxon_name?taxon_name_id=…`). For the public it renders exactly
the package panel and makes no extra requests.

**Not a copy.** `OverlayPanelDescendants.vue` renders the package panel (imported through its own
`main.js`, the one internal path used) inside a `display: contents` div, and
`lib/decorateTree.js` adds the pencils to the rendered tree, watching it with a
MutationObserver because branches load as they are expanded. It relies on the package
markup: a tree node is an `<li>` with a direct child link to `/otus/<id>`, its synonyms sit in
`ul.synonyms > li > span + span`. If a package update changes that, the pencils silently
stop appearing; the panel itself is unaffected. The added links carry `data-tw-edit` and are
removed again when curator mode is left.

`/otus/:id/inventory/taxonomy` carries no taxon name ids (nodes have an OTU id, synonyms are
bare HTML), so `lib/taxonNameIds.js` looks them up only while curator mode is on: one
batched `/otus?otu_id[]=` and one `/taxon_names?taxon_name_id[]=…&synonymify=true` per batch
of nodes, and matches each shown synonym by its text (original combination, with or without
author parentheses, or current form). A synonym whose text cannot be matched, or that two
names share, gets no pencil.

To go back: put `panel:descendants` back in `config/taxa_page.yml`.
