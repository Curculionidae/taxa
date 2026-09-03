/**
 * assertedDistributionTags.js
 *
 * One batched `/tags` fetch for a set of AssertedDistribution records, returning
 * a Map<assertedDistributionId, keywordName[]>. Shared by PanelMapV2's
 * distribution store (an "Adventive" keyword also drives the hatched polygon
 * styling) and PanelAssertedDistributions (yellow keyword pills in the area
 * cell). Errors resolve to an empty Map so callers can render without tags.
 */
import { makeAPIRequest } from '@/utils/request'

export async function fetchAssertedDistributionTags(ids, { signal } = {}) {
  const uniqueIds = [...new Set(ids)].filter(Boolean)
  if (!uniqueIds.length) return new Map()

  const params = new URLSearchParams()
  params.set('tag_object_type', 'AssertedDistribution')
  uniqueIds.forEach((id) => params.append('tag_object_id[]', id))
  params.set('per', '500')

  try {
    const { data } = await makeAPIRequest.get(`/tags?${params}`, { signal })
    const byId = new Map()
    for (const t of Array.isArray(data) ? data : []) {
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
