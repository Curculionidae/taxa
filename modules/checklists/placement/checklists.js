// The list of checklists, derived from TaxonWorks areas and the rules file.
//
// Purpose: decide which checklists exist and which TaxonWorks areas belong to
// each, the same way the old build did (country areas, merged by synonym), plus
// the checklists of their own from the rules file.
//
// Input:  every Area some distribution uses (areas.js) and CompiledRules (rules.js).
// Output: Checklist[] (see the typedef): first the countries, in the order
//         their first area appears, then the checklists of the rules file in
//         file order.
//
// Rules in short:
//  - A country area is a geographic area whose id equals its level0 id.
//  - Country areas whose names are synonyms (rules.synonyms, accent and case
//    insensitive) or equal after normalizing merge into one checklist. Its id
//    is the area with an ISO code when there is one, else the first area.
//    Today's ids stay the same, because country files are named <id>.json.
//  - Every rules.checklists entry is a checklist of its own, even with `of:`.
//    No area id belongs to two checklists: an id listed by such an entry is
//    removed from the country checklist it would otherwise belong to (a
//    country left with no area is dropped).
import { normalizeName } from './areas.js'

/** Countries whose checklist can be browsed by state or province. */
const STATE_COUNTRIES = new Set(
  ['United States', 'Canada', 'Australia', 'China', 'Russia', 'United Kingdom'].map(normalizeName)
)

/**
 * @typedef {Object} Checklist
 * @property {number|string} id  merged country: the id of its area with an ISO
 *   code (else the first); checklist of the rules file: the numeric id of its
 *   first GA area, else its ISO code ('MP')
 * @property {string} name       checklist name (the first synonym for a merged country)
 * @property {string} iso2       ISO code, '' when there is none
 * @property {number[]} areaIds  GA ids owned by this checklist (GZ areas are
 *   placed by ISO code or by rule, not listed here)
 * @property {string[]} [parts]  part names from rules.parts, when the country has parts
 * @property {boolean} states    true for United States, Canada, Australia, China, Russia, United Kingdom
 * @property {string} [ref]      'placement.yml:56', the rules entry, for own checklists
 */

/**
 * Derive the checklists.
 * @param {import('./areas.js').Area[]} areas
 * @param {import('./rules.js').CompiledRules} rules
 * @returns {Checklist[]}
 */
export function deriveChecklists(areas, rules) {
  const canonical = new Map() // normalized synonym -> checklist name
  for (const { names } of rules.synonyms) {
    for (const name of names) canonical.set(normalizeName(name), names[0])
  }

  // Ids that rules.checklists give to their own checklists.
  const owned = new Set()
  for (const entry of rules.checklists) {
    for (const key of entry.areas) if (key.startsWith('GA ')) owned.add(Number(key.slice(3)))
  }

  const countries = new Map() // normalized canonical name -> merged entry
  for (const area of areas) {
    if (area.kind !== 'GA' || area.level0 == null || area.id !== area.level0) continue
    if (owned.has(area.id)) continue
    const name = canonical.get(normalizeName(area.name)) ?? area.name
    const key = normalizeName(name)
    let entry = countries.get(key)
    if (!entry) {
      entry = { id: area.id, name, iso2: '', areaIds: [] }
      countries.set(key, entry)
    }
    if (!entry.areaIds.includes(area.id)) entry.areaIds.push(area.id)
    if (area.iso2 && !entry.iso2) {
      entry.id = area.id
      entry.iso2 = area.iso2
    }
  }

  /** @type {Checklist[]} */
  const list = []
  for (const entry of countries.values()) {
    const checklist = { ...entry, states: STATE_COUNTRIES.has(normalizeName(entry.name)) }
    const parts = rules.parts[entry.name]
    if (parts) checklist.parts = parts.map((part) => part.name)
    list.push(checklist)
  }
  for (const entry of rules.checklists) {
    const areaIds = entry.areas.filter((key) => key.startsWith('GA ')).map((key) => Number(key.slice(3)))
    list.push({
      id: areaIds.length ? areaIds[0] : entry.iso2,
      name: entry.name,
      iso2: entry.iso2,
      areaIds,
      ...(rules.parts[entry.name] ? { parts: rules.parts[entry.name].map((part) => part.name) } : {}),
      states: STATE_COUNTRIES.has(normalizeName(entry.name)),
      ref: entry.ref
    })
  }
  return list
}
