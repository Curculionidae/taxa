import { makeAPIRequest } from '@/utils'

// TaxonWorks taxon_name id for Curculionoidea, the root this catalog covers.
export const CURCULIONOIDEA_TAXON_NAME_ID = 809411

// Number of valid species-rank names within Curculionoidea (synonyms excluded).
// Shared by the home-page stat strip (ProjectStatsStrip.global.vue) and the
// about-page inline figure (ValidSpeciesCount.global.vue) so the two pages can
// never disagree on what "valid species" means or which root to count from.
// Resolves to a Number, or null if the request fails or returns no total.
export function fetchValidSpeciesCount() {
  return makeAPIRequest
    .get('/taxon_names.json', {
      params: {
        per: 1,
        validity: true,
        taxon_name_id: [CURCULIONOIDEA_TAXON_NAME_ID],
        rank: ['NomenclaturalRank::Iczn::SpeciesGroup::Species'],
        descendants: true
      }
    })
    .then((response) => {
      const total = Number(response.headers['pagination-total'])
      return Number.isFinite(total) ? total : null
    })
}
