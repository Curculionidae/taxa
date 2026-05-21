# PanelGbifTypeSpecimens

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.5.4 (npm package setup)

Copied from [MortenHofft/taxonpages](https://github.com/MortenHofft/taxonpages) by [Morten Høfft](https://github.com/MortenHofft) on 2026-05-21.

**Note:** Links open `demo.gbif-staging.org` — the GBIF v2 CoL API returns alphanumeric keys (e.g. `LPL3Q`) that the current `www.gbif.org` does not yet support; the staging server does.

---

Displays a paginated list of type specimens from GBIF for the matched taxon. Each row shows the type status badge, verbatim scientific name, and collection date, linking to the full occurrence record on GBIF.org.

Only shown for species and genus rank. Supports all standard type status values (Holotype, Paratype, Lectotype, Neotype, etc.).
