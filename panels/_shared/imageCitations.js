/**
 * imageCitations.js
 *
 * Fetches Image citations from TaxonWorks and groups them by image id.
 *
 * Why this exists: none of the image endpoints serialise citations.
 * `/otus/:id/inventory/images` (what `useImageStore` calls) and `/images`
 * both ignore `extend[]=citations` — the `image_inventory` helper has never
 * rendered a citations array, and the one TW commit that adds
 * `extend[]=citations` to the `/images/:id` show route is unmerged (checked
 * against sfg.taxonworks.org, 2026-09; it returns only attribution and, for
 * an image with an `is_original` citation, that origin citation's source).
 *
 * The only way to read an image's full citation list is the generic
 * citations endpoint, the same call the keys / BA / AD / map panels make
 * for their own object types:
 *
 *   GET /citations?citation_object_type=Image
 *                 &citation_object_id[]=…          (repeatable)
 *                 &extend[]=source                 (source object inlined)
 *
 * Depended on by:
 *   - ./ImageLightbox.vue — lazily, for the visible image and its
 *     neighbours, so every lightbox caller (PanelGallery, PaneliNaturalist,
 *     PanelSpecimenOccurrences, PanelBiologicalAssociationsV2, DwcTable's
 *     media strip, modules/keys LeadFigures) shows citations with no
 *     per-caller wiring.
 *
 * If you change this file, sanity-check ImageLightbox's citation display.
 */

// `@/utils/request` is imported dynamically inside fetchImageCitations so that
// unit tests importing only groupCitationsByImage don't have to resolve the
// `@/` build alias (node --test can't).

// citation_object_id[] values per request (URL length guard) and rows per page.
const ID_CHUNK = 80
const PER = 500
const MAX_PAGES = 20

/**
 * The numeric TaxonWorks image id from an `original_png` path, e.g.
 * "/api/v1/images/847941/scale_to_box/…" → 847941. This is the only place the
 * id survives on an image object from `/otus/:id/inventory/images` or a key
 * lead's `figures[]` — both key the image by id upstream but drop it from the
 * object. An external (iNaturalist / GBIF) image has no `original_png`, so a
 * null return also means "not a TaxonWorks image, don't ask for citations".
 * @param {string} originalPng
 * @returns {number|null}
 */
export function imageIdFromOriginalPng(originalPng) {
  const m = /\/images\/(\d+)(?:\/|$)/.exec(String(originalPng || ''))
  return m ? Number(m[1]) : null
}

/**
 * Group raw `/citations` rows by their `citation_object_id` (the image id),
 * preserving row order. Pure — no network. Exported for unit testing.
 * @param {Array<object>} rows
 * @returns {Map<number, object[]>}
 */
export function groupCitationsByImage(rows) {
  const byImage = new Map()
  for (const cit of Array.isArray(rows) ? rows : []) {
    const key = Number(cit?.citation_object_id)
    if (!key) continue
    if (!byImage.has(key)) byImage.set(key, [])
    byImage.get(key).push(cit)
  }
  return byImage
}

/**
 * Fetch Image citations for the given image ids.
 * Never throws — a failed chunk just leaves its images without citations.
 * @param {Array<number|string>} imageIds
 * @returns {Promise<Map<number, object[]>>}  imageId -> Citation[]
 */
export async function fetchImageCitations(imageIds) {
  const ids = [...new Set((imageIds || []).map(Number).filter(Boolean))]
  if (!ids.length) return new Map()

  const { makeAPIRequest } = await import('@/utils/request')
  const all = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    for (let page = 1; page <= MAX_PAGES; page++) {
      const qs = new URLSearchParams()
      qs.set('citation_object_type', 'Image')
      qs.append('extend[]', 'source')
      qs.set('per', String(PER))
      qs.set('page', String(page))
      chunk.forEach((id) => qs.append('citation_object_id[]', id))

      let rows
      try {
        const { data } = await makeAPIRequest.get(`/citations?${qs.toString()}`)
        rows = Array.isArray(data) ? data : []
      } catch {
        break // this chunk's images simply get no citations
      }
      all.push(...rows)
      if (rows.length < PER) break
    }
  }
  return groupCitationsByImage(all)
}
