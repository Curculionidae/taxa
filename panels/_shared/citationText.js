/**
 * citationText.js
 *
 * Small text helpers for displaying a /citations row's `citation_source_body`
 * as a short, clickable label — the full text (or, better, `source.cached`)
 * belongs in ./ReferenceModal.vue, one click away.
 *
 * Depended on by:
 *   - ./DwcTable.vue
 *   - ./ImageLightbox.vue
 *   - ../PanelAssertedDistributions/PanelAssertedDistributions.vue
 *   - ../PanelBiologicalAssociationsV2/PanelBiologicalAssociationsV2.vue
 *   - ../PanelMapV2/components/MapPopup.vue
 *   - ../../modules/keys/KeyView.vue
 *
 * If you change this file, sanity-check all six call sites.
 */

/**
 * citation_source_body can carry an inline topic annotation as raw markup
 * (e.g. a "Distribution" pill: `<span class="annotation__citation_topic">...`).
 * Strip it before using the string as a plain-text button label — the full,
 * unstripped text (rendered via v-html) belongs in the reference modal.
 * @param {string} s
 * @returns {string}
 */
export function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '')
}

/**
 * "Author, Other, Another & Last, 2020:12" -> "Author et al., 2020:12".
 * Only shortens 3+-author citations (a comma before the final "&" is what
 * distinguishes "A, B & C" from a plain two-author "A & B"); anything else
 * — one author, two authors, or a body that doesn't parse as "…, YEAR" at
 * all — is returned unchanged.
 * @param {string} body
 * @returns {string}
 */
export function shortCitation(body) {
  if (!body) return ''
  const m = body.match(/,\s*(\d{4}[a-z]?(?::[^\s,]+)?)\s*$/)
  if (!m) return body
  const year = m[1]
  const authorsStr = body.slice(0, m.index)
  const ampIdx = authorsStr.lastIndexOf('&')
  if (ampIdx < 0 || !authorsStr.slice(0, ampIdx).includes(',')) return body
  return `${authorsStr.split(',')[0].trim()} et al., ${year}`
}
