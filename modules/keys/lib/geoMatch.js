// Pure. Match a taxon's / a lead subtree's recorded territories against the
// reader's geography selection. No Vue, no network. Design spec 2026-09-02,
// section 8.2 plus the path roll-up follow-up.

// One taxon's territory key set vs the effective selection:
//   'in'      the taxon is recorded from at least one selected territory
//   'out'     recorded, but from none of them
//   'unknown' no distribution data (or no filter active)
export function territoryStatus(set, effectiveKeys) {
  if (!effectiveKeys || effectiveKeys.size === 0) return 'in'
  if (!set || set.size === 0) return 'unknown'
  for (const k of set) if (effectiveKeys.has(k)) return 'in'
  return 'out'
}

// Roll a status up a lead: it is 'in' if ANY reachable terminal is in area,
// otherwise 'unknown' if any reachable terminal is unknown (so a branch is never
// dimmed while some of its taxa might still be relevant), otherwise 'out'. A lead
// with no reachable terminals is 'unknown'.
export function leadGeoStatus(reachableOtuIds, territoriesByOtu, effectiveKeys) {
  if (!effectiveKeys || effectiveKeys.size === 0) return 'in'
  let sawUnknown = false
  let sawAny = false
  for (const id of reachableOtuIds || []) {
    sawAny = true
    const set =
      territoriesByOtu.get(id) ?? territoriesByOtu.get(Number(id)) ?? null
    const st = territoryStatus(set, effectiveKeys)
    if (st === 'in') return 'in'
    if (st === 'unknown') sawUnknown = true
  }
  return !sawAny || sawUnknown ? 'unknown' : 'out'
}
