/**
 * adventive.js
 *
 * The "Adventive" (introduced) tag, on asserted distributions and on
 * specimens. A CollectionObject or FieldOccurrence tagged with the keyword
 * "Adventive" is drawn in the adventive purple on the map (the colour of an
 * adventive asserted distribution) and carries a purple "Adventive" chip in
 * the specimen list and the DwC modal.
 *
 * Callers:
 *   - ../PanelMapV2/store/useDistributionStore.js (ADs and point features)
 *   - ../PanelMapV2/components/MapPopup.vue (chip on a specimen row)
 *   - ./DwcTable.vue (chip in the identity block)
 *   - ../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue (list rows)
 *
 * Colour: --pp-adventive / --pp-adventive-ink in ./panel-tokens.css
 * (PanelMapV2's --pp-map-adventive points at --pp-adventive). The chip is an
 * HTML string so the list, which assembles its identity line as HTML, can use
 * it too. Not imported here, so `node --test` can load this module: every
 * caller already loads panel-tokens.css (directly or via TypeStatusChip.vue).
 */
import { fetchObjectTags } from './objectTags.js'
import { isSpecimenType, specimenKey } from './specimenRef.js'

export const ADVENTIVE_KEYWORD = 'adventive'

export function hasAdventiveKeyword(keywords) {
  return (keywords || []).some((k) => String(k).trim().toLowerCase() === ADVENTIVE_KEYWORD)
}

// Set of the ids in a Map<id, keyword[]> that carry the Adventive keyword.
export function adventiveIds(tagsById) {
  const out = new Set()
  for (const [id, kws] of tagsById || []) {
    if (hasAdventiveKeyword(kws)) out.add(id)
  }
  return out
}

// Set of specimenKey()s ("CollectionObject:12") of the given specimen refs
// ({ type, id }) that are tagged Adventive. One tag lookup per type.
export async function fetchAdventiveSpecimenKeys(refs, { signal } = {}) {
  const idsByType = new Map()
  for (const ref of refs || []) {
    if (!ref || !isSpecimenType(ref.type) || ref.id == null) continue
    if (!idsByType.has(ref.type)) idsByType.set(ref.type, [])
    idsByType.get(ref.type).push(ref.id)
  }

  const keys = new Set()
  await Promise.all(
    [...idsByType].map(async ([type, ids]) => {
      const tags = await fetchObjectTags(type, ids, { signal })
      for (const id of adventiveIds(tags)) keys.add(specimenKey({ type, id }))
    })
  )
  return keys
}

export const ADVENTIVE_CHIP_STYLE =
  'background: color-mix(in srgb, var(--pp-adventive) 14%, transparent); color: var(--pp-adventive-ink); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pp-adventive) 35%, transparent)'

export const ADVENTIVE_CHIP_HTML =
  `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium" style="${ADVENTIVE_CHIP_STYLE}" ` +
  `title="Tagged as adventive (introduced) in TaxonWorks">Adventive</span>`
