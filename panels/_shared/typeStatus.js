// Pure helpers for a DwC `typeStatus` cell: split it, classify it, colour its
// chip. No Vue, no '@/' imports here on purpose: `node --test` covers it.
//
// Depended on by:
//   - ../PanelMapV2/composables/enrichedStyle.js (re-exports the classifiers)
//   - ./TypeStatusChip.vue (typeLabelStyle, typeStatusLabels; the chip
//     DwcTable, the specimen list and the map popup all render)

// A DwC `typeStatus` cell is a " | "-joined list of "<type_type> of <name>"
// labels (TaxonWorks builds it as `type_materials.map { label_for_type_material }
// .join(' | ')`). Split it back into the individual labels.
export function typeStatusLabels(cell) {
  return String(cell || '')
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Classify one "<type_type> of <name>" label:
//   'primary' — a name-bearing type (holotype, lectotype, neotype, syntype, or
//               the bare historical "type")
//   'other'   — any other qualified type (paratype, isotype, topotype, ...)
//   null      — the string names no type at all
// The name-bearing forms are anchored with \b so "paralectotype" does not read
// as "lectotype" (no word boundary between "para" and "lecto").
export function classifyOneTypeStatus(label) {
  const s = String(label || '').toLowerCase().trim()
  if (!/type/.test(s)) return null
  if (/\b(?:holo|lecto|neo|syn)-?types?\b/.test(s)) return 'primary'
  if (/^(?:the\s+)?types?\b/.test(s)) return 'primary'
  return 'other'
}

// Classify a whole DwC `typeStatus` cell. 'primary' wins over 'other'; null when
// the cell names no type (or is empty).
export function classifyTypeStatus(cell) {
  const labels = typeStatusLabels(cell)
  if (!labels.length) return null
  let kind = null
  for (const label of labels) {
    const k = classifyOneTypeStatus(label)
    if (k === 'primary') return 'primary'
    if (k === 'other') kind = 'other'
  }
  return kind
}

// Inline style for the type-status chip, after the pinned-label convention:
// red for a name-bearing type, yellow for any other type material, black
// print on both. Tokens live in ./panel-tokens.css, which ./TypeStatusChip.vue
// imports: render the chip with that component rather than calling this directly.
export function typeLabelStyle(cell) {
  const paper = classifyTypeStatus(cell) === 'other' ? '--pp-type-label-other' : '--pp-type-label'
  return { backgroundColor: `var(${paper})`, color: 'var(--pp-type-label-ink)' }
}
