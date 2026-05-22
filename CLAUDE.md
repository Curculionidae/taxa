# TaxonPages — Curculionoidea project

Git repo root: `taxa/` (i.e. `/home/jakobj/Data/01Aktuelle_Projekte/0_TaxonWorks/TaxonPagesDev/taxa`).


TaxonPages is distributed as the NPM package `@sfgrp/taxonpages`. This project consumes it — custom panels, config, and components live locally; the framework comes from `node_modules`.

API: `https://sfg.taxonworks.org/api/v1` · token in `config/api.yml`.
Dev server: `npm run dev` → http://localhost:5173/ (SPA) · `npm run dev:ssr` → http://localhost:6173/ (SSR)

## Project layout

```
taxa/
  panels/          ← custom panels (all work happens here)
  config/          ← api.yml, taxa_page.yml, style/theme.css
  components/      ← local component overrides
  node_modules/@sfgrp/taxonpages/src/  ← package source (read-only)
```

Custom panels each need a `main.js` (registers the panel id) and are wired up in `config/taxa_page.yml`.
CLI: `taxonpages package list/add/remove/unpack` manages panels and packages.

## Critical: path alias

`@/` resolves to **`node_modules/@sfgrp/taxonpages/src/`**, NOT to the local `taxa/` tree.
So `@/utils/request`, `@/components/...`, `@/constants/objectTypes` etc. all come from the package.

## Tailwind v4 — color utilities

Use `text-secondary`, `bg-secondary`, `border-secondary` (maps to `--color-secondary`).
**`text-secondary-color` is NOT a valid utility** — generates no CSS. It looks fine on `<a>` tags (browser default link color) but silently fails on `<span>`, `<div>`, `<button>`. All occurrences have been purged; do not reintroduce it.

Other useful tokens: `text-base-content`, `bg-base-foreground`, `border-base-muted`, `text-secondary-content`.

## makeAPIRequest

Axios instance pre-configured with TaxonWorks base URL and `project_token`. Imported from `@/utils/request` or `@/utils`.

```js
import { makeAPIRequest } from '@/utils/request'

// As a function (GET shorthand used in the package):
makeAPIRequest('/collection_objects/123/dwc')

// As axios instance (preferred in custom panels):
makeAPIRequest.get('/images', { params: { per: 10, extend: ['depictions'] } })
makeAPIRequest.get(`/citations?${params}`)
```

**Use only for the TaxonWorks API.** For external APIs (iNaturalist, GRSciColl) use `axios` directly or `fetch`.

### Known non-existent endpoint
`/repositories` → `{"success": false, "message": "Invalid route"}` — does not exist.

## Global components (no import needed)

VModal, VCard, VCardHeader, VCardContent, VSpinner, VButton, VPagination, VTable (+ cell/row variants),
IconClose, IconPlusCircle, IconSearch, RouterLink, ClientOnly, ImageViewer, GalleryImage, GalleryThumbnailList.

Full list in README.md.

VModal usage:
```html
<VModal @close="myRef = null">
  <template #header><div class="text-sm font-medium">Title</div></template>
  <div class="px-4 pb-4 text-sm" v-html="content" />
</VModal>
```
When inside a fixed overlay (like GalleryViewer), wrap in `<Teleport to="body">`.

## TaxonWorks depiction types

| `depiction_object_type` | Meaning | Name source |
|---|---|---|
| `Otu` | Direct OTU depiction | `dep.label` before `: ` |
| `CollectionObject` | Specimen image | DWC `/collection_objects/:id/dwc` → `scientificName` |
| `FieldOccurrence` | Field occurrence image | DWC `/field_occurrences/:id/dwc` → `scientificName` |
| `CollectingEvent` | Collecting event (ignore) | — |
| `null` / `undefined` | Synthetic (e.g. iNat) | `dep.label` is the taxon name |

**CO `dep.label` is a catalog identifier** (`"CollectionObject 123; uuid: (CollectionObject)."`) — never use it as a display name. Always use `scientificName` from the DWC endpoint.

**OTU `dep.label` format**: `"Genus species Author Year: figure description. (Otu)."` — name is everything before `: `.

## DwcTable component

Two copies (identical except BA copy has an extra OTU link):
- `panels/PanelMapV2/components/DwcTable.vue` — used by PanelMapV2 and GalleryViewer
- `panels/PanelBiologicalAssociationsV2/DwcTable.vue` — used by BA panel

Exposes: `show({ id, type })` where `type` is `'CollectionObject'` or `'FieldOccurrence'`.
Import example: `import DwcTable from '../PanelMapV2/components/DwcTable.vue'`

## Institution name lookup

The TaxonWorks DWC response has `institutionCode` (abbreviation, e.g. `"ZMUH"`) and `institutionID` (a GRBio URL, e.g. `"http://grbio.org/institution/..."`).

To get the full institution name, use the GRSciColl API (public, CORS-enabled):
```js
// Precise: use institutionID as identifier (returns exactly one result if registered)
fetch(`https://api.gbif.org/v1/grscicoll/institution?identifier=${encodeURIComponent(institutionID)}`)

// Fallback: search by code (may return multiple results — handle ambiguity)
fetch(`https://api.gbif.org/v1/grscicoll/institution?code=${encodeURIComponent(code)}`)
// Response: { results: [{ name: "Zoologisches Institut...", code: "ZMUH" }, ...] }
```

**Open issue**: what to display when the code search returns multiple matches — noted in `to do.txt`, pending developer input on whether a `/repositories` endpoint will be added.

## GalleryViewer (panels/PanelGallery/)

- `parsedDepictions`: three-pass computed (OTU first, then CO/FO, then iNat synthetic). CO/FO name suppressed when an OTU depiction is present on the same image (they'd be the same name — showing twice is confusing).
- `dwcCache = reactive({})`: keyed by `depiction_object_id`. Vue 3 reactivity triggers recompute when properties are assigned.
- DWC prefetched for current image ± 1 on index change.
- iNat fallback images have `depictions: [{ label: taxonName }]` with no `depiction_object_type`.

## Image store (useImageStore)

Fetches `/otus/:id/inventory/images.json` with `extend: ['depictions', 'attribution', 'source', 'citations']`. Images already have `citations` array.

The subordinate-taxa fallback in `PanelGallery.vue` must also pass `extend: ['depictions', 'attribution', 'source', 'citations']` to carry citation data through.

## OTU route

```js
{ name: 'otus-id', params: { id: otuId } }
```
