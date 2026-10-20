# Curator mode

Hidden links from the public site into TaxonWorks, for the people who curate the data.
Built 2026-10-19.

## Using it

- Open any page once with `?curator=1`, e.g. `…/#/otus/723768/overview?curator=1`
  (the switch also works before the hash: `…/?curator=1#/otus/1`).
- From then on this browser shows the curator links on every visit (kept in localStorage).
- A red "Leave curator mode" button sits in the top bar. It, or `?curator=0`, turns the
  mode off. Clearing site data or a private window also ends it.

This only hides links. It protects nothing: every TaxonWorks page behind them asks for a
TaxonWorks login.

## What curators see

| Where | What | Opens in TaxonWorks |
|---|---|---|
| Top bar | red "Leave curator mode" button | (turns the mode off) |
| Taxon page header, next to the JSON / DwC buttons | open icon | the OTU in Browse OTUs (`/tasks/otus/browse?otu_id=`) |
| Bibliography search and Recently published, each row | pencil, and PDF icon when the source has a document, in a last column | the source; PDF icon: the source page (see PDFs below) |
| Bibliography source modal (⊕) | pencil and PDF icon, top right | as above |
| Specimen modal (`DwcTable.vue`) | pencil, top right | the specimen or field occurrence editor |
| Specimen modal, More details → TaxonWorks ID | the id becomes a link (plain text for the public) | the record page |
| Image viewer (`ImageLightbox.vue`, every gallery) | top right next to close: photo icon, and a pencil per depiction; none for iNaturalist / GBIF images | photo: the image in Browse Images (`/tasks/images/browse?image_id=`); pencil: the depiction (`/depictions/:id/edit`, ids from `/depictions?image_id[]=`, curator mode only) |
| Key page, header | pencil and open icon after the title | pencil: the key's root lead (`/tasks/leads/new_lead?lead_id=`); open: the key in "Use a key" (`/tasks/leads/show?lead_id=`) |
| Key page, each couplet (full key: end of the row; guided: after "Couplet N") | pencil | the couplet's lead (`/tasks/leads/new_lead?lead_id=`) |
| Map popup (PanelMapV2), each row | pencil at the end of the row: specimen / field occurrence / type specimen, asserted distribution; a BA-linked distribution gets a second pencil for its biological association | the record's editor; association: `/tasks/biological_associations/new_ba?biological_association_id=` |
| Biological associations panel, Raw data | pencil in a last column | the association (`new_ba?biological_association_id=`) |
| Descendants and synonyms panel | pencil after every name and synonym | the taxon name editor |
| Nomenclature references panel | pencil and PDF icon at the right of each reference | the source; PDF icon: the source page |
| Bibliography tab (OTU references) | pencil and PDF icon at the right of each reference | the source; PDF icon: the source page |
| Asserted distributions tab | pencil in the last column, one per merged record | the asserted distribution editor (tags via its annotator) |

The public sees none of this, and no curator-only request is made for them.

## Files (this folder)

- `curatorMode.js`: the switch (`useCuratorMode`, `isCuratorMode`, `startCuratorMode`,
  `leaveCuratorMode`, `readCuratorSwitch`) and the TaxonWorks URLs (`twEditUrl.*`, `twOtuUrl`, `twRecordUrl`).
  Each edit task's id parameter was checked in the TaxonWorks source (development branch,
  2026-10); the OTU link format was given by the user.
- `TwEditLink.vue`: the pencil link for our own templates. Renders nothing outside curator
  mode or without an `href`.
- `pencilIcon.js`: the pencil SVG path and link classes, shared by `TwEditLink.vue` and the
  overlay pencils.
- `overlayPencils.js`: pencils added to a package panel after it rendered (see Overlay
  panels below): `useOverlayPencils`, `addPencil` (after an element), `addRowPencil` (right
  end of a row, vertically centred), `removePencils`.
- `sourceIds.js`: finds source ids for references a package panel shows only as text
  (match by full citation text, text search as fallback).
- `depictions.js`: an image's depictions with their ids, for the image viewer.
- `sourcePdfs.js`: which sources have a PDF (`/sources?source_id[]=…&documents=true`, batched, cached).
- `TwSourceLinks.vue`: edit + PDF icons for a source, for our own source lists.
- `CuratorModeButton.vue`: the red leave button.
- `OtuTaxonWorksButton.vue`: the open-OTU icon on the taxon page.

Both buttons are placed by the project-root `layout.js` in the framework's layout regions:
`header:after` (the button then moves itself into the top bar with a Teleport, as the bar
has no region of its own) and `taxa_page:header:actions:end` (an official region, "next to
the download buttons").

## Server rendering (SSR)

The server never sees the browser's localStorage, so it always renders the public page. The
browser must first produce the same HTML (hydration) before it may add curator links, or Vue
reports a hydration mismatch. So curator mode starts only when a component is mounted, which
comes after hydration: every component that shows curator links gets the switch through
`useCuratorMode()`, never by importing `isCuratorMode` alone. Curators see the page without
links for a moment, then with them. Without SSR this makes no visible difference.

## Overlay panels

For package panels the links are added without copying the panel. An overlay panel renders
the package panel unchanged (imported through the package panel's own `main.js`) inside a
`display: contents` div, and `useOverlayPencils` adds pencils to its rendered HTML, watching
it for changes while curator mode is on.

Naming: `panels/OverlayPanel<Name>/`, id `panel:overlay-<name>`, swapped in for the package
panel in `config/taxa_page.yml` with the original line left there commented out. `V2` names
are for panels we rebuilt ourselves.

| Overlay | Package panel | Reads from its HTML |
|---|---|---|
| `OverlayPanelDescendants` | `panel:descendants` | `li` with a link to `/otus/<id>`; `ul.synonyms > li > span + span` |
| `OverlayPanelNomenclatureReferences` | `panel:nomenclature-references` | `li > span[title]` |
| `OverlayPanelReferences` | `panel:references-cited` | `li > span:first-child` |

If a package update changes that markup, the overlay finds nothing and adds no pencils; the
panel itself keeps working. After an upgrade, open a taxon page with `?curator=1` and check
the pencils are still there. To drop an overlay, put the package panel id back in
`config/taxa_page.yml`.

Our own panels (asserted distributions, `DwcTable.vue`, the bibliography source modal) use
`TwEditLink` directly in their templates instead.

## Ids the package panels do not carry

- Descendants: the tree has OTU ids and synonym text only. Taxon name ids come from
  `/otus?otu_id[]=` and `/taxon_names?taxon_name_id[]=…&synonymify=true`, synonyms matched
  by text (`OverlayPanelDescendants/lib/taxonNameIds.js`).
- Nomenclature references: the catalog gives only the citation text. Sources come from the
  citations on the name, its synonyms and combinations
  (`OverlayPanelNomenclatureReferences/lib/nomenclatureSources.js`); a reference cited
  elsewhere (e.g. on a relationship) is found by a text search on its first words, exact
  full-text match only. Otiorhynchus armadillo: 22 of 23 by citations, the last by search.
- Bibliography tab: the panel's own response (`/otus/:id/inventory/citations`) carries the
  source ids. The package keeps it in its page request store (`panel:citations`), where the
  overlay reads it; only when it is missing is the request made again.

All of these requests are made only in curator mode.

## PDFs

The PDF icon appears only on sources with a document attached, and opens the source's
TaxonWorks page (`/sources/:id`), whose "Documents" section has the PDF and a viewer: one
click from the PDF. This is also the intended design, not only a workaround: many PDFs are
copyrighted, and this way they stay behind the TaxonWorks login instead of being linked from
the public site (decided 2026-10-19, so no API wish for direct PDF links). A direct link is not possible: the API only says whether a source has a
document (`documents=true` filter), never which one. The files themselves are public
(`/system/documents/document_files/000/048/542/original/<file name>.pdf`, the path being the
document id in groups of three plus the uploaded file name), but neither part is available
without a login. TaxonWorks' web routes answer cross-site requests with
`Access-Control-Allow-Origin: *`, so a browser never sends a curator's login cookie with
them either.

## Copying a panel to another TaxonPages site

Our panels import from `panels/_shared/`, so a copied panel needs that folder anyway, and
`curatorMode/` comes with it. Then:

- The public sees no difference, and no curator-only request is made.
- `?curator=1` works without any further setup (every component with curator links reads
  the switch when it is mounted). The links point to the other site's own TaxonWorks, derived from its API
  URL.
- Without this project's `layout.js` there is no red "Leave curator mode" button and no
  open-OTU button on the taxon page; `?curator=0` still turns the mode off. Copy `layout.js`
  (or merge its two entries into theirs) to get them.
- Overlay panels also depend on the package version's panel markup and the import path of
  the package panel's `main.js` (see Overlay panels).

