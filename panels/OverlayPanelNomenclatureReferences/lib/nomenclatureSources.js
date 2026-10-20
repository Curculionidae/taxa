import { indexSources } from '../../_shared/curatorMode/sourceIds.js'

/**
 * The sources cited on a taxon name, its synonyms and its combinations, by
 * their text: what the nomenclature references panel lists (the catalog
 * gives only the text). Checked 2026-10-19: covers 22 of the 23 references of
 * Otiorhynchus armadillo, the rest is cited elsewhere (e.g. on a
 * relationship) and found by a text search instead.
 *
 * @param {number} taxonId
 * @param {(url: string, params: object) => Promise<object[]>} fetchAll
 * @returns {Promise<Map<string, number|null>>}
 */
export async function loadNomenclatureSources(taxonId, fetchAll) {
  const names = await fetchAll('/taxon_names', {
    taxon_name_id: [taxonId],
    synonymify: true,
    combinationify: true
  })
  const nameIds = [...new Set([taxonId, ...names.map((name) => name.id)])]
  const citations = []

  for (let i = 0; i < nameIds.length; i += 100) {
    citations.push(
      ...(await fetchAll('/citations', {
        citation_object_type: 'TaxonName',
        citation_object_id: nameIds.slice(i, i + 100),
        extend: ['source']
      }))
    )
  }

  return indexSources(citations.map((citation) => citation.source).filter(Boolean))
}
