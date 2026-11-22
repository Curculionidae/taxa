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
//  - A checklist has states (`states`) when its name is in the rules file's
//    state_countries list; this file holds no list of its own.
//  - A country area is what TaxonWorks calls one (isCountryArea in areas.js,
//    after GeographicArea#categorize): its id equals its level0 id, or its type
//    is a country-level type, or its parent is Earth and it is not TDWG. So GA
//    33412 "United States of America" (type Country, level0 empty) is a
//    country, and the US states, whose level0 is 33412, belong to it (R17).
//    A country area whose parent is "Earth" is a checklist. A country area
//    under another parent (England under United Kingdom, Sint Maarten under
//    Netherlands) is not a checklist of its own: its id joins the checklist
//    of its parent's country (R10).
//  - A level0 id that areas refer to but that is not itself among the areas (a
//    country used only through its subdivisions, such as Spain) becomes a
//    country too, named by `level0Names` (the build fills it from the DwC
//    country text of those records). Without a name it is skipped and a
//    warning is returned.
//  - Countries whose names are synonyms (rules.synonyms, accent and case
//    insensitive) or equal after normalizing merge into one checklist. Its id
//    is the area with the only ISO code; with none or several, the lowest id.
//    Today's ids stay the same, because country files are named <id>.json.
//  - A country without an ISO code from TaxonWorks (Natural Earth country
//    areas and stubs carry none) takes it from the rules file's iso_codes, by
//    its name or any synonym of it (R18), and carries that line as `isoRef`.
//  - Every rules.checklists entry is a checklist of its own, even with `of:`.
//    Its id is its first GA area, so its areas must list the areas of today's
//    country file. No area id belongs to two checklists: an id listed by such
//    an entry is removed from the country checklist it would otherwise belong
//    to (a country left with no area is dropped).
import { normalizeName, isCountryArea } from './areas.js'


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
 * @property {boolean} states    browsed by state or province: the name is in the rules
 *   file's state_countries (rules.stateCountries, accent and case insensitive)
 * @property {string} [ref]      'placement.yml:56', the rules entry, for own checklists
 */

/**
 * Derive the checklists.
 * @param {import('./areas.js').Area[]} areas
 * @param {import('./rules.js').CompiledRules} rules
 * @param {Map<number, string>} [level0Names]  names of level0 ids no area is itself (R9)
 * @returns {{ checklists: Checklist[], warnings: string[] }}  warnings name level0 ids skipped for lack of a name
 */
export function deriveChecklists(areas, rules, level0Names = new Map()) {
  const canonical = new Map() // normalized synonym -> checklist name
  const stateCountries = new Set((rules.stateCountries?.names ?? []).map(normalizeName))
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
    if (!isCountryArea(area) || owned.has(area.id)) continue
    if (area.parentName != null && normalizeName(area.parentName) !== 'earth') nested.push(area)
    else addCountry(area.id, area.name, area.iso2)
  }
  // Countries used only through their subdivisions.
  const stubs = new Map() // level0 id -> ids of the areas that refer to it
  for (const area of areas) {
    if (area.kind !== 'GA' || area.level0 == null || areaById.has(area.level0) || owned.has(area.level0)) continue
    if (!stubs.has(area.level0)) stubs.set(area.level0, [])
    stubs.get(area.level0).push(area.id)
  }
  for (const [id, users] of stubs) {
    const name = level0Names.get(id)
    if (name) addCountry(id, name, '')
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

  // ISO code from the rules file's iso_codes by the checklist name or any synonym of it (R18).
  const isoByName = new Map((rules.isoCodes ?? []).map((entry) => [normalizeName(entry.name), entry]))
  const usedIso = new Set()
  const isoFor = (name) => {
    const names = [name, ...(rules.synonyms.find((s) => s.names.some((n) => normalizeName(n) === normalizeName(name)))?.names ?? [])]
    for (const n of names) {
      const entry = isoByName.get(normalizeName(n))
      if (entry) { usedIso.add(entry); return entry }
    }
    return null
  }

  /** @type {Checklist[]} */
  const list = []
  for (const entry of countries.values()) {
    const withIso = entry.members.filter((member) => member.iso2)
    const id = withIso.length === 1 ? withIso[0].id : Math.min(...entry.members.map((member) => member.id))
    const fromRules = withIso.length ? null : isoFor(entry.name)
    const checklist = {
      id,
      name: entry.name,
      iso2: withIso[0]?.iso2 ?? fromRules?.iso ?? '',
      ...(fromRules ? { isoRef: fromRules.ref } : {}),
      areaIds: entry.members.map((member) => member.id),
      states: stateCountries.has(normalizeName(entry.name))
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
      states: stateCountries.has(normalizeName(entry.name)),
      ref: entry.ref
    })
  }
  // An unused iso_codes line: no checklist of that name (or synonym), or one
  // that already has its code from TaxonWorks or its checklists entry.
  for (const entry of rules.isoCodes ?? []) {
    if (usedIso.has(entry)) continue
    const names = [entry.name, ...(rules.synonyms.find((s) => s.names.some((n) => normalizeName(n) === normalizeName(entry.name)))?.names ?? [])]
    const checklist = list.find((candidate) => names.some((n) => normalizeName(n) === normalizeName(candidate.name)))
    warnings.push(checklist
      ? `${entry.ref}: iso_codes entry ${entry.name} is not needed: the checklist ${checklist.name} has ISO code ${checklist.iso2} from ${checklist.ref ? `its checklists entry (${checklist.ref})` : 'TaxonWorks'}`
      : `${entry.ref}: iso_codes entry ${entry.name} matches no checklist`)
  }
  return { checklists: list, warnings }
}

/**
 * Every name of a checklist: its own name, then the other names of the
 * synonym entries it belongs to (rules file `synonyms`, accent and case
 * insensitive), each once. Used wherever something is looked up by checklist
 * name, such as a fallback outline named "Saint Barthelemy" for the checklist
 * Saint Barthélemy.
 * @param {string} name  checklist name
 * @param {import('./rules.js').CompiledRules} rules
 * @returns {string[]}  the name first
 */
export function checklistNames(name, rules) {
  const wanted = normalizeName(name)
  const names = [name]
  for (const entry of rules?.synonyms ?? []) {
    if (!entry.names.some((other) => normalizeName(other) === wanted)) continue
    for (const other of entry.names) if (!names.includes(other)) names.push(other)
  }
  return names
}

/**
 * The value stored under the first name of a checklist (checklistNames) that
 * a map keyed by normalizeName holds.
 * @template T
 * @param {Map<string, T>} byNormalizedName
 * @param {string} name  checklist name
 * @param {import('./rules.js').CompiledRules} rules
 * @returns {T|undefined}
 */
export function findByName(byNormalizedName, name, rules) {
  for (const candidate of checklistNames(name, rules)) {
    const key = normalizeName(candidate)
    if (byNormalizedName.has(key)) return byNormalizedName.get(key)
  }
  return undefined
}
