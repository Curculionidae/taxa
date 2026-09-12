/**
 * assertedDistributionTags.js
 *
 * A `/tags` fetch (paginated via fetchAllPages, since a large record set can
 * exceed one page of tag rows) for a set of AssertedDistribution records,
 * returning a Map<assertedDistributionId, keywordName[]>. Shared by
 * PanelMapV2's distribution store (an "Adventive" keyword also drives the
 * hatched polygon styling) and PanelAssertedDistributions (yellow keyword
 * pills in the area cell). Errors resolve to an empty Map so callers can
 * render without tags.
 */
import { fetchAllPages } from './fetchAllPages.js'

export async function fetchAssertedDistributionTags(ids, { signal } = {}) {
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  if (!uniqueIds.length) return new Map()

  try {
    const tags = await fetchAllPages(
      '/tags',
      { tag_object_type: 'AssertedDistribution', 'tag_object_id[]': uniqueIds },
      { signal }
    )
    const byId = new Map()
    for (const t of tags) {
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
