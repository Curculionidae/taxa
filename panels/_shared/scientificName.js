/**
 * scientificName.js
 *
 * Shared scientific-name text helpers: HTML-escaping, splitting "Genus
 * (Subgenus) species [sic] Author, Year" into an italic name part + plain
 * authorship part, and building the italicized HTML for a DwC typeStatus
 * string ("holotype of Genus species Author, Year").
 *
 * Depended on by:
 *   - ./DwcTable.vue
 *   - ./ImageLightbox.vue (splitScientificName only, imported as splitName)
 *   - ../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue
 *   - ../PanelSpecimenOccurrences/components/SpeciesBars.vue
 *   - ../PanelBiologicalAssociationsV2/makeBiologicalAssociation.js
 *   - ../PanelMapV2/components/MapPopup.vue (escHtml and typeStatusHtml only,
 *     its own splitName, used for OTU target-label name/author splitting, is
 *     a different algorithm serving a different purpose and stays local)
 *   - ../../modules/keys/composables/useKeyTaxonNames.js (escHtml only)
 *   - ../../modules/keys/components/TaxonLink.vue (escHtml only)
 *
 * If you change this file, sanity-check all call sites.
 */

/**
 * Escapes &, <, > for safe interpolation into v-html. Null/undefined-safe
 * (returns '' rather than the literal string "null"/"undefined").
 * @param {*} s
 * @returns {string}
 */
export function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Splits a scientific name into its italic part (genus, optional subgenus,
 * epithet, and a bracketed qualifier like "[sic]") and its plain authorship
 * part.
 * @param {string} name
 * @returns {{italic: string, plain: string}}
 */
export function splitScientificName(name) {
  const words = (name || '').trim().split(/\s+/)
  let i = 1
  while (i < words.length) {
    const w = words[i]
    if (/^[a-z]/.test(w)) { i++; continue }
    if (/^\(/.test(w) && /^[a-z]/.test(words[i + 1] || '')) { i++; continue }
    if (/^\[/.test(w)) { i++; continue }
    break
  }
  return { italic: words.slice(0, i).join(' '), plain: words.slice(i).join(' ') }
}

/**
 * Builds italicized HTML for a DwC typeStatus string, e.g. "holotype of
 * Genus species Author, Year" -> 'holotype of <em>Genus species</em> Author, Year'.
 * Splits on the LAST " of " (not the first), so a status like "one of the
 * syntypes of Aus bus Author, 1900" still italicises only the trailing name,
 * not "the syntypes of".
 * @param {string} status
 * @param {{tag?: string}} [opt] wrapping tag for the italic part (default 'em')
 * @returns {string}
 */
export function typeStatusHtml(status, { tag = 'em' } = {}) {
  const str = String(status || '')
  if (!str) return ''
  const idx = str.lastIndexOf(' of ')
  if (idx === -1) return escHtml(str)
  const prefix = str.slice(0, idx + 4)
  const { italic, plain } = splitScientificName(str.slice(idx + 4))
  return (
    escHtml(prefix) +
    (italic ? `<${tag}>${escHtml(italic)}</${tag}>` : '') +
    (plain ? ` ${escHtml(plain)}` : '')
  )
}
