# PanelGbifImages

> **Compatibility:** `@sfgrp/taxonpages` ≥ 0.5.4 (npm package setup)

Copied from [MortenHofft/taxonpages](https://github.com/MortenHofft/taxonpages) by [Morten Høfft](https://github.com/MortenHofft) on 2026-05-21.

**Note:** Links open `demo.gbif-staging.org` — the GBIF v2 CoL API returns alphanumeric keys (e.g. `LPL3Q`) that the current `www.gbif.org` does not yet support; the staging server does.

---

Displays a carousel of up to 20 still images from the GBIF multimedia API for the matched taxon. Each image shows rights holder, Creative Commons license, and a link to the source occurrence record on GBIF.org. A link to the full gallery view is provided.

Only shown for family-level and below (genus, species, subspecies, variety, etc.). Hidden entirely when no images are available.
