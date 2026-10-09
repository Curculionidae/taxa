/**
 * scientificName.js
 *
 * The one place that decides how a plain-text scientific name is italicised:
 * HTML-escaping, splitting "Genus (Subgenus) species Author, Year" into a name
 * part + authorship part, building ready HTML for a name, and the DwC
 * typeStatus string ("holotype of Genus species Author, Year"). Do not write
 * another local splitter; extend the rules here.
 *
 * Depended on by:
 *   - ./DwcTable.vue
 *   - ./ImageLightbox.vue (splitScientificName as splitName, typeStatusHtml)
 *   - ../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue
 *   - ../PanelSpecimenOccurrences/components/SpeciesBars.vue
 *   - ../PanelBiologicalAssociationsV2/makeBiologicalAssociation.js (scientificNameHtml)
 *   - ../PanelMapV2/components/MapPopup.vue (splitScientificName for OTU target
 *     labels, typeStatusHtml)
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

// ── Deciding what is italic ──────────────────────────────────────────────────
//
// Every plain-text name in the project (DwC scientificName / typeStatus, OTU
// and depiction labels) is italicised through the functions below, so the
// rules live in one place. They are a best guess from text alone: where
// TaxonWorks delivers its own markup (object_tag, cached_html) prefer that,
// see ./otuTag.js.
//
// Only pass in a field that IS a name. Free text (captions, descriptions) is
// shown verbatim, never scanned for names: in a sentence nothing tells a
// genus from any other capitalised word.
//
// Rules, in the order they are applied:
//   1. The string must start with a capitalised word, else nothing is italic.
//   2. Names above genus rank are upright: decided by `rank` when the caller
//      knows it (DwC taxonRank), else by a family-group / plant suffix.
//   3. "(Subgenus)" directly after the genus is part of the name.
//   4. Lowercase words that follow are epithets, until the first word that is
//      not one: an author particle ("de", "von", "d'Orbigny"), a connective
//      ("in", "ex", "sensu"), or anything capitalised, numeric or punctuated.
//   5. Rank markers and qualifiers inside the name ("subsp.", "cf.", "[sic]",
//      "×") belong to it but are set upright.

const GENUS_WORD = /^×?\p{Lu}[\p{Ll}-]*\p{Ll}$/u
const SUBGENUS_WORD = /^\(\p{Lu}[\p{Ll}-]*\p{Ll}\)$/u
const EPITHET_WORD = /^×?\p{Ll}[\p{Ll}-]*\p{Ll}$/u
const CONNECTOR_WORD = /^(?:(?:subsp|ssp|var|subvar|f|fo|forma|cf|aff|nr|sp|spp|sect|ser|subg|morph|ab|nat)\.|×|\[[^\]]*\])$/u

// Lowercase words that look like an epithet but start (or belong to) the
// authorship instead.
const AUTHORSHIP_WORDS = new Set([
  'de', 'del', 'della', 'dello', 'degli', 'di', 'da', 'das', 'do', 'dos', 'du', 'des',
  'la', 'le', 'les', 'lo', 'van', 'von', 'vom', 'der', 'den', 'ter', 'ten', 'zu', 'zur',
  'af', 'av', 'et', 'ex', 'in', 'and', 'nec', 'non', 'sensu', 'auct', 'emend'
])

const HIGHER_RANK = /(?:family|tribe|order|class|phylum|division|kingdom|domain|cohort)$/i
const LOWER_RANK = /(?:genus|species|variety|form|forma)$/i
// Without a rank only the unambiguous endings are trusted. Deliberately absent:
// subtribe "-ina" and plant order "-ales", both of which also end real genera
// (Chrysolina, Hoplitopales).
const HIGHER_SUFFIX = /(?:idae|inae|oidea|ini|aceae|oideae)$/
// Common higher taxa that carry no tell-tale ending
const HIGHER_NAMES = new Set([
  'Animalia', 'Plantae', 'Fungi', 'Arthropoda', 'Hexapoda', 'Insecta', 'Coleoptera',
  'Polyphaga', 'Cucujiformia', 'Lepidoptera', 'Diptera', 'Hymenoptera', 'Hemiptera',
  'Tracheophyta', 'Magnoliopsida', 'Liliopsida', 'Pinopsida'
])

// A recognised rank settles it either way; an unknown or missing one falls
// back to the spelling.
function isHigherTaxon(firstWord, rank) {
  if (rank && HIGHER_RANK.test(rank)) return true
  if (rank && LOWER_RANK.test(rank)) return false
  return HIGHER_SUFFIX.test(firstWord) || HIGHER_NAMES.has(firstWord)
}

/**
 * Tokenises a name into the words that make up the name itself (each flagged
 * italic or upright) and the untouched remainder (authorship, or the whole
 * string when nothing qualifies as a name).
 */
function parseScientificName(name, rank) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  // A fossil dagger leads the name but is set upright
  const g = words[0] === '†' ? 1 : 0
  if (!words[g] || !GENUS_WORD.test(words[g]) || isHigherTaxon(words[g], rank)) {
    return { nameWords: [], rest: words.join(' ') }
  }
  const nameWords = words.slice(0, g + 1).map((text, k) => ({ text, italic: k === g }))
  let i = g + 1
  if (SUBGENUS_WORD.test(words[i] || '')) nameWords.push({ text: words[i++], italic: true })
  for (; i < words.length; i++) {
    const w = words[i]
    if (CONNECTOR_WORD.test(w)) nameWords.push({ text: w, italic: false })
    else if (EPITHET_WORD.test(w) && !AUTHORSHIP_WORDS.has(w)) nameWords.push({ text: w, italic: true })
    else break
  }
  return { nameWords, rest: words.slice(i).join(' ') }
}

/**
 * Splits a scientific name into its name part and its plain authorship part,
 * for call sites that render the two themselves (`<em>{{ italic }}</em>`).
 * `italic` is the whole name including any upright connector inside it
 * ("Aus cf. bus", "Aus bus [sic]"); use scientificNameHtml when those should
 * be set upright. Text that is not a genus-or-lower name comes back as
 * `{ italic: '', plain: <everything> }`.
 * @param {string} name
 * @param {{rank?: string}} [opt] taxon rank when known, e.g. DwC taxonRank
 * @returns {{italic: string, plain: string}}
 */
export function splitScientificName(name, { rank } = {}) {
  const { nameWords, rest } = parseScientificName(name, rank)
  return { italic: nameWords.map((w) => w.text).join(' '), plain: rest }
}

/**
 * Escaped, v-html-ready HTML for a scientific name: epithets italic, rank
 * markers / qualifiers and the authorship upright, e.g.
 * 'Aus bus subsp. cus Smith' -> '<em>Aus bus</em> subsp. <em>cus</em> Smith'.
 * @param {string} name
 * @param {{tag?: string, rank?: string}} [opt] wrapping tag (default 'em'), known taxon rank
 * @returns {string}
 */
export function scientificNameHtml(name, { tag = 'em', rank } = {}) {
  const { nameWords, rest } = parseScientificName(name, rank)
  const parts = []
  let run = []
  const flush = () => {
    if (run.length) parts.push(`<${tag}>${escHtml(run.join(' '))}</${tag}>`)
    run = []
  }
  for (const w of nameWords) {
    if (w.italic) run.push(w.text)
    else { flush(); parts.push(escHtml(w.text)) }
  }
  flush()
  if (rest) parts.push(escHtml(rest))
  return parts.join(' ')
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
  return escHtml(str.slice(0, idx + 4)) + scientificNameHtml(str.slice(idx + 4), { tag })
}
