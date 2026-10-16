/**
 * assertedDistributionTags.js
 *
 * Tags of a set of AssertedDistribution records, as
 * Map<assertedDistributionId, keywordName[]> (see ./objectTags.js). Shared by
 * PanelMapV2's distribution store (an "Adventive" keyword also drives the
 * hatched polygon styling) and PanelAssertedDistributions (yellow keyword
 * pills in the area cell). Errors resolve to an empty Map so callers can
 * render without tags.
 */
import { fetchObjectTags } from './objectTags.js'

export function fetchAssertedDistributionTags(ids, { signal } = {}) {
  return fetchObjectTags('AssertedDistribution', ids, { signal })
}
