// GBIF (via CoL) and TaxonWorks don't always agree on taxon limits: CoL may lump
// what this project splits (e.g. CoL treats "Lixus cardui" as a synonym of
// "Larinus latus"; TaxonWorks keeps both as valid species). A `taxonKey`
// occurrence rollup then drags the lumped material onto the wrong page.
//
// These helpers restrict GBIF results to occurrences whose name is the TW
// taxon's own name or one of ITS TaxonWorks-recorded synonyms.

/**
 * The name a GBIF occurrence was actually identified as, most-original first.
 *
 *   verbatimScientificName  raw dataset string — best, but frequently null
 *                           (GBIF's own "search the original name" advice is
 *                           useless when the dataset didn't supply it)
 *   scientificName          GBIF-interpreted name AT THE IDENTIFIED RANK —
 *                           this survives the synonymy merge, so it's the
 *                           reliable signal
 *   classifications[ck].usage.name   per-checklist fallback
 *
 * NEVER use `acceptedScientificName` — that IS the lumped/merged name (the
 * problem: "Lixus cardui" identified → "Larinus latus" accepted).
 */
export function occurrenceName(rec, checklistKey) {
  return (
    rec?.verbatimScientificName ||
    rec?.scientificName ||
    (checklistKey && rec?.classifications?.[checklistKey]?.usage?.name) ||
    rec?.species ||
    ''
  )
}

// "Larinus (Larinus) latus (J.F.W.Herbst, 1783)" → "larinus latus".
// Genus + the lowercase epithet tokens; subgenus, authorship and years drop out.
export function canonicalName(name) {
  const t = String(name || '').trim().split(/\s+/)
  if (!t[0]) return ''
  const epithets = t.slice(1).filter((w) => /^[a-z][a-z-]+$/.test(w))
  return [t[0], ...epithets].join(' ').toLowerCase()
}

/**
 * Tally a sample of occurrence rows by their identified name, split into names
 * that fall inside the TaxonWorks concept (`allowedNames` = accepted + TW
 * synonyms) and names GBIF folds under the same key but TaxonWorks does not.
 * @returns {{ included: {name,count}[], excluded: {name,count}[], keptRows: object[] }}
 *   both lists sorted commonest-first.
 */
export function tallyOccurrenceNames(rows, allowedNames, checklistKey) {
  const nameOk = makeGbifNameFilter(allowedNames)
  const inc = new Map()
  const exc = new Map()
  const keptRows = []
  for (const r of rows || []) {
    const n = occurrenceName(r, checklistKey)
    if (!n) continue
    if (nameOk(n)) {
      inc.set(n, (inc.get(n) || 0) + 1)
      keptRows.push(r)
    } else {
      exc.set(n, (exc.get(n) || 0) + 1)
    }
  }
  const sorted = (m) =>
    [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  return { included: sorted(inc), excluded: sorted(exc), keptRows }
}

/**
 * Rows that belong to the taxon + the distinct other names GBIF folds in.
 * @returns {{ kept: object[], lumpedNames: string[] }}
 */
export function partitionByName(rows, allowedNames, checklistKey) {
  const { keptRows, excluded } = tallyOccurrenceNames(
    rows,
    allowedNames,
    checklistKey
  )
  return { kept: keptRows, lumpedNames: excluded.map((e) => e.name) }
}

/**
 * Caption for a name-filtered GBIF panel. `taxonName` is spelled out where the
 * text would otherwise say "this taxon" (falls back to "this taxon" if omitted).
 *   - lumped names present → "Showing 9 … identified as Lixus cardui out of 15
 *     under GBIF's broader concept, which also includes Larinus latus …."
 *   - no lumping, but `total > shown` (just the fetch cap) → "Showing 300 …:
 *     GBIF holds 5,231 in total (showing the first 300)."
 *   - otherwise → "Showing 60 … identified as Lixus cardui."
 * The "broader concept" wording appears ONLY when `lumpedNames` is non-empty, so
 * a paging cap is never misreported as taxonomic lumping.
 */
export function scopeCaption({
  shown,
  total,
  lumpedNames = [],
  noun,
  taxonName,
  includesSynonyms = false
}) {
  const whoShort = taxonName || 'this taxon'
  const who =
    taxonName && includesSynonyms
      ? `${taxonName} or a TaxonWorks synonym`
      : whoShort
  const base = `Showing ${shown} ${noun} identified as ${who}`
  const bigger = typeof total === 'number' && total > shown

  if (lumpedNames.length) {
    const head = lumpedNames.slice(0, 3).join(', ')
    const list = lumpedNames.length > 3 ? `${head}, and others` : head
    if (bigger) {
      return `${base} out of ${total.toLocaleString()} under GBIF's broader concept, which also includes ${list}.`
    }
    return `${base}; GBIF also files ${list} under ${whoShort}.`
  }
  if (bigger) {
    return `${base}: GBIF holds ${total.toLocaleString()} in total (showing the first ${shown}).`
  }
  return `${base}.`
}

// Genus-independent, gender-independent match key for the overlap diagram.
// Drops the leading genus (weevils get recombined a lot: "curculio latus" and
// "larinus latus" → "lat…") and normalises adjectival gender on the terminal
// epithet ("gibbosus" / "gibbosa" → "gibbos"). Genitive epithets ("-i", "-ae")
// are left alone. Deliberately lenient — used only for name-set comparison, not
// for filtering records.
export function epithetKey(name) {
  const c = canonicalName(name)
  const parts = c.split(' ')
  const eps = parts.length > 1 ? parts.slice(1) : parts
  const last = eps[eps.length - 1].replace(/(us|a|um)$/, '')
  return [...eps.slice(0, -1), last].join(' ')
}

// Name with the authorship / year trimmed, for compact display.
export function shortName(name) {
  const t = String(name || '').trim().split(/\s+/)
  if (!t[0]) return ''
  const out = [t[0]]
  for (let i = 1; i < t.length; i++) {
    if (/^[a-z][a-z-]+$/.test(t[i]) || /^\([A-Z][a-z-]+\)$/.test(t[i])) out.push(t[i])
    else break
  }
  return out.join(' ')
}

/**
 * Build a predicate `(occurrenceName) => boolean`.
 * @param {string[]} names  accepted name + TaxonWorks synonym names
 * Empty / no canonical names → predicate always true (no filtering).
 * Matches an exact canonical hit or either direction of infra/supra-specific
 * containment ("larinus latus" ↔ "larinus latus foo"), so a subspecies type of
 * the taxon still passes.
 */
export function makeGbifNameFilter(names) {
  const allowed = [...new Set((names || []).map(canonicalName).filter(Boolean))]
  if (!allowed.length) return () => true
  return (occurrenceName) => {
    const c = canonicalName(occurrenceName)
    if (!c || !c.includes(' ')) return false // reject genus-or-higher determinations
    return allowed.some(
      (a) =>
        c === a ||
        c.startsWith(a + ' ') || // occurrence is an infraspecific of an allowed name
        a.startsWith(c + ' ') // occurrence is the species of an allowed subspecies
    )
  }
}
