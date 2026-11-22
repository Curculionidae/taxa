// Compiler for the placement rules file (modules/checklists/rules/placement.yml).
//
// Purpose: the placement engine reads its hand-edited rules as plain data. This
// module turns the YAML text into that data and records, for every rule, the
// line it stands on, so each explanation step can cite "placement.yml:12".
//
// Input:  the text of the rules file, and the file name used in line references.
// Output: a CompiledRules object (see the typedef on compileRules). YAML keys
//         in snake_case become camelCase fields. Area ids and TDWG codes are
//         always strings (a YAML `tdwg: 33` becomes '33').
// Errors: any problem throws Error('placement.yml:<line>: <message>') with the
//         1-based line of the offending key or list item; nothing is repaired
//         silently. Unknown keys are errors, so a typo never disables a rule.
//
// validateRules checks the compiled rules against the checklists once they
// are derived (checklists.js deriveChecklists): every country, part and state
// a rule names must exist, so a misspelt name stops the build with its line
// instead of leaving records unplaced. It also lists the rules that match no
// used area, for the build to warn about.
import { LineCounter, parseDocument, isMap, isSeq, isScalar } from 'yaml'
import { normalizeName } from './areas.js'
import { stateIndex, matchSubdivision } from './states.js'

const SECTIONS = ['checklists', 'state_countries', 'synonyms', 'ignored_name_words', 'coastal_tolerance_degrees', 'share_threshold_percent', 'parts', 'iso_codes', 'manual', 'overlap']
const CHECKLIST_KEYS = ['name', 'iso2', 'of', 'areas', 'names', 'box', 'outline', 'why']
const OUTLINES = ['natural_earth']
const PART_KEYS = ['name', 'areas', 'names', 'box', 'rest']
const RULE_KEYS = ['match', 'subdivision_of', 'synonymous_with', 'not_placeable', 'why', 'measured', 'pct']
const ACTION_KEYS = ['subdivision_of', 'synonymous_with', 'not_placeable']
const MATCH_KEYS = { area: 'area', tdwg: 'tdwg', gazetteer_prefix: 'gazetteerPrefix', iso2: 'iso2' }
const SUBDIVISION_KEYS = ['country', 'part', 'state']
const AREA_KEY = /^G[AZ] \d+$/

/**
 * @typedef {'GA 78' | 'GZ 10453'} AreaKey  GA = geographic area, GZ = gazetteer, then the id.
 *
 * @typedef {Object} Rule
 * @property {{ area?: AreaKey, tdwg?: string, gazetteerPrefix?: string, iso2?: string }} match
 * @property {{ subdivisionOf: { country: string, part?: string, state?: string } }
 *   | { synonymousWith: AreaKey } | { notPlaceable: string }} action
 * @property {string} [why]       reason, written by hand
 * @property {string} [measured]  measurement text of an overlap rule
 * @property {number} [pct]       first percentage in `measured`, or an explicit `pct`
 * @property {string} ref         'placement.yml:12'
 *
 * @typedef {Object} CompiledRules
 * @property {{ name: string, iso2: string, of?: string, areas: AreaKey[], names: string[],
 *   box?: number[], outline?: 'natural_earth', outlineRef?: string, why: string, ref: string }[]} checklists
 *   `outline: natural_earth` takes the checklist's outline from the Natural Earth
 *   fallback outlines even when an area outline is cached; outlineRef is its line
 * @property {{ names: string[], ref: string|null }} stateCountries  checklists browsed by
 *   state or province (ref is the line of the key, null when the file has no such list)
 * @property {{ names: string[], ref: string }[]} synonyms  first name is the checklist name
 * @property {{ name: string, iso: string, ref: string }[]} isoCodes  ISO codes of countries whose
 *   TaxonWorks country area carries none (section iso_codes), each with its line
 * @property {{ words: string[], ref: string|null }} ignoredNameWords  words left out when a
 *   state name is compared (lower case, as written; ref is the line of the key, null when
 *   the file has no such list)
 * @property {{ degrees: number, ref: string|null }} coastalTolerance  a point outside every
 *   outline but this close to one counts for it (0 and ref null when the file gives none)
 * @property {{ percent: number, ref: string }|null} shareThreshold  the share of an outline
 *   that decides (90): the measuring script writes subdivision_of from it, the engine
 *   places a specimen's georeference shape by it; null when the file gives none (the
 *   engine then tests only the point inside a shape)
 * @property {Object<string, { name: string, areas: AreaKey[], names: string[], box?: number[],
 *   rest?: true, ref: string }[]>} parts  by country name
 * @property {Object<string, string>} partsRefs  the line of each country key of `parts`
 * @property {Rule[]} manual   hand-written area rules, win over overlap
 * @property {Rule[]} overlap  measured area rules, written by the measuring script
 */

/**
 * Compile the text of the rules file.
 * @param {string} yamlText
 * @param {string} [file]  name used in line references and errors
 * @returns {CompiledRules}
 * @throws {Error} 'placement.yml:<line>: <message>' on any YAML or validation error
 */
export function compileRules(yamlText, file = 'placement.yml') {
  const lineCounter = new LineCounter()
  const doc = parseDocument(yamlText, { lineCounter })
  const lineAt = (offset) => lineCounter.linePos(offset).line
  const lineOf = (node) => lineAt(node?.range?.[0] ?? 0)
  const fail = (line, message) => { throw new Error(`${file}:${line}: ${message}`) }
  const ref = (node) => `${file}:${lineOf(node)}`

  if (doc.errors.length) {
    const error = doc.errors[0]
    fail(error.linePos?.[0]?.line ?? 1, error.message.split('\n')[0])
  }
  const empty = {
    checklists: [],
    stateCountries: { names: [], ref: null },
    synonyms: [],
    ignoredNameWords: { words: [], ref: null },
    coastalTolerance: { degrees: 0, ref: null },
    shareThreshold: null,
    parts: {},
    partsRefs: {},
    isoCodes: [],
    manual: [],
    overlap: []
  }
  if (doc.contents == null) return empty
  if (!isMap(doc.contents)) fail(lineOf(doc.contents), 'the file must be a map of sections')

  // Entries of a map node as { key, node, line } with the key checked against `allowed`.
  const entriesOf = (map, allowed) => {
    if (!isMap(map)) fail(lineOf(map), 'expected a map')
    return map.items.map((pair) => {
      const key = String(pair.key?.value ?? pair.key)
      if (!allowed.includes(key)) fail(lineOf(pair.key), `unknown key "${key}"`)
      return { key, node: pair.value, line: lineOf(pair.key) }
    })
  }
  const items = (node, section) => {
    if (node == null) return []
    if (!isSeq(node)) fail(lineOf(node), `"${section}" must be a list`)
    return node.items
  }
  const text = (entry) => {
    if (!isScalar(entry.node) || entry.node.value == null) fail(entry.line, `"${entry.key}" must be text`)
    return String(entry.node.value)
  }
  const list = (entry) => {
    if (!isSeq(entry.node)) fail(entry.line, `"${entry.key}" must be a list`)
    return entry.node.items.map((item) => String(item?.value ?? item))
  }
  const areaKey = (value, line, what) => {
    if (!AREA_KEY.test(value)) fail(line, `${what} "${value}" is not an area key like "GA 78" or "GZ 10453"`)
    return value
  }
  const areaList = (entry) => list(entry).map((v) => areaKey(v, entry.line, 'area'))
  const box = (entry) => {
    const values = list(entry).map(Number)
    if (values.length !== 4 || values.some(Number.isNaN)) fail(entry.line, '"box" needs four numbers [west, south, east, north]')
    return values
  }

  const compileChecklist = (node) => {
    const out = { name: '', iso2: '', areas: [], names: [], why: '', ref: ref(node) }
    for (const entry of entriesOf(node, CHECKLIST_KEYS)) {
      if (entry.key === 'areas') out.areas = areaList(entry)
      else if (entry.key === 'names') out.names = list(entry)
      else if (entry.key === 'box') out.box = box(entry)
      else if (entry.key === 'outline') {
        const value = text(entry)
        if (!OUTLINES.includes(value)) fail(entry.line, `"outline" must be one of ${OUTLINES.join(', ')}`)
        out.outline = value
        out.outlineRef = `${file}:${entry.line}`
      } else out[entry.key] = text(entry)
    }
    if (!out.name) fail(lineOf(node), 'a checklist needs a name')
    if (!out.iso2) fail(lineOf(node), `checklist "${out.name}" needs an iso2`)
    return out
  }

  const compilePart = (node) => {
    const out = { name: '', areas: [], names: [], ref: ref(node) }
    for (const entry of entriesOf(node, PART_KEYS)) {
      if (entry.key === 'areas') out.areas = areaList(entry)
      else if (entry.key === 'names') out.names = list(entry)
      else if (entry.key === 'box') out.box = box(entry)
      else if (entry.key === 'rest') {
        if (!isScalar(entry.node) || typeof entry.node.value !== 'boolean') fail(entry.line, '"rest" must be true or false')
        if (entry.node.value) out.rest = true
      }
      else out.name = text(entry)
    }
    if (!out.name) fail(lineOf(node), 'a part needs a name')
    return out
  }

  const compileRule = (node) => {
    const rule = { match: {}, action: null, ref: ref(node) }
    let actions = 0
    for (const entry of entriesOf(node, RULE_KEYS)) {
      if (entry.key === 'match') {
        const given = entriesOf(entry.node, Object.keys(MATCH_KEYS))
        if (!given.length) fail(entry.line, '"match" is empty')
        for (const m of given) {
          const value = text(m)
          rule.match[MATCH_KEYS[m.key]] = m.key === 'area' ? areaKey(value, m.line, 'area') : value
        }
      } else if (ACTION_KEYS.includes(entry.key)) {
        actions += 1
        if (entry.key === 'subdivision_of') {
          const out = {}
          for (const part of entriesOf(entry.node, SUBDIVISION_KEYS)) out[part.key] = text(part)
          if (!out.country) fail(entry.line, '"subdivision_of" needs a country')
          rule.action = { subdivisionOf: out }
        } else if (entry.key === 'synonymous_with') {
          rule.action = { synonymousWith: areaKey(text(entry), entry.line, 'area') }
        } else {
          rule.action = { notPlaceable: text(entry) }
        }
      } else if (entry.key === 'pct') {
        rule.pct = Number(entry.node?.value)
      } else {
        rule[entry.key] = text(entry)
      }
    }
    if (!Object.keys(rule.match).length) fail(lineOf(node), 'a rule needs a "match"')
    if (actions === 0) fail(lineOf(node), 'a rule needs an action (subdivision_of, synonymous_with or not_placeable)')
    if (actions > 1) fail(lineOf(node), 'a rule has more than one action; use exactly one action')
    if (rule.pct === undefined && rule.measured) {
      const found = /(\d+(?:\.\d+)?)\s*%/.exec(rule.measured)
      if (found) rule.pct = Number(found[1])
    }
    return rule
  }

  const out = { ...empty, parts: {}, partsRefs: {} }
  for (const section of entriesOf(doc.contents, SECTIONS)) {
    const { key, node } = section
    if (key === 'checklists') out.checklists = items(node, key).map(compileChecklist)
    else if (key === 'manual' || key === 'overlap') out[key] = items(node, key).map(compileRule)
    else if (key === 'synonyms') {
      out.synonyms = items(node, key).map((item) => {
        if (!isSeq(item)) fail(lineOf(item), 'a synonym entry is a list of names, the checklist name first')
        const names = item.items.map((n) => String(n?.value ?? n))
        if (names.length < 2) fail(lineOf(item), 'a synonym entry needs at least two names')
        return { names, ref: ref(item) }
      })
    } else if (key === 'iso_codes') {
      if (!isMap(node)) fail(section.line, '"iso_codes" must be a map from country name to its ISO 3166-1 alpha-2 code')
      out.isoCodes = node.items.map((pair) => {
        const name = String(pair.key?.value ?? pair.key)
        const iso = String(pair.value?.value ?? pair.value ?? '')
        if (!/^[A-Z]{2}$/.test(iso)) fail(lineOf(pair.key), `the ISO code of ${name} must be two capital letters`)
        return { name, iso, ref: ref(pair.key) }
      })
    } else if (key === 'state_countries') {
      out.stateCountries = { names: list(section), ref: `${file}:${section.line}` }
    } else if (key === 'ignored_name_words') {
      out.ignoredNameWords = { words: list(section).map((word) => word.toLowerCase()), ref: `${file}:${section.line}` }
    } else if (key === 'coastal_tolerance_degrees') {
      const degrees = isScalar(node) ? node.value : null
      if (typeof degrees !== 'number' || !(degrees >= 0) || degrees >= 1) {
        fail(section.line, '"coastal_tolerance_degrees" must be a number of degrees from 0 to below 1')
      }
      out.coastalTolerance = { degrees, ref: `${file}:${section.line}` }
    } else if (key === 'share_threshold_percent') {
      const percent = isScalar(node) ? node.value : null
      if (typeof percent !== 'number' || !(percent > 50) || percent > 100) {
        fail(section.line, '"share_threshold_percent" must be a percentage above 50, at most 100')
      }
      out.shareThreshold = { percent, ref: `${file}:${section.line}` }
    } else {
      if (!isMap(node)) fail(section.line, '"parts" must be a map from country name to a list of parts')
      for (const pair of node.items) {
        out.parts[String(pair.key.value)] = items(pair.value, String(pair.key.value)).map(compilePart)
        out.partsRefs[String(pair.key.value)] = ref(pair.key)
      }
    }
  }
  return out
}


/**
 * Check the compiled rules against the checklists (see the header).
 * @param {CompiledRules} rules
 * @param {Object} input
 * @param {import('./checklists.js').Checklist[]} input.checklists  from deriveChecklists
 * @param {import('./areas.js').Area[]} [input.areas]  every used area, for the warnings
 * @param {(checklist: import('./checklists.js').Checklist) => { name: string }[]} [input.stateNamesOf]
 *   the states of a checklist with states (Geometry.stateNames); without it states are not checked
 * @param {(rule: Rule, area: import('./areas.js').Area) => boolean} [input.matches]  engine.js ruleMatches
 * @returns {{ warnings: string[] }}  'placement.yml:200: matches no used area (tdwg 12FRA)'
 * @throws {Error} 'placement.yml:<line>: unknown country "X"' and the like, for the first problem
 */
export function validateRules(rules, { checklists, areas = [], stateNamesOf = null, matches = null }) {
  const byName = new Map(checklists.map((checklist) => [normalizeName(checklist.name), checklist]))
  // Every synonym of a checklist names it too (engine.js createContext does the same).
  for (const { names } of rules.synonyms) {
    const checklist = byName.get(normalizeName(names[0]))
    if (checklist) for (const name of names) if (!byName.has(normalizeName(name))) byName.set(normalizeName(name), checklist)
  }
  const fail = (ref, message) => { throw new Error(`${ref ?? 'placement.yml'}: ${message}`) }

  for (const { names, ref } of rules.synonyms) {
    if (!checklists.some((checklist) => normalizeName(checklist.name) === normalizeName(names[0]))) {
      fail(ref, `the first name of a synonym list must be a checklist; "${names[0]}" is none`)
    }
  }
  for (const name of rules.stateCountries?.names ?? []) {
    if (!byName.has(normalizeName(name))) fail(rules.stateCountries.ref, `unknown country "${name}" in state_countries`)
  }
  for (const [country, parts] of Object.entries(rules.parts ?? {})) {
    if (!byName.has(normalizeName(country))) fail(rules.partsRefs?.[country] ?? parts[0]?.ref, `unknown country "${country}" in parts`)
  }

  const indexes = new Map()
  const statesOf = (checklist) => {
    if (!indexes.has(checklist.id)) indexes.set(checklist.id, stateIndex(stateNamesOf(checklist), rules.ignoredNameWords?.words ?? []))
    return indexes.get(checklist.id)
  }
  for (const rule of [...rules.manual, ...rules.overlap]) {
    const sub = rule.action.subdivisionOf
    if (!sub) continue
    const checklist = byName.get(normalizeName(sub.country))
    if (!checklist) fail(rule.ref, `unknown country "${sub.country}"`)
    if (sub.part) {
      const parts = Object.entries(rules.parts ?? {}).find(([country]) => byName.get(normalizeName(country)) === checklist)?.[1] ?? []
      if (!parts.some((part) => normalizeName(part.name) === normalizeName(sub.part))) fail(rule.ref, `unknown part "${sub.part}" of ${checklist.name}`)
    }
    if (sub.state && stateNamesOf) {
      if (!checklist.states) fail(rule.ref, `${checklist.name} is not in state_countries, so it has no state "${sub.state}"`)
      if (!matchSubdivision(statesOf(checklist), sub.state)) fail(rule.ref, `unknown state "${sub.state}" of ${checklist.name}`)
    }
  }

  const warnings = []
  if (matches) {
    for (const rule of [...rules.manual, ...rules.overlap]) {
      if (!areas.some((area) => matches(rule, area))) {
        warnings.push(`${rule.ref}: matches no used area (${Object.entries(rule.match).map(([key, value]) => `${key} ${value}`).join(', ')})`)
      }
    }
  }
  return { warnings }
}
