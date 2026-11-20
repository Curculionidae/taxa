// State and province names: matching place text to the states of one checklist.
//
// Purpose: the one way a state or province name is recognised, used by the
// placement engine (engine.js: the state of an asserted distribution from its
// area's name, the state of a specimen from its DwC stateProvince).
//
// Input:  the states of ONE checklist, each with its name (stateIndex: the
//         name only; the Natural Earth `aliases` of subdivisions.geojson decide
//         nothing since R51), the words to ignore (rules file
//         `ignored_name_words`), and the place text. buildSubdivisionIndex
//         still indexes aliases when its features have them: compareCaches.mjs
//         uses it to reproduce how the old page found states.
// Output: matchSubdivision gives the state and how it matched (after ignoring
//         words); resolveSubdivision only the state name.
// Matching: first the exact name or alias after normalizePlace (accents, case
//         and punctuation ignored, & read as "and"), then the core name, the
//         name or alias without the ignored words ("Krasnoyarsk Krai" finds
//         Krasnoyarsk when "krai" is ignored). A state's own name wins over
//         another state's alias, and an exact match over a core match.
//         Names are only ever compared within one checklist, so the US state
//         Georgia never meets the country Georgia (R16). This file holds no
//         word list of its own: the words come from the rules file.
// Purity: no network, no hidden state; runs in Node and in the browser.

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

// The normalized words of a name, split into the core (kept words) and the ignored ones.
function splitWords(value, ignored) {
  const words = normalizePlace(value).split(' ').filter(Boolean)
  return {
    core: words.filter((word) => !ignored.has(word)).join(' '),
    dropped: words.filter((word) => ignored.has(word))
  }
}

/**
 * @typedef {{ name: string, alias: string|null, text: string }} IndexHit  the state,
 *   the Natural Earth alias of the entry (null for the state's own name), and the
 *   indexed text (name or alias)
 * @typedef {{ exact: Map<string, IndexHit>, core: Map<string, IndexHit>, ignored: Set<string> }} SubdivisionIndex
 *   normalized name or alias, and core name, to the state; the first entry wins a
 *   key; `ignored` holds the normalized words left out of core names
 * @typedef {{ state: string, candidate: string, alias: string|null, ignored: string[] }} SubdivisionMatch
 *   the state name, the place text that matched, the alias it matched through
 *   (null for the state's own name), and the words ignored to match (empty for an
 *   exact match)
 */

/**
 * Build the lookup of name variants to state names for one checklist.
 * @param {{ properties: { name: string, aliases?: string[] } }[]} features
 * @param {string[]} [ignoredWords]  words left out of core names (rules file
 *   `ignored_name_words`); none means exact names and aliases only
 * @returns {SubdivisionIndex}
 */
export function buildSubdivisionIndex(features, ignoredWords = []) {
  const ignored = new Set(ignoredWords.map(normalizePlace).filter(Boolean))
  const own = []
  const aliases = []
  for (const { properties: { name, aliases: list } } of features) {
    own.push({ name, alias: null, text: name })
    for (const alias of list || []) aliases.push({ name, alias, text: alias })
  }
  // Own names before aliases, so a state's own name wins over another state's alias.
  const hits = [...own, ...aliases]
  const exact = new Map()
  const core = new Map()
  for (const hit of hits) {
    const key = normalizePlace(hit.text)
    if (key && !exact.has(key)) exact.set(key, hit)
  }
  for (const hit of hits) {
    const key = splitWords(hit.text, ignored).core
    if (key && !core.has(key)) core.set(key, hit)
  }
  return { exact, core, ignored }
}

/**
 * The index of one checklist's states as Geometry.stateNames gives them, by
 * their names only: other names (aliases) are left out (R51).
 * @param {{ name: string }[]} states
 * @param {string[]} [ignoredWords]  rules file `ignored_name_words`
 * @returns {SubdivisionIndex}
 */
export function stateIndex(states, ignoredWords = []) {
  return buildSubdivisionIndex(states.map(({ name }) => ({ properties: { name, aliases: [] } })), ignoredWords)
}

/**
 * The state the first matching candidate names, and how it matched.
 * @param {SubdivisionIndex} index
 * @param {...string} candidates  place texts, tried in order (empty ones skipped)
 * @returns {SubdivisionMatch|null}  null when no candidate matches
 */
export function matchSubdivision(index, ...candidates) {
  for (const candidate of candidates) {
    if (!normalizePlace(candidate)) continue
    const text = String(candidate).trim()
    const exact = index.exact.get(normalizePlace(candidate))
    if (exact) return { state: exact.name, candidate: text, alias: aliasOf(exact), ignored: [] }
    const { core, dropped } = splitWords(candidate, index.ignored)
    const hit = index.core.get(core)
    if (hit) {
      const ignored = [...new Set([...dropped, ...splitWords(hit.text, index.ignored).dropped])]
      return { state: hit.name, candidate: text, alias: aliasOf(hit), ignored }
    }
  }
  return null
}

// The alias of a hit, null when there is none or it is spelled like the state
// name (Natural Earth lists 'Xinjiang' among the aliases of Xinjiang).
function aliasOf(hit) {
  return hit.alias && normalizePlace(hit.alias) !== normalizePlace(hit.name) ? hit.alias : null
}

/**
 * The state the first matching candidate names.
 * @param {SubdivisionIndex} index
 * @param {...string} candidates  place texts, tried in order (empty ones skipped)
 * @returns {string}  the state name, '' when no candidate matches
 */
export function resolveSubdivision(index, ...candidates) {
  return matchSubdivision(index, ...candidates)?.state ?? ''
}
