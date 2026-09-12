/**
 * inatFallback.js
 *
 * Shared iNaturalist image-fallback helpers, used when TaxonWorks has no
 * depictions for a taxon: resolve the TaxonWorks name to an iNaturalist
 * taxon id, then build ImageLightbox-compatible image objects from its
 * curated taxon photos and/or research-grade observations.
 *
 * Depended on by:
 *   - ../PanelGallery/PanelGallery.vue
 *   - ../PaneliNaturalist/PaneliNaturalist.vue (parseName, resolveInatTaxonId,
 *     makeTaxonPhotoImage only, its own observations section is a plain
 *     paginated grid, not run through makeObservationImage/ImageLightbox)
 *   - ../../modules/keys/composables/useKeyImages.js
 *
 * If you change this file, sanity-check all three call sites.
 */

import axios from 'axios'

/**
 * Parses a TaxonWorks expanded_name ("Genus (Subgenus) species" or "Genus
 * species") into its genus/subgenus/epithet parts.
 * @param {string} expandedName
 * @returns {{genus: string, subgenus: string|null, epithet: string|null}}
 */
export function parseName(expandedName) {
  const str = String(expandedName || '')
  const subgenusMatch = str.match(/^(\S+)\s+\((\S+)\)(?:\s+(\S+))?$/)
  if (subgenusMatch) {
    return {
      genus: subgenusMatch[1],
      subgenus: subgenusMatch[2],
      epithet: subgenusMatch[3] || null
    }
  }
  const parts = str.trim().split(/\s+/)
  return { genus: parts[0], subgenus: null, epithet: parts[1] || null }
}

/**
 * Resolves a TaxonWorks name to an iNaturalist taxon id. Subgenus-only names
 * (no epithet) are looked up by subgenus rank and matched against the
 * expected parent genus, since not every TaxonWorks subgenus exists on
 * iNaturalist and a silent fallback to the whole genus would be wrong.
 * @param {string} name - expanded_name, e.g. "Otiorhynchus (Nihus) carinatopunctatus"
 * @param {string} [rank] - TaxonWorks rank string, passed straight through (same rank names as iNat)
 * @returns {Promise<number|null>}
 */
export async function resolveInatTaxonId(name, rank) {
  if (!name) return null
  const { genus, subgenus, epithet } = parseName(name)

  if (subgenus && !epithet) {
    const { data } = await axios.get('https://api.inaturalist.org/v1/taxa', {
      params: { q: subgenus, rank: 'subgenus', per_page: 10, all_names: true }
    })
    const match = (data.results || []).find((t) => {
      if (t.name.toLowerCase() !== subgenus.toLowerCase()) return false
      if (t.ancestors?.length) {
        return t.ancestors.some(
          (a) => a.rank === 'genus' && a.name.toLowerCase() === genus.toLowerCase()
        )
      }
      return true
    })
    return match ? match.id : null
  }

  const plainName = subgenus && epithet ? `${genus} ${epithet}` : name
  const params = { q: plainName, per_page: 10 }
  if (rank) params.rank = rank
  const { data } = await axios.get('https://api.inaturalist.org/v1/taxa', { params })
  const match = (data.results || []).find(
    (t) => t.name.toLowerCase() === plainName.toLowerCase()
  )
  return match ? match.id : null
}

/**
 * Converts an iNaturalist taxon_photos entry into an ImageLightbox-compatible
 * image object. Not linked to a specific observation, so `source` points at
 * the photo's own page on iNaturalist.
 * @param {object} taxonPhoto
 * @returns {object}
 */
export function makeTaxonPhotoImage(taxonPhoto) {
  const photo = taxonPhoto.photo
  const photoUrl = `https://www.inaturalist.org/photos/${photo.id}`
  const taxonName = taxonPhoto.taxon?.name || ''
  return {
    id: photo.id,
    thumb: photo.medium_url || photo.url.replace('square', 'medium'),
    medium: photo.medium_url || photo.url.replace('square', 'medium'),
    original: photo.original_url || photo.large_url || photo.url.replace('square', 'original'),
    attribution: { label: photo.attribution || '' },
    source: {
      label: `<a href="${photoUrl}" target="_blank" rel="noopener noreferrer" class="text-secondary hover:underline">${photoUrl}</a>`
    },
    depictions: taxonName ? [{ label: taxonName }] : []
  }
}

/**
 * Converts an iNaturalist research-grade observation + its first photo into
 * an ImageLightbox-compatible image object, linked to the observation page.
 * @param {object} obs
 * @param {object} photo
 * @returns {object}
 */
export function makeObservationImage(obs, photo) {
  const obsUrl = `https://www.inaturalist.org/observations/${obs.id}`
  return {
    id: photo.id,
    thumb: photo.url.replace('square', 'medium'),
    medium: photo.url.replace('square', 'medium'),
    original: photo.url.replace('square', 'original'),
    attribution: { label: photo.attribution || '' },
    source: {
      label: `<a href="${obsUrl}" target="_blank" rel="noopener noreferrer" class="text-secondary hover:underline">${obsUrl}</a>`
    },
    depictions: obs.taxon?.name ? [{ label: obs.taxon.name }] : []
  }
}
