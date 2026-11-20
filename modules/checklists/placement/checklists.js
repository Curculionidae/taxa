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
//  - A country area is a geographic area whose id equals its level0 id and
//    whose parent is "Earth". A country-level area under another parent (England
//    under United Kingdom, Sint Maarten under Netherlands) is not a checklist
//    of its own: its id joins the checklist of its parent's country.
//  - A level0 id that areas refer to but that is not itself among the areas (a
//    country used only through its subdivisions, such as Spain) becomes a
//    country too, named by `level0Names` (the build fills it from the DwC
//    country text of those records). Without a name it is skipped and a
//    warning is returned.
//  - A level0 id whose own area is among the areas but is not country-level
//    (GA 33412 "United States of America" has no level0 of its own, yet every
//    Natural Earth US state points to it) becomes a country the same way,
//    named by `level0Names` or else by that area's own name, and merges by
//    synonyms (R17).
//  - Countries whose names are synonyms (rules.synonyms, accent and case
//    insensitive) or equal after normalizing merge into one checklist. Its id
//    is the area with the only ISO code; with none or several, the lowest id.
//    Today's ids stay the same, because country files are named <id>.json.
//  - A country without an ISO code from TaxonWorks (Natural Earth country
//    areas and stubs carry none) takes it from `isoByName`, by its name or
//    any synonym of it (R18). The build passes scripts/data/country-iso.json.
//  - Every rules.checklists entry is a checklist of its own, even with `of:`.
//    Its id is its first GA area, so its areas must list the areas of today's
//    country file. No area id belongs to two checklists: an id listed by such
//    an entry is removed from the country checklist it would otherwise belong
//    to (a country left with no area is dropped).
import { normalizeName } from './areas.js'

/** Countries whose checklist can be browsed by state or province. */
const STATE_COUNTRIES = new Set(
  ['United States', 'Canada', 'Australia', 'China', 'Russia', 'United Kingdom'].map(normalizeName)
)

/**
 * @typedef {Object} Checklist
 * @property {number|string} id  merged country: the id of its only area with an ISO
 *   code, else its lowest area id; checklist of the rules file: the numeric id of its
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
 * @param {Map<number, string>} [level0Names]  names of level0 ids no area is itself (R9),
 *   or whose area is not country-level (R17)
 * @param {Map<string, string>} [isoByName]  ISO 3166-1 alpha-2 code by normalizeName(country
 *   name), used for countries TaxonWorks gives no ISO code (R18)
 * @returns {{ checklists: Checklist[], warnings: string[] }}  warnings name level0 ids skipped for lack of a name
 */
export function deriveChecklists(areas, rules, level0Names = new Map(), isoByName = new Map()) {
  const canonical = new Map() // normalized synonym -> checklist name
  for (const { names } of rules.synonyms) {
    for (const name of names) canonical.set(normalizeName(name), names[0])
  }

  // Ids that rules.checklists give to their own checklists.
  const owned = new Set()
  for (const entry of rules.checklists) {
    for (const key of entry.areas) if (key.startsWith('GA ')) owned.add(Number(key.slice(3)))
  }

  const warnings = []
  const areaById = new Map(areas.filter((area) => area.kind === 'GA').map((area) => [area.id, area]))
  const isCountryLevel = (area) => area.kind === 'GA' && area.level0 != null && area.id === area.level0
  const nameOf = (name) => canonical.get(normalizeName(name)) ?? name

  const countries = new Map() // normalized canonical name -> { name, members: [{ id, iso2 }] }
  const addCountry = (id, rawName, iso2) => {
    const name = nameOf(rawName)
    const key = normalizeName(name)
    if (!countries.has(key)) countries.set(key, { name, members: [] })
    const members = countries.get(key).members
    if (!members.some((member) => member.id === id)) members.push({ id, iso2: iso2 || '' })
  }
  const nested = []
  for (const area of areas) {
    if (!isCountryLevel(area) || owned.has(area.id)) continue
    if (area.parentName != null && normalizeName(area.parentName) !== 'earth') nested.push(area)
    else addCountry(area.id, area.name, area.iso2)
  }
  // Countries used only through their subdivisions, or whose own area is not
  // country-level (GA 33412 United States of America, R17).
  const stubs = new Map() // level0 id -> ids of the areas that refer to it
  for (const area of areas) {
    if (area.kind !== 'GA' || area.level0 == null || owned.has(area.level0)) continue
    const own = areaById.get(area.level0)
    if (own && isCountryLevel(own)) continue
    if (!stubs.has(area.level0)) stubs.set(area.level0, [])
    stubs.get(area.level0).push(area.id)
  }
  for (const [id, users] of stubs) {
    const name = level0Names.get(id) ?? areaById.get(id)?.name
    if (name) addCountry(id, name, areaById.get(id)?.iso2 ?? '')
    else warnings.push(`level0 ${id} has no name (areas: ${users.join(', ')})`)
  }
  // A country-level area under another country joins that country's checklist.
  for (const area of nested) {
    const parent = areaById.get(area.parentId)
    const parentCountryId = parent ? (parent.level0 ?? parent.id) : null
    const home = [...countries.values()].find((entry) => entry.members.some((m) => m.id === parentCountryId)) ??
      countries.get(normalizeName(nameOf(area.parentName)))
    if (home) home.members.push({ id: area.id, iso2: '' })
    else addCountry(area.id, area.name, area.iso2)
  }

  // ISO code from isoByName by the checklist name or any synonym of it (R18).
  const isoFor = (name) => {
    const names = [name, ...(rules.synonyms.find((s) => s.names.some((n) => normalizeName(n) === normalizeName(name)))?.names ?? [])]
    for (const n of names) {
      const iso = isoByName.get(normalizeName(n))
      if (iso) return iso
    }
    return ''
  }

  /** @type {Checklist[]} */
  const list = []
  for (const entry of countries.values()) {
    const withIso = entry.members.filter((member) => member.iso2)
    const id = withIso.length === 1 ? withIso[0].id : Math.min(...entry.members.map((member) => member.id))
    const checklist = {
      id,
      name: entry.name,
      iso2: withIso[0]?.iso2 ?? isoFor(entry.name),
      areaIds: entry.members.map((member) => member.id),
      states: STATE_COUNTRIES.has(normalizeName(entry.name))
    }
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
  return { checklists: list, warnings }
}
