# _shared

Not a panel — no `main.js`, so the taxonpages panel loader ignores this directory (same convention as `panels/_gbifShared/`). Holds components shared by multiple panels, imported by relative path.

## fetchAllPages.js

`fetchAllPages(url, params, { per = 500, concurrency = 4, cacheKey, signal } = {})` → follows the `pagination-total-pages` response header to fetch every page of a paginated index endpoint instead of assuming one `per`-sized page has everything, returning the flattened array of all pages' records. Remaining pages run through a small worker pool (`concurrency`), not one unbounded `Promise.all` burst. When `cacheKey` is given, every page (not just the first) is routed through `useOtuPageRequest` under its own key (`cacheKey`, `${cacheKey}:page2`, ...) so the package's debug "view JSON used to build this page" link reflects the full fetch.

**Depended on by:**

| Panel | File | Use |
|---|---|---|
| PanelAssertedDistributions | `../PanelAssertedDistributions/PanelAssertedDistributions.vue` | otus, asserted_distributions, citations, data_attributes |
| PanelSpecimenOccurrences | `../PanelSpecimenOccurrences/components/SpeciesBars.vue` | taxon_names, otus |
| _shared | `./assertedDistributionTags.js` | tags |

## assertedDistributionTags.js

`fetchAssertedDistributionTags(ids, { signal } = {})` → a `/tags` fetch (paginated via `fetchAllPages`, since a large record set can exceed one page of tag rows), resolving to `Map<assertedDistributionId, keywordName[]>` (empty Map on error or empty input).

**Depended on by:**

| Panel | File | Use |
|---|---|---|
| PanelMapV2 | `../PanelMapV2/store/useDistributionStore.js` | popup keyword pills; an `Adventive` keyword also drives the hatched polygon styling |
| PanelAssertedDistributions | `../PanelAssertedDistributions/PanelAssertedDistributions.vue` | yellow keyword pills in the area cell |

## imageCitations.js

`fetchImageCitations(imageIds)` → batched, chunked, paginated
`GET /citations?citation_object_type=Image&citation_object_id[]=…&extend[]=source`,
resolving to `Map<imageId, Citation[]>` (empty Map on error / empty input).
`groupCitationsByImage(rows)` is the pure grouping step, unit-tested in
`imageCitations.test.js`.

Exists because **no image endpoint serialises citations** — `extend[]=citations`
is a silent no-op on `/otus/:id/inventory/images` and `/images` (verified against
sfg, 2026-09; the TW commit that adds it to `/images/:id` is unmerged). This is
the only way to read an image's full citation list.

`imageIdFromOriginalPng(str)` — `"/api/v1/images/847941/scale_to_box/…"` → `847941`.
**`/otus/:id/inventory/images` and a key lead's `figures[]` both key the image by
id upstream but omit it from the object**, so `original_png` is the only carrier
that survives; an external (iNat / GBIF) image has no `original_png`, so `null`
also reads as "not a TaxonWorks image, no citations to fetch". `ImageLightbox`
resolves the id this way (`twImageId`), and `PanelGallery`/`normalizeKeyImage`
now pass `original_png` through instead of dropping it.

`@/utils/request` is imported *dynamically* inside `fetchImageCitations` so the
unit test can import the pure helpers without resolving the `@/` alias.

**Depended on by:** `./ImageLightbox.vue` (lazy, per visible image + neighbours).

## typeMaterialSpecimen.js

`fetchTypeSpecimens(otuId)` returns the type specimens of the OTU's name and of every synonym: `[{ collectionObjectId, typeMaterials: [{ id, label }] }]`, cached per OTU (not when a request failed along the way). `fetchTypeSpecimenRecord(id)` is one specimen's DwC record (`/collection_objects/:id/dwc`), cached so the map and the records list ask once. `specimenByTypeMaterialId(list)` turns that into `Map<typeMaterialId, collectionObjectId>`.

Needed because a type specimen without a taxon determination is not tied to the OTU: it is missing from `/otus/:id/inventory/dwc.json`, and `distribution.geojson` carries it only as a `TypeMaterial` entry (own valid name) or not at all (synonym). There is no public `/type_materials` route, so it goes `/otus/:id` (taxon name id), `/taxon_names?taxon_name_id[]=…&synonymify=true`, `/collection_objects?type_specimen_taxon_name_id=…` once per name (the `[]` form of that filter is ignored and returns every type in the project), then `/collection_objects/:id?extend[]=type_material` per specimen (that extend only works on the show route). Never throws. Tests: `typeMaterialSpecimen.test.js`.

| Panel | File | Use |
|---|---|---|
| PanelMapV2 | `../PanelMapV2/store/useDistributionStore.js` | adds type specimens the geojson lacks to the map |
| PanelMapV2 | `../PanelMapV2/components/MapPopup.vue` | makes a bare Type Material popup row open the DwC modal |
| PanelSpecimenOccurrences | `../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue` | lists type specimens the DwC inventory lacks |

## inatObservation.js

`fetchInatObservations(refs)` → batched, chunked, paginated
`GET /identifiers?identifier_object_type=…&identifier_object_id[]=…`, keeping only
`Identifier::Global::Uuid::InaturalistObservation` rows, resolving to
`Map<specimenKey, { uuid, url }>` (empty Map on error / empty input). `refs` are
`{ type, id }` specimen refs; `specimenKey` is `./specimenRef.js`'s `Type:id`, since
CollectionObject and FieldOccurrence ids collide as bare numbers. **That one call is
both the detection and the payload** — a specimen that wasn't imported is simply absent
from the Map, so callers never need a separate "is this from iNaturalist" test.
`indexInatIdentifiers`, `observationUrl`, `formatRecordedBy` and `inatSourceLabel` are
the pure steps, unit-tested in `inatObservation.test.js`.

`canHaveInatObservation(type)` → **`FieldOccurrence` only**, and it is the single place
that rule lives on our side. TaxonWorks enforces it: the identifier model validates
`object_is_field_occurrence`, so it cannot be saved on a CollectionObject (details in
the function's JSDoc). `fetchInatObservations` filters refs on it and short-circuits
**before** its dynamic import, so a caller holding only CollectionObjects costs no
request and no module load, and `DwcTable` just calls it for every record.
`indexInatIdentifiers` stays type-agnostic, so widening this is a one-line edit.

Exists because **the DwC payload cannot tell you a record was imported**. Every record
gets an `occurrenceID`: for an import that value *is* the iNaturalist observation uuid
(FO 5022), for everything else it mirrors the record's own `TaxonworksDwcOccurrence`
GUID (FO 5024/5025). Indistinguishable by inspection, so linkifying `occurrenceID`
blindly would yield dead links for most records. `georeferenceSources: "iNaturalist"`
hints at the importer but carries no id.

**No iNaturalist API call is involved**: `https://www.inaturalist.org/observations/<uuid>`
resolves the uuid route directly (confirmed in a browser, 2026-09-20), so iNaturalist
being unreachable cannot affect a page using this. Resolving the numeric observation id
would need `GET api.inaturalist.org/v1/observations?uuid=a,b,c` — deliberately not done,
since no caller displays the number.

`type[]` is ignored by `/identifiers` (it returns every type regardless), so the type
filter is client-side. `@/utils/request` is imported *dynamically* inside
`fetchInatObservations` so the unit test can import the pure helpers without resolving
the `@/` alias.

**Depended on by:** `./DwcTable.vue` (the Source row). Batched and `Type:id`-keyed so a
list view can resolve a whole page in one request — `PanelBiologicalAssociationsV2` is
the intended next consumer, for the linkified collector name in its Citations column,
once that panel's rework lands.

## scientificName.js

The one place that decides how a plain-text scientific name is italicised. Two functions
(plus `typeStatusHtml`) over one parser, so the rules cannot drift apart again (until 2026-10 `MapPopup` and
`ImageLightbox` each had their own, differing, guesser):

| Function | For |
|---|---|
| `splitScientificName(name, { rank })` | `{ italic, plain }` for templates that render `<em>{{ italic }}</em>` themselves |
| `scientificNameHtml(name, { tag, rank })` | ready `v-html` string; also sets `subsp.`, `cf.`, `[sic]`, `×` upright inside the name |

Rules: must start with a capitalised word; names above genus are upright (by `rank` when the
caller has it, e.g. DwC `taxonRank`, else by ending: `-idae`, `-inae`, `-oidea`, `-ini`,
`-aceae`, `-oideae`, plus a short list of common higher taxa); `(Subgenus)` after the genus
belongs to the name; lowercase words are epithets until an author particle (`de`, `von`,
`d'Orbigny`), a connective (`in`, `ex`, `sensu`) or anything capitalised.

Checked against TaxonWorks' own markup (`cached_html`) for 12,000 names of this project:
same italics for all but two when the rank is passed (a `[sic]` inside a subgenus bracket,
and the placeholder name "Root"), 99.5% without it. The rank-less misses are subtribes in `-ina`, which cannot be told from
genera (*Chrysolina*) by spelling. Pass `rank` wherever it is at hand.

Only fields that are a name by definition go through it (DwC `scientificName`, the name
in `typeStatus`, OTU labels). Free text such as captions and figure descriptions is shown
verbatim: in a sentence nothing tells a genus from any other capitalised word, and a scanner
for that was tried and removed (it italicised "Photo taken near").

It stays a guess from text. Where TaxonWorks delivers markup (`object_tag`, `cached_html`),
use that instead, see `otuTag.js`.

## otuTag.js and otuLink.js

How an OTU is named and linked wherever one is shown as itself (a partner in an
association, a key's scope, a search hit). It depends on what TaxonWorks holds for it:

| The OTU has | Shown as | Links to |
|---|---|---|
| a taxon name only (the healthy case) | the taxon name, TaxonWorks' markup | its own page |
| an own name only (a gap in the database, no taxon name linked) | the own name, all there is | its own page |
| both, saying the same ("Isatis tinctoria" on *Isatis tinctoria* L.) | the taxon name | its own page |
| both, and they differ (deliberate: "Carex sp.", or "Salix spp." for several species, filed on the genus) | the own name alone | the page of the taxon (Carex L.) |

Without this, the last two read doubled: TaxonWorks tags such an OTU
`<i>Carex</i>&nbsp;<b>Carex sp.</b>` and labels it `Carex L. Carex sp.`.

"The page of the taxon" is the OTU on the same TaxonName that has no name of its own
(lowest id). When there is none ("Arisaema sp." is the only OTU on Arisaema) the OTU keeps
its own page. "Saying the same" ignores authorship and a subgenus in brackets. A specimen
is not redirected: its link stays on the OTU it is filed under.

**Read from the OTU record, not from markup.** `/otus?otu_id[]=…&extend[]=taxon_name`
returns `name` (the own name) and `taxon_name` (`cached`, `cached_html`,
`cached_author_year`, `rank`) as plain fields, batchable. That is the source
`otuLink.js` uses. An association only carries its partner's `object_tag` /
`object_label`, so the helper fetches those records itself (one batched request, shared
between panels). Where a panel already loads OTUs, add `extend[]=taxon_name` to that call
and pass the rows, and naming costs no request.

| Export | Use |
|---|---|
| `resolveOtuLinks(otus)` | `otuLink.js`. The call a display needs. Takes OTU records or association entities, returns `Map<String(otuId), { html, label, ownName, otuId }>`: the name (as HTML and as an italic + plain pair) and the page to link to, together, so a display cannot apply one half and forget the other. In-flight lookups are shared, a failure is logged and not cached, never rejects. |
| `otuLinkFallback(otu)` | `otuLink.js`. The same shape from what the object itself carries, linking to itself: for a list that renders while its links resolve. |
| `otuNaming(otu)` | `otuLink.js`. The pure naming decision behind both. |
| `extractOtuTagSpan`, `otuDisplayNameHtml`, `otuDistinctOwnName`, `otuTaxonLabel`, `otuLinksToTaxonPage`, `withoutOtuOwnName` | `otuTag.js`. The same cases read off the tag markup. The fallback when no record is at hand, and what the associations raw table renders with (it works on tags throughout, for the "now" tail of a synonym and a specimen's "det." span). Checked against all 119 doubly-named OTUs in the project on 2026-10-12: tag and record agree on every one. |
| `identifiedAsNameHtml`, `repeatsTypeStatusName` | `otuTag.js`. See DwcTable.vue below. |

Never show a raw `object_tag` / `object_label` for an OTU. Applied in: the biological
associations panel (raw data table), DwcTable's associations section, the association chip
in PanelSpecimenOccurrences, the keys index scope, and the map's OTU search result list
(its title shows the page's own OTU, named from the tag). The page header, breadcrumb and
autocomplete are rendered by the package and do not go through here.

DwcTable's "identified as <old name>" is about the name a specimen was determined as, so
`identifiedAsNameHtml` always gives the taxon name there.

A wrong pairing in the database shows as it is entered: "Melissa sp." filed on *Melissa
officinalis* reads "Melissa sp." and links to the species page. That is one to fix in
TaxonWorks, not here.

The tag reader had gone blind without anyone noticing: until 2026-10-12 it knew only an
older nested span, so on every live tag it returned null and callers fell back to the raw
label. One more reason the record is the source to prefer. If names in the associations
raw table turn plain or doubled again, check the tag shape first.

## TypeStatusChip.vue

The type-status chip: "holotype of *Aus bus* Author, 1900" on a red label for a name-bearing type, a yellow one for other type material (paratype, ...), black print on both. One prop, `status`: one status or a whole DwC `typeStatus` cell (" | "-joined). Every status gets a chip of its own, coloured on its own; nothing is rendered for an empty one. Colour comes from `typeLabelStyle()` in `typeStatus.js`, the italics from `typeStatusHtml()` in `scientificName.js`, the tokens from `panel-tokens.css`, which the component imports itself. Spacing is the caller's: pass a margin class.

Depended on by `DwcTable.vue` (identity block), `PanelSpecimenOccurrences/components/ListRecords.vue` (list rows) and `PanelMapV2/components/MapPopup.vue` (specimen and type material rows). Until 2026-10-11 the first two each had their own copy of the markup and the map popup printed the status as plain text. If you change it, check all three.

## DwcTable.vue

Modal showing the full DarwinCore record for a CollectionObject or FieldOccurrence: institution (resolved to full name via GRSciColl), identification, collection event, location, coordinates (with OpenStreetMap link), biological associations, and associated media thumbnails. Fetches `/collection_objects/:id/dwc` or `/field_occurrences/:id/dwc`.

**Source row**: a record TaxonWorks imported from iNaturalist shows
`Source: iNaturalist observation by <recordedBy>` in the identity block, directly under
the citation row and styled to match it, linking to the observation (`./inatObservation.js`).
Independent of citations — a record can have either, both, or neither. It is an `<a
target="_blank">` rather than the citation row's `<button>` because it leaves the site
instead of opening `ReferenceModal`.

**Identified by row**: `Identified by <identifiedBy>, <dateIdentified>`, with `unknown`
standing in for a missing determiner. When the specimen was identified as a name that is
now a synonym, TaxonWorks re-points every name field in the DwC payload to the valid name,
so the row appends the name actually used: `Identified by unknown, 2012 (as *Otiorhynchus
(Arammichnus) dieckmanni* Magnano, 1979)`. That name is only recoverable from the
determination's own OTU (`dwc.otu_id`, one extra `GET /otus/:id`), whose `object_tag` reads
`<old name> <em>now</em> <valid name>`; `identifiedAsNameHtml()` in `./otuTag.js` parses it,
keeping TaxonWorks' own `<i>` italics. Example: the specimens listed on the page of OTU
722800 (their `dwc.otu_id` is the synonym's OTU, 722802).

A type designation counts as its own identification. When the identified-as name is the
very name the type-status badge states ("paratype of *Afghanocleonus kabakovi*
Ter-Minassian, 1976"), the `(as …)` part is dropped (`repeatsTypeStatusName()` in
`./otuTag.js`, a tag/entity/case-insensitive comparison against the name after the last
" of "). With no determiner, date or qualifier recorded either, the row then disappears
entirely instead of reading `Identified by unknown (as …)`. A differing name, or a bare
status such as "paratype" that names no taxon, still shows `(as …)`.

Exposes `show({ id, type })` via `defineExpose`, where `type` is `'CollectionObject'` or `'FieldOccurrence'` (see `@/constants/objectTypes`). Callers hold a `ref` to the component and call `.show(...)` from a click handler; the modal renders itself (a `VModal`).

**Depended on by:**

| Panel | File | Trigger |
|---|---|---|
| PanelMapV2 | `../PanelMapV2/PanelMapV2.vue` | Clicking a Collection Object / Field Occurrence row in a map marker popup |
| PanelMapV2 | `../PanelMapV2/components/Search/OtuSearch.vue` | Clicking a row in the OTU search overlay's map popup |
| PanelGallery (via ImageLightbox) | `./ImageLightbox.vue` | Clicking the ⓘ button on a CO/FO depiction in the lightbox — rendered inside a fixed-position overlay, so the `<DwcTable>` usage is wrapped in `<Teleport to="body">` |
| PanelSpecimenOccurrences | `../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue` | Clicking the ⓘ button on a record row |
| PanelBiologicalAssociationsV2 | `../PanelBiologicalAssociationsV2/PanelBiologicalAssociationsV2.vue` | Clicking the ⓘ button next to a subject/object specimen in the associations table (including an `AnatomicalPart` that wraps a CO/FO — see `resolveSpecimenRef` in that panel's `makeBiologicalAssociation.js`) |

DwcTable itself **opens `./ImageLightbox.vue`** (async import) when a media thumbnail is clicked, passing `:show-info-button="false"` so that lightbox can't re-open a DwcTable (recursion).

If you change this file, sanity-check every call site above — none of them keep their own copy.

**`associatedMedia` URL format**: pipe-separated absolute URLs like `https://sfg.taxonworks.org/api/v1/images/aa7639596f6a04744668dbec7c7493a3` (hex fingerprint, not numeric ID). Fetched via `makeAPIRequest` by extracting the path with `/\/api\/v1(.+)/` and calling `makeAPIRequest.get(m[1], { params: { extend: ['attribution', 'source'] } })`; the response has `{ id, thumb, original, medium, attribution, source }` at the top level.

## ImageLightbox.vue

The one fullscreen image viewer for the whole project (a fork of the package `@/components/ImageViewer` — the richer version that resolves DWC data and links to the specimen modal). Formerly `PanelGallery/GalleryViewer.vue`; moved here 2026-08-30.

Fixed, full-viewport overlay (`fixed inset-0 z-[10000]`, no internal Teleport — wrap it in `<Teleport to="body">` when mounting from inside another fixed overlay). Renders: the current image, prev/next controls, a per-image metadata block, and a thumbnail strip. Keyboard: ←/→ navigate, Esc closes, Tab is focus-trapped.

**Props**

| Prop | Type | Default | |
|---|---|---|---|
| `images` | Array | required | the full list (see image shape below) |
| `index` | Number | required | index of the shown image |
| `next` | Boolean | `false` | a next image exists |
| `previous` | Boolean | `false` | a previous image exists |
| `showInfoButton` | Boolean | `true` | show the ⓘ button that opens `DwcTable` for a CO/FO depiction, and render the nested `DwcTable`. Pass `false` when mounting from within a `DwcTable` to stop the recursion. |

**Emits:** `close`, `next`, `previous`, `selectIndex(i)` — the parent owns `index` and the list.

**Image object shape** (all keys optional except a URL to show):

```ts
{
  id:          number | string,
  thumb:       string,
  medium:      string,
  original:    string,          // shown at full size
  attribution: { label: string },
  source:      { label: string },   // may contain <a> HTML
  citations:   Citation[],          // optional — if a caller already has them.
                                    // Otherwise the lightbox self-fetches per
                                    // image via imageCitations.js (no endpoint
                                    // serialises them).
  depictions:  Depiction[],         // Otu / CollectionObject / FieldOccurrence — drives the name block + ⓘ
  figure_label: string,             // plain image with no Otu/CO/FO depiction: shown bold …
  caption:      string,             // … plain text, run through the name-italiciser, beneath the label
  captionHtml:  string              // … OR pre-sanitised HTML (keys, URL-linkified) rendered verbatim — wins over `caption`
}
```

If `depictions` has an Otu / CO / FO entry the block shows the parsed taxon name (CO/FO also fetch `/…/dwc` for type status + the ⓘ button). Otherwise, if `figure_label` / `caption` / `captionHtml` are set, they render as a bold-label + caption block. Attribution / source / citations always render below when present.

**Citations** are fetched by the lightbox itself (`imageCitations.js`, lazily for the shown image ± 1) unless the caller already put a non-empty `citations` array on the image object. Rendered as `Image citation: <short ref>` (`Image citations:` when >1); the short ref is a `<button>` that opens the `Reference` modal. The modal body is `source.cached` (else the short ref) run through `sanitizeAndLinkifyHtml` from `@/utils` — the same helper the vanilla citation renderers use (`ModalCitations.vue`, `PanelCitationsRow.vue`); it strips unsafe tags and turns the trailing "Available at https://…" into a link. There is no reusable *reference modal* in the package — `ModalCitations.vue` is bound to a `biologicalAssociation`. The modal is a **direct child**, not `<Teleport>`ed — VModal's overlay is only `z-[2000]` and would sit behind this `z-[10000]` viewer from `<body>`; as a child it stacks inside the viewer's context (same as the ⓘ `DwcTable`). While it is open the viewer ignores keys so Escape/←/→ act on the modal.

**Depended on by:**

| Panel | File | Images |
|---|---|---|
| PanelGallery | `../PanelGallery/PanelGallery.vue` | OTU inventory images → subordinate-taxa → iNaturalist fallback (`showInfoButton` on) |
| PaneliNaturalist | `../PaneliNaturalist/PaneliNaturalist.vue` | curated iNaturalist taxon photos |
| PanelBiologicalAssociationsV2 | `../PanelBiologicalAssociationsV2/PanelBiologicalAssociationsV2.vue` | BA plates (`figure_label` / `caption`, no depiction structure) |
| PanelSpecimenOccurrences | `../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue` | specimen `associatedMedia` (depictions carry CO/FO type) |
| DwcTable | `./DwcTable.vue` | the modal's own `associatedMedia` strip (`showInfoButton` off) |
| keys module | `../../modules/keys/components/LeadFigures.vue` | lead figures / "+N more images" — taxon-image fallback carries full `depictions` / `attribution` / `source` / `citations`; a key's own figure uses `captionHtml` |

If you change this file, check all six call sites — the contract is `images` + `index` + the four events; keep it stable.

## adventive.js / objectTags.js

`objectTags.js` → `fetchObjectTags(type, ids)`: `/tags` of any record type as `Map<id, keyword[]>`, chunked by 100 ids, errors resolve to an empty Map (`assertedDistributionTags.js` is a thin wrapper). `adventive.js`: `hasAdventiveKeyword`, `adventiveIds(tagsById)`, `fetchAdventiveSpecimenKeys(refs)` (Set of `"<type>:<id>"` for CO/FO tagged "Adventive") and `ADVENTIVE_CHIP_HTML` (purple chip, `--pp-adventive` tokens from `panel-tokens.css`). Used by PanelMapV2 (store: purple specimen markers + cluster slice + "Adventive specimen" legend; MapPopup chip), `DwcTable.vue` (identity block) and `PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue` (list row; a group row only when all its records are tagged, otherwise per record under "Individual records"). On the map a type status wins over the adventive colour, same as for polygons.
