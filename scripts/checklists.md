# Country checklists (`/checklists`)

Adapted, with permission, from the country checklists of Fleas of the World
Online (jrpletch/fleasoftheworld, `pages/checklists.vue` at 2afe35c).

Files: `pages/checklists.vue` (page), `pages/components/ChecklistMap.vue`
(Leaflet map), `pages/data/` (map helpers, colour tokens),
`scripts/build-checklists.mjs` (cache), `public/checklists/` (cache output).

## Data

Nothing is fetched from TaxonWorks while browsing. `npm run checklists`
writes `public/checklists/index.json` (countries, taxon counts, update date,
each country's cached outline) and `countries/<id>.json` (that country's
records, with citations and place names). See the comment at the top of the
script for how records are placed in countries. In short:

- Asserted distributions by their area's `level0_id`, gazetteers by ISO code,
  else the DwC `country` text; specimens and field occurrences by DwC
  `country`. The DwC export alone leaves gazetteers and many TDWG areas
  without a country.
- Only Curculionoidea, species and subspecies, present records. One taxon per
  name (several OTUs of a name count once).
- Duplicate TaxonWorks country areas are merged (`ALIASES`). Overseas parts
  filed as subdivisions (French Guiana, Guadeloupe, Martinique, Réunion,
  Mayotte under France) get their own checklist (`SEPARATE`) and are cut out
  of the country's outline.
- `/dwc_occurrences` is not paged: that index has no stable order and loses
  about 5% of the rows. The script uses `/dwc_occurrences.csv` (one request).

## Overview of what each checklist contains

The build also writes `public/checklists/overview.html` (served at
`/taxa/checklists/overview.html` on the fork): for every checklist its
TaxonWorks country areas, map outline, split-off parts, and every place its
records come from with the rule that placed them; then everything left out.

## Map

Country outlines come from the species map's shape cache
(`public/map-shapes/`). A country no record uses directly (Spain, used only
through its provinces) is not in that cache, and TaxonWorks gives out a shape
only through a record using it, so those come from
`public/checklists/fallback-shapes.geojson` (Natural Earth). The script lists
countries that have neither. The state/province drill-down still uses
`public/data/subdivisions.geojson` (Natural Earth).

## Updating

`npm run caches` rebuilds map shapes, then checklists, then the home
slideshow pool (about 5 minutes); `./scripts/update-caches.sh` also commits
and offers to push.
