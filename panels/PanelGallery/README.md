# PanelGallery (`panel:gallery-v2`)

Image gallery panel for OTU pages. Falls back to subordinate-taxa images, then iNaturalist, when no direct TaxonWorks images exist.

---

## Configuration

In `config/taxa_page.yml`, register the panel as an object and pass options under `bind:`:

```yaml
- - - id: panel:gallery-v2
      bind:
        subMaxImages: 10
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `subMaxImages` | Number | `10` | Maximum images shown when falling back to subordinate-taxa images. Increase for higher-level taxa where more variety is wanted; decrease to reduce API load. |

> **Changing `subMaxImages`** only affects the subordinate-taxa fallback (triggered when the OTU has no direct images). TaxonWorks images and iNaturalist images are not limited by this setting.

---

For a full breakdown of the decision tree, data flow, and component structure, see [ARCHITECTURE.md](./ARCHITECTURE.md).
