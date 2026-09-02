// Name matching for the GBIF concept alignment. A match key is
// "<epithet>|<surname>|<year>", genus independent so a recombination still
// matches, and specific enough to keep homonyms apart. Each match is graded
// into a tier. See the design spec, section 4.4.
//
// Citations: the protonym-as-tie-point idea and the tiered grading follow
// Rees, T., Franz, N.M. & Sterner, B. (2026), Biodiversity Data Journal 14:
// e191754, doi:10.3897/BDJ.14.e191754. The reason the "homotypic" tier needs
// the original combination and not just epithet+author+year is ICZN Art. 53.3
// (primary vs secondary homonymy), with Art. 57.2-3, Art. 58 (spelling
// variants the Code deems identical, which the "weak" tier's epithetKey
// approximates) and Art. 61 (Principle of Typification; "objective synonym" =
// the homotypic tier).
import { canonicalName, epithetKey } from './gbifNameFilter.js'

const PARTICLES = new Set([
  'de', 'van', 'von', 'der', 'den', 'du', 'la', 'le', 'da', 'dos', 'del', 'di'
])

// "(J.F.W.Herbst, 1783)" -> "herbst" ; "Rossi, P., 1790" -> "rossi" ;
// "de Motschulsky" -> "motschulsky" ; "Gyllenhal & Schoenherr" -> "gyllenhal"
export function normalizeSurname(author) {
  if (!author) return ''
  let s = String(author)
    .replace(/[()]/g, ' ')
    .replace(/\bauct\.?\b.*$/i, ' ')
    .replace(/\bnon\b.*$/i, ' ')
    .replace(/\b(1[6-9]\d\d|20\d\d)\b.*$/, ' ')
    .replace(/&|\band\b/gi, ',')
  // first author only
  s = s.split(/[,;]/)[0].trim()
  // strip leading glued initials: "J.F.W.Herbst" -> "Herbst"
  s = s.replace(/^(?:[A-Z]\.){1,4}/, '')
  const tokens = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => {
      const bare = t.replace(/\./g, '')
      if (bare.length <= 1) return false
      if (PARTICLES.has(bare.toLowerCase())) return false
      return true
    })
  const last = tokens.length ? tokens[tokens.length - 1] : s
  return last.replace(/[^A-Za-zÀ-ÿ-]/g, '').toLowerCase()
}

export function parseAuthorYear(nameOrAuthor) {
  const str = String(nameOrAuthor || '')
  const m = str.match(/\b(1[6-9]\d\d|20\d\d)\b/)
  return { surname: normalizeSurname(str), year: m ? Number(m[1]) : null }
}

// "Larinus latus (Herbst, 1783)" -> "latus|herbst|1783".
// Pass `author` when the name string carries no authorship (TaxonWorks names
// keep it in a separate field).
export function matchKey(name, { author } = {}) {
  const c = canonicalName(name) // "larinus latus"
  const epithet = c.includes(' ') ? c.split(' ').slice(1).join(' ') : c
  const { surname, year } = parseAuthorYear(author || name)
  return `${epithet}|${surname}|${year ?? ''}`
}

function parts(key) {
  const [epithet, surname, year] = String(key).split('|')
  return { epithet, surname, year: year ? Number(year) : null }
}

export function matchTier(twKey, colKey, { twOriginalCombination, colNameStrings } = {}) {
  if (twOriginalCombination && Array.isArray(colNameStrings)) {
    const oc = matchKey(twOriginalCombination)
    const ocEpSur = oc.split('|').slice(0, 2).join('|')
    for (const cn of colNameStrings) {
      if (matchKey(cn).split('|').slice(0, 2).join('|') === ocEpSur) return 'homotypic'
    }
  }
  const t = parts(twKey)
  const c = parts(colKey)
  if (t.epithet && t.epithet === c.epithet && t.surname && t.surname === c.surname) {
    if (t.year && c.year) return Math.abs(t.year - c.year) <= 1 ? 'probable' : 'weak'
    return 'weak'
  }
  const ts = epithetKey(t.epithet)
  if (ts && ts === epithetKey(c.epithet)) return 'weak'
  return 'none'
}

// True when two match keys ("<epithet>|<surname>|<year>") denote the same name,
// epithet and surname must match exactly and be non-empty; year may differ by at
// most one, and a missing year on either side is accepted.
export function keysMatch(a, b) {
  const pa = String(a).split('|')
  const pb = String(b).split('|')
  if (!pa[0] || pa[0] !== pb[0]) return false
  if (!pa[1] || pa[1] !== pb[1]) return false
  if (a === b) return true
  const ya = pa[2] ? Number(pa[2]) : null
  const yb = pb[2] ? Number(pb[2]) : null
  if (ya == null || yb == null) return true
  return Math.abs(ya - yb) <= 1
}
