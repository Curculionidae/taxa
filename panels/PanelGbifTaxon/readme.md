# PanelGbifTaxon

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.5.4 (npm package setup)

Copied from [MortenHofft/taxonpages](https://github.com/MortenHofft/taxonpages) by [Morten Høfft](https://github.com/MortenHofft) on 2026-05-21.

**Note:** Links open `demo.gbif-staging.org` — the GBIF v2 CoL API returns alphanumeric keys (e.g. `LPL3Q`) that the current `www.gbif.org` does not yet support; the staging server does.

---

Displays the GBIF name match for the current taxon: accepted name, synonym status, classification breadcrumb, total occurrence count, and a link to the taxon page on GBIF.org.

Uses the GBIF species match API (`/v2/species/match`) with a minimum confidence threshold of 80. If no confident match is found, a "no match" message is shown instead of an empty panel.
