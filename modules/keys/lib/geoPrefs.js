// The key geography-filter selection: which groupings and which individual
// territories the reader picked. Persisted per browser in localStorage under one
// global key, so a chosen area carries across keys (mirrors lib/format.js). See
// the design spec, section 7.

const STORAGE_KEY = 'taxonpages:key-geography'

const EMPTY = () => ({ groupings: [], territories: [] })

// A stored string -> { groupings: string[], territories: string[] }. Any shape
// problem yields the empty selection rather than throwing.
export function parseStored(raw) {
  if (!raw) return EMPTY()
  try {
    const o = JSON.parse(raw)
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
    return { groupings: arr(o?.groupings), territories: arr(o?.territories) }
  } catch {
    return EMPTY()
  }
}

// The effective territory key set: every selected grouping's full member list,
// unioned with the explicitly selected territories. Groupings expand in full
// (not intersected with the current key) so the completeness denominator is not
// narrowed.
export function effectiveKeys(selection, groupings = []) {
  const out = new Set()
  const sel = selection || EMPTY()
  const byId = new Map((groupings || []).map((g) => [g.id, g]))
  for (const id of sel.groupings || []) {
    const g = byId.get(id)
    if (g) for (const m of g.members || []) out.add(m)
  }
  for (const t of sel.territories || []) out.add(t)
  return out
}

export function readGeoPrefs() {
  try {
    if (typeof localStorage !== 'undefined') {
      return parseStored(localStorage.getItem(STORAGE_KEY))
    }
  } catch {
    /* private mode / SSR */
  }
  return EMPTY()
}

export function writeGeoPrefs(selection) {
  const clean = {
    groupings: [...new Set((selection?.groupings || []).filter(Boolean))],
    territories: [...new Set((selection?.territories || []).filter(Boolean))]
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
    }
  } catch {
    /* ignore */
  }
}
