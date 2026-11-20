// Tab separated values as TaxonWorks exports /dwc_occurrences.csv.
//
// Used by the cache build (scripts/download.mjs re-exports it) and by the
// curator page (placement/live.js, fetchOtuSpecimens), so both read the
// export the same way. Pure and browser-safe.

/**
 * Tab separated values, fields optionally in double quotes ("" escapes a quote),
 * as TaxonWorks exports /dwc_occurrences.csv.
 * @param {string} text
 * @returns {Object<string, string>[]}  one object per row, keyed by the header
 */
export function parseTsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === '\t') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows
  if (!header) return []
  return body.map((values) => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ''])))
}
