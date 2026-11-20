// State and province names: matching place text to the states of one checklist.
//
// Purpose: the one way a state or province name is recognised, shared by the
// placement engine (engine.js: the state of an asserted distribution from its
// area's name, the state of a specimen from its DwC stateProvince) and by the
// public page (ChecklistsPage.vue, the subdivision drill-down). Moved here from
// data/subdivisions.js with its behaviour unchanged.
//
// Input:  the state names of ONE checklist (GeoJSON features with
//         `properties.name` and optional `properties.aliases`, or plain names
//         through stateIndex), and the place text to match.
// Output: the matching state name as the index spells it, or '' when none.
// Matching: first the exact name after normalizePlace (accents, case and
//         punctuation ignored, & read as "and"), then the core name, the name
//         without generic words such as Oblast, Krai, Province, Republic of
//         ("Krasnoyarsk Krai" finds Krasnoyarsk, "Republic of Sakha" finds Sakha).
//         Names are only ever compared within one checklist, so the US state
//         Georgia never meets the country Georgia (R16).
// Purity: no network, no hidden state; runs in Node and in the browser.

const GENERIC_WORDS = new Set([
  'province', 'oblast', 'krai', 'kray', 'republic', 'of', 'autonomous', 'region', 'okrug',
  'state', 'municipality', 'city', 'district', 'territory', 'sheng', 'shi', 'the', 'and', 'county'
])

/**
 * Normal form of a place name: accents removed, lower case, & as "and", every
 * run of other characters one space, trimmed.
 * @param {string} value
 * @returns {string}  "Tver' Oblast" gives 'tver oblast'
 */
export function normalizePlace(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function coreName(value) {
  const core = normalizePlace(value).split(' ').filter((word) => word && !GENERIC_WORDS.has(word)).join(' ')
  return core
}

/**
 * @typedef {{ exact: Map<string, string>, core: Map<string, string> }} SubdivisionIndex
 *   normalized name, and core name, to the state name; the first state wins a key
 */

/**
 * Build the lookup of name variants to state names for one checklist.
 * @param {{ properties: { name: string, aliases?: string[] } }[]} features
 * @returns {SubdivisionIndex}
 */
export function buildSubdivisionIndex(features) {
  const exact = new Map()
  const core = new Map()
  const add = (map, key, name) => {
    if (key && !map.has(key)) map.set(key, name)
  }
  for (const feature of features) add(exact, normalizePlace(feature.properties.name), feature.properties.name)
  for (const feature of features) {
    for (const alias of feature.properties.aliases || []) add(exact, normalizePlace(alias), feature.properties.name)
  }
  for (const feature of features) add(core, coreName(feature.properties.name), feature.properties.name)
  for (const feature of features) {
    for (const alias of feature.properties.aliases || []) add(core, coreName(alias), feature.properties.name)
  }
  return { exact, core }
}

/**
 * The index of plain state names (as Geometry.stateNames gives them).
 * @param {string[]} names
 * @returns {SubdivisionIndex}
 */
export function stateIndex(names) {
  return buildSubdivisionIndex(names.map((name) => ({ properties: { name } })))
}

/**
 * The state the first matching candidate names.
 * @param {SubdivisionIndex} index
 * @param {...string} candidates  place texts, tried in order (empty ones skipped)
 * @returns {string}  the state name, '' when no candidate matches
 */
export function resolveSubdivision(index, ...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizePlace(candidate)
    if (!normalized) continue
    const hit = index.exact.get(normalized) || index.core.get(coreName(candidate))
    if (hit) return hit
  }
  return ''
}
