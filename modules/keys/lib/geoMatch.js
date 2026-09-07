// Pure. Match a taxon's / a lead subtree's recorded territories against the
// reader's geography selection. No Vue, no network. Design spec 2026-09-02,
// section 8.2 plus the path roll-up follow-up.

// One taxon's territory key set vs the effective selection:
//   'in'      recorded from at least one selected territory
//   'out'     not in any selected territory, but recorded somewhere
//   'unknown' no distribution data at all (or no filter active)
// `set` under the lazy probe model only ever holds SELECTED countries, so an
// empty set is disambiguated by `hasDataAnywhere` (the no-country has-data
// probe). Default false: without that signal, an empty set stays 'unknown',
// matching the pre-lazy behaviour.
export function territoryStatus(set, effectiveKeys, hasDataAnywhere = false) {
  if (!effectiveKeys || effectiveKeys.size === 0) return 'in'
  if (set && set.size) {
    for (const k of set) if (effectiveKeys.has(k)) return 'in'
    return 'out'
  }
  return hasDataAnywhere ? 'out' : 'unknown'
}

// Roll a status up a lead: 'in' if ANY reachable terminal is in area; else
// 'unknown' if any reachable terminal is unknown (never dim a branch that might
// still be relevant); else 'out'. No reachable terminals -> 'unknown'.
export function leadGeoStatus(reachableOtuIds, territoriesByOtu, effectiveKeys, hasDataByOtu = null) {
  if (!effectiveKeys || effectiveKeys.size === 0) return 'in'
  let sawUnknown = false
  let sawAny = false
  for (const id of reachableOtuIds || []) {
    sawAny = true
    const set = territoriesByOtu.get(id) ?? territoriesByOtu.get(Number(id)) ?? null
    const st = hasDataByOtu
      ? territoryStatus(
          set,
          effectiveKeys,
          hasDataByOtu.get(id) ?? hasDataByOtu.get(Number(id)) ?? false
        )
      : territoryStatus(set, effectiveKeys)
    if (st === 'in') return 'in'
    if (st === 'unknown') sawUnknown = true
  }
  return !sawAny || sawUnknown ? 'unknown' : 'out'
}
