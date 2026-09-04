// Pure transforms for key lead images. No Vue, no network — Node-testable.
//
// Two upstream shapes get normalised to one:
//   - TaxonWorks inventory images (/otus/:id/inventory/images.json → images[id]):
//     { id, thumb, medium, original_png, attribution:{label}, source:{label},
//       depictions:[{ label, depiction_object_type }] }
//   - iNaturalist images (built in the composable, mirroring PanelGallery):
//     { id, thumb, medium, original, attribution:{label}, source:{label:'<a…>'},
//       depictions:[{ label: taxonName }] }
//
// Output is the SAME shape every other panels/_shared/ImageLightbox.vue caller
// feeds it (see PanelGallery.vue#normalizeImage): the structured provenance
// fields pass through untouched so the lightbox renders attribution, source and
// citations itself — no flattening here.
//   { id, thumb, medium, original, label, attribution, source, citations,
//     depictions, sourceTag }
// - `original`   → largest source (original_png resolved to a token URL)
// - `label`      → taxon-name fallback for a tooltip; the lightbox derives its
//                  own heading from `depictions`
// - `sourceTag`  → 'TaxonWorks' | 'iNaturalist', for LeadFigures' one-line strip

const TOKEN =
  (typeof __APP_ENV__ !== 'undefined' && __APP_ENV__.project_token) || ''
const API_URL = (typeof __APP_ENV__ !== 'undefined' && __APP_ENV__.url) || ''

// `original_png` comes back as "/api/v1/<path>"; the package strips the first 8
// chars ("/api/v1/") and re-roots it on __APP_ENV__.url with a token query.
export function resolveOriginalPng(originalPng, { apiUrl = API_URL, token = TOKEN } = {}) {
  if (!originalPng) return ''
  return `${apiUrl}/${String(originalPng).substring(8)}?project_token=${token}`
}

// A CollectionObject / FieldOccurrence / CollectingEvent depiction `label` is a catalog
// identifier ("CollectionObject 123; uuid: …"), never a display name — reject those so
// only a real OTU / iNaturalist depiction name is used as the image heading.
const CATALOG_LABEL_RE = /^(CollectionObject|FieldOccurrence|CollectingEvent)\b/i

function firstDepictionLabel(raw) {
  const list = Array.isArray(raw?.depictions) ? raw.depictions : []
  const hit = list.find((d) => d && d.label && !CATALOG_LABEL_RE.test(String(d.label).trim()))
  return hit ? String(hit.label) : ''
}

// sourceTag: 'taxonworks' | 'inaturalist'
export function normalizeKeyImage(raw, { sourceTag = 'taxonworks', apiUrl = API_URL, token = TOKEN } = {}) {
  if (!raw) return null
  const original =
    (raw.original_png ? resolveOriginalPng(raw.original_png, { apiUrl, token }) : '') ||
    raw.original ||
    ''
  const medium = raw.medium || raw.thumb || original
  const thumb = raw.thumb || raw.medium || original
  return {
    id: raw.id,
    thumb,
    medium,
    original,
    // Carried through so ImageLightbox can recover the TW image id for its
    // citation lookup: `/otus/:id/inventory/images` keys images by id but omits
    // it from the object, so `original_png` ("/api/v1/images/<id>/…") is the
    // only place it survives. Absent on iNaturalist images (correct — no TW
    // citations to fetch).
    original_png: raw.original_png || null,
    label: firstDepictionLabel(raw),
    attribution: raw.attribution || { label: '' },
    source: raw.source || { label: '' },
    citations: Array.isArray(raw.citations) ? raw.citations : [],
    depictions: Array.isArray(raw.depictions) ? raw.depictions : [],
    sourceTag: sourceTag === 'inaturalist' ? 'iNaturalist' : 'TaxonWorks'
  }
}

export function normalizeKeyImages(list, opts) {
  return (Array.isArray(list) ? list : [])
    .map((raw) => normalizeKeyImage(raw, opts))
    .filter((img) => img && (img.thumb || img.medium || img.original))
}

// Split a normalised list into the visible preview strip + a "+N more" remainder.
export function pickPreview(list, n = 3) {
  const all = Array.isArray(list) ? list : []
  const count = Math.max(0, Math.floor(n))
  return { preview: all.slice(0, count), rest: Math.max(0, all.length - count) }
}

// The numeric TW image id from a lead figure's `original_png`
// ("/api/v1/images/<id>/scale_to_box/…"), or null. A lead's `figures[]` from
// `/leads/key/:id` carry no `id` field, so this is the only handle on the image
// (e.g. for ImageLightbox's citation lookup).
export function figureImageId(fig) {
  const m = String(fig?.original_png || '').match(/\/images\/(\d+)/)
  return m ? Number(m[1]) : null
}

// Stable identity for a lead figure — the underlying image, ignoring per-lead
// caption / figure_label differences.
export function figureKey(fig) {
  if (!fig) return ''
  const id = figureImageId(fig)
  if (id) return `img:${id}`
  return fig.thumb || fig.medium || fig.original || ''
}

// Split a couplet's per-lead figure lists into couplet-level shared figures and
// per-lead individual figures.
//
// A figure is SHARED when every lead of the couplet carries figures and that
// figure (by figureKey) is present on all of them — e.g. one plate added to both
// leads to illustrate the contrast. Anything else stays with its lead.
//
// `leadFigureLists` is an array parallel to the couplet's leads; each item is that
// lead's `figures` array. Returns { shared: figure[], own: figure[][] } where `own`
// is parallel to the input. Shared figures keep a representative object, preferring
// one that has a caption.
export function partitionCoupletFigures(leadFigureLists) {
  const arrs = (Array.isArray(leadFigureLists) ? leadFigureLists : []).map((a) =>
    Array.isArray(a) ? a : []
  )
  const shared = []

  if (arrs.length >= 2 && arrs.every((a) => a.length)) {
    const keySets = arrs.map((a) => new Set(a.map(figureKey)))
    const common = [...keySets[0]].filter(
      (k) => k && keySets.every((s) => s.has(k))
    )
    for (const k of common) {
      let rep = null
      for (const a of arrs) {
        for (const f of a) {
          if (figureKey(f) !== k) continue
          if (!rep) rep = f
          if (f && f.caption) { rep = f; break }
        }
        if (rep && rep.caption) break
      }
      if (rep) shared.push(rep)
    }
  }

  const sharedKeys = new Set(shared.map(figureKey))
  const own = arrs.map((a) => a.filter((f) => !sharedKeys.has(figureKey(f))))
  return { shared, own }
}

// From a batched /taxon_names response, index { otuId → { name, rank } } for the
// iNaturalist fallback. `otuIdByTnId` maps taxon_name_id → otu_id (from /otus).
// `normRank` is injected (lib/completeness.js#finestRank wrapped by the caller) so
// this stays dependency-free and testable.
export function indexTaxonMeta(taxonNameRows, otuIdByTnId, normRank = (r) => r || '') {
  const out = {}
  for (const row of Array.isArray(taxonNameRows) ? taxonNameRows : []) {
    if (!row || row.id == null) continue
    const otuId = otuIdByTnId?.[row.id]
    if (otuId == null) continue
    out[otuId] = {
      name: row.cached || row.name || '',
      rank: normRank([row.rank]) || ''
    }
  }
  return out
}
