# OverlayPanelReferences

The package's `panel:references-cited` (the taxon page's Bibliography tab), unchanged, plus a
curator-mode pencil at the right of each reference (edit the source in TaxonWorks). Id
`panel:overlay-references-cited`. Source ids come from the panel's own response
(`/otus/:id/inventory/citations`), read from the package's page request store
(`panel:citations`); fetched again only when it is not there. See `panels/_shared/curatorMode/readme.md`.
