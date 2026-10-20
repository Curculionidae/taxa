# PanelKeys

Keys panel on the OTU page (`panel:keys`). Lists dichotomous keys, interactive keys and image matrices under "To" (keys scoped to this taxon) and "In" (keys this taxon appears in). A key under "To" is never repeated under "In", although TaxonWorks returns scoped keys in both lists.

## Where the keys come from

1. `/otus/:id/inventory/keys` for the page's OTU (the package source).
2. The same for every coordinate OTU of the taxon (same taxon name, different OTU). The endpoint matches a key's leaf only by its exact `otu_id`.
3. Two more sources:
   - **Synonyms.** `/taxon_names?taxon_name_id[]=X&synonymify=true` gives the taxon's synonyms, then their OTUs, then each OTU's keys. Example: key 35046 is scoped to *Rhinonus*, now a synonym of *Stenancylus*, and shows on the *Stenancylus* page.
   - **Simple keys.** Leads with `is_virtual: true`: one root and a flat list of OTUs, no couplets (example: key 35019, *Datonychus*). TaxonWorks leaves them out of `inventory/keys` on purpose, and `/leads` returns them only with `is_virtual=true`. `simpleKeys.js` loads that list and each key's OTUs (`/leads/key/:id`, at most 4 at a time, skipped for a key whose root is the page's OTU) once per session. `/leads` has no OTU filter, so there is no cheaper way to find them. The chip comes from `_shared/SimpleKeyChip.vue`. A simple key whose root is one of the taxon's OTUs is listed under "To"; one that lists one of them among its OTUs is listed under "In". Synonym OTUs count too.

All sources start at the same time on mount (each OTU's keys are requested as soon as that OTU is known), and the panel renders once, with everything.

A key found only through a synonym gets a grey "(as *Synonym* Author, Year)" after its title.
