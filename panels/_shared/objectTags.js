/**
 * objectTags.js
 *
 * TaxonWorks tags (keywords) of a set of records of one type, as
 * Map<objectId, keywordName[]>. One `/tags` lookup per chunk of ids (a long id
 * list would otherwise make the query string too long), each chunk paginated
 * via fetchAllPages. Errors resolve to an empty Map so callers can render
 * without tags.
 *
 * Callers:
 *   - ./assertedDistributionTags.js (PanelMapV2 store, PanelAssertedDistributions)
 *   - ./adventive.js (specimens tagged "Adventive": map, list, DwC modal)
 */
import { fetchAllPages } from './fetchAllPages.js'

const CHUNK = 100

export async function fetchObjectTags(type, ids, { signal } = {}) {
  const uniqueIds = [...new Set(ids)].filter((id) => id != null && id !== '')
  if (!type || !uniqueIds.length) return new Map()

  const chunks = []
  for (let i = 0; i < uniqueIds.length; i += CHUNK) chunks.push(uniqueIds.slice(i, i + CHUNK))

  try {
    const pages = await Promise.all(
      chunks.map((chunk) =>
        fetchAllPages('/tags', { tag_object_type: type, 'tag_object_id[]': chunk }, { signal })
      )
    )
    const byId = new Map()
    for (const t of pages.flat()) {
      const kw = t.keyword?.name
      if (!kw) continue
      if (!byId.has(t.tag_object_id)) byId.set(t.tag_object_id, [])
      byId.get(t.tag_object_id).push(kw)
    }
    return byId
  } catch {
    return new Map()
  }
}
