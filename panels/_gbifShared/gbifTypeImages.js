// Pure mapper: GBIF occurrence-search `results[]` → the flat image objects the
// shared ImageLightbox / GalleryMainImage render. No Vue, no network — unit-test
// by feeding it a recorded occurrence-search payload.
//
// The lightbox's "plain caption" path (bold figure_label + captionHtml +
// image-level attribution + source) lights up only when the image carries NO
// `depictions` structure — so these objects deliberately ship `depictions: []`.

import { GBIF_OCCURRENCE_DETAIL, CHECKLIST_KEY } from './useGbifMatch'
import { makeGbifNameFilter, occurrenceName } from './gbifNameFilter'

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// "http://creativecommons.org/licenses/by-nc/4.0/" → "CC BY-NC 4.0"
function shortLicense(url) {
  if (!url) return ''
  const cc = url.match(/creativecommons\.org\/licenses\/([a-z-]+)\/([0-9.]+)/i)
  if (cc) return `CC ${cc[1].toUpperCase()} ${cc[2]}`
  const zero = url.match(/creativecommons\.org\/publicdomain\/zero\/([0-9.]+)/i)
  if (zero) return `CC0 ${zero[1]}`
  const mark = url.match(/creativecommons\.org\/publicdomain\/mark\/([0-9.]+)/i)
  if (mark) return `Public Domain ${mark[1]}`
  return url.replace(/^https?:\/\//, '')
}

function joinTruthy(parts, sep) {
  return parts.filter((p) => p != null && String(p).trim() !== '').join(sep)
}

// Providers stuff placeholder text into `locality` for old type specimens
// ("[no specific locality data]", "[No data]", …) — drop those, keep real ones.
function cleanField(v) {
  const s = String(v == null ? '' : v).trim()
  return /^\[.*(no|without|unknown).*\]$/i.test(s) ? '' : s
}

// "2014-12-22T00:00Z" → "2014-12-22"; ranges / verbatim strings pass through.
function tidyDate(d) {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(d || ''))
  return m ? m[1] : d || ''
}

/**
 * @param {Array} results  GBIF occurrence-search `data.results`
 * @param {object} [opts]
 * @param {number} [opts.max=12]  hard cap on returned images
 * @param {string[]} [opts.names]  TW accepted name + TW synonym names. When
 *   given, occurrences whose scientificName isn't in that set are dropped —
 *   keeps a CoL lump (Lixus cardui under Larinus latus) off the wrong page.
 * @returns {Array} image objects: { id, thumb, medium, original, figure_label,
 *   captionHtml, attribution:{label}, source:{label}, depictions:[],
 *   occurrenceKey, typeStatus, taxonName, specimenLabel, href }
 */
export function gbifOccurrencesToImages(results, { max = 12, names } = {}) {
  const out = []
  const seen = new Set() // dedupe by media URL across occurrences
  const nameOk = makeGbifNameFilter(names)

  for (const rec of results || []) {
    const recName = occurrenceName(rec, CHECKLIST_KEY)
    if (!nameOk(recName)) continue
    const media = Array.isArray(rec.media) ? rec.media : []
    media.forEach((m, i) => {
      if (m?.type && m.type !== 'StillImage') return
      const raw = m?.identifier
      if (!raw || seen.has(raw)) return
      seen.add(raw)
      // Avoid mixed-content blocking when the host site is served over https.
      const url = raw.replace(/^http:\/\//i, 'https://')

      const locality = joinTruthy(
        [cleanField(rec.locality), rec.stateProvince, rec.country],
        ', '
      )
      const specimenLabel = joinTruthy(
        [
          joinTruthy([rec.institutionCode, rec.catalogNumber], ' '),
          rec.recordedBy ? `leg. ${rec.recordedBy}` : '',
          locality,
          tidyDate(rec.eventDate)
        ],
        ' · '
      )
      const taxonName = recName
      const href = rec.key ? `${GBIF_OCCURRENCE_DETAIL}/${rec.key}` : ''

      out.push({
        id: `gbif:${rec.key}:${i}`,
        thumb: url,
        medium: url,
        original: url,
        figure_label: joinTruthy([rec.typeStatus, taxonName], ' · '),
        captionHtml: specimenLabel ? esc(specimenLabel) : '',
        attribution: {
          label: joinTruthy([m.creator, shortLicense(m.license)], ' · ')
        },
        source: {
          label: href
            ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-secondary hover:underline">GBIF occurrence ${rec.key}</a>`
            : ''
        },
        depictions: [],
        // structured fields for grouping / direct links to un-embeddable records
        occurrenceKey: rec.key || null,
        typeStatus: rec.typeStatus || '',
        taxonName,
        specimenLabel,
        href
      })
    })
    if (out.length >= max) break
  }

  return out.slice(0, max)
}
