# Species map load times

How long the species map takes to draw, before and after the cached shapes
(see "Cached shapes" in readme.md). Measured with
`node scripts/measure-map-load.mjs [--base <site url>]`: headless Chromium,
browser cache off, one fresh page load per species after one warm-up page,
time from opening the page until the map's areas and markers are all drawn.
"Layers" is the number of areas and markers on the map, the same before and
after means the map is the same.

To compare with the site on GitHub once this is deployed:

    node scripts/measure-map-load.mjs --base https://catalog.curculionoidea.org/

## 2026-11-06

| OTU | Species | Live site, old code | Dev server, old code | Dev server, cached shapes | Layers |
|---|---|---|---|---|---|
| 723601 | *Otiorhynchus (Nihus) carinatopunctatus* | 16.7 s | 15.6 s | 3.1 s | 38 |
| 729972 | *Chlorophanus viridis* | 11.7 s | 11.2 s | 2.4 s | 52 |
| 732706 | *Asproparthenis punctiventris* | 12.5 s | 11.7 s | 3.2 s | 36 |
| 730565 | *Pandeleteius (P.) hilaris* | 5.1 s | 5.2 s | 1.9 s | 27 |
| 738662 | *Polydrusus (Metallites) aeratus aeratus* | 6.4 s | 6.0 s | 1.7 s | 23 |

- Live site: https://catalog.curculionoidea.org/ (branch `setup` before the
  change). Dev server: `npm run dev`, shapes served locally, so the cached
  column has no real download time in it; on GitHub Pages it will be somewhat
  higher.
- In every "old code" run the time is almost all the wait for
  `distribution.geojson` (TaxonWorks serialising the shapes: about 93 ms per
  area plus 54 µs per point; Canada alone about 4 s).

### Effect of simplifying the shapes

Same dev server, cached shapes, full-detail shapes swapped in for two species
(two runs each):

| Species | Simplified | Full detail | Shape download, gzip (simplified / full) |
|---|---|---|---|
| *Otiorhynchus carinatopunctatus* | 2.6 – 2.9 s | 4.2 – 4.4 s | 0.44 / 1.75 MB |
| *Chlorophanus viridis* | 2.2 – 2.3 s | 3.4 – 3.6 s | 0.26 / 1.02 MB |

So simplifying (0.005°, 4 decimals) saves about 1.2 – 1.6 s in the browser
(parsing and drawing about a fifth of the points), before any download time,
and cuts the download to about a quarter.
