import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules, validateRules } from './rules.js'
import { ruleMatches } from './engine.js'

const MANUAL = `manual:
  # a comment
  - match: { tdwg: 12FRA }
    subdivision_of: { country: France, part: Mainland France }
    why: approximately
  - match: { area: "GZ 3614" }
    not_placeable: spans several countries
`

test('compiles a manual rule with its line', () => {
  const rules = compileRules(MANUAL)
  assert.equal(rules.manual.length, 2)
  const [rule, other] = rules.manual
  assert.equal(rule.ref, 'placement.yml:3')
  assert.deepEqual(rule.match, { tdwg: '12FRA' })
  assert.deepEqual(rule.action, { subdivisionOf: { country: 'France', part: 'Mainland France' } })
  assert.equal(rule.why, 'approximately')
  assert.equal(other.ref, 'placement.yml:6')
  assert.deepEqual(other.action, { notPlaceable: 'spans several countries' })
})

test('overlap rule keeps measurement', () => {
  const rules = compileRules(`overlap:
  - match: { tdwg: 14RUC }
    subdivision_of: { country: "Russia" }
    measured: "Russia 100% (2026-11-20)"
`)
  assert.equal(rules.overlap[0].measured, 'Russia 100% (2026-11-20)')
  assert.equal(rules.overlap[0].pct, 100)
})

test('numeric TDWG codes stay strings', () => {
  const rules = compileRules(`overlap:
  - match: { tdwg: 33 }
    not_placeable: spans several countries
`)
  assert.equal(rules.overlap[0].match.tdwg, '33')
})

test('compiles checklists, synonyms and parts with lines', () => {
  const rules = compileRules(`checklists:
  - name: French Guiana
    iso2: GF
    of: France
    names: [French Guiana, Guyane]
    areas: [GA 32253, GA 78]
    box: [-55, 1.8, -51, 6.2]
    why: own code
synonyms:
  - [Tanzania, United Republic of Tanzania]
parts:
  France:
    - name: Corsica
      areas: [GA 32254]
      names: [Corse]
    - name: Mainland France
      rest: true
`)
  assert.deepEqual(rules.checklists[0], {
    name: 'French Guiana', iso2: 'GF', of: 'France', areas: ['GA 32253', 'GA 78'],
    names: ['French Guiana', 'Guyane'], box: [-55, 1.8, -51, 6.2], why: 'own code', ref: 'placement.yml:2'
  })
  assert.deepEqual(rules.synonyms, [{ names: ['Tanzania', 'United Republic of Tanzania'], ref: 'placement.yml:10' }])
  assert.equal(rules.parts.France[0].ref, 'placement.yml:13')
  assert.equal(rules.parts.France[1].rest, true)
  assert.deepEqual(rules.parts.France[1].areas, [])
})

test('compiles ignored_name_words with the line of its key', () => {
  const rules = compileRules(`synonyms:
  - [Tanzania, United Republic of Tanzania]
ignored_name_words: [Oblast, krai, "Republic"]
`)
  assert.deepEqual(rules.ignoredNameWords, { words: ['oblast', 'krai', 'republic'], ref: 'placement.yml:3' })
  assert.deepEqual(compileRules(MANUAL).ignoredNameWords, { words: [], ref: null })
  assert.throws(() => compileRules('ignored_name_words: oblast\n'), /placement.yml:1: .*must be a list/)
})

test('compiles state_countries with the line of its key', () => {
  const rules = compileRules(`synonyms:
  - [Tanzania, United Republic of Tanzania]
state_countries: [United States, "Russia"]
`)
  assert.deepEqual(rules.stateCountries, { names: ['United States', 'Russia'], ref: 'placement.yml:3' })
  assert.deepEqual(compileRules(MANUAL).stateCountries, { names: [], ref: null })
  assert.throws(() => compileRules('state_countries: Russia\n'), /placement.yml:1: .*must be a list/)
})

test('uses the given file name in refs', () => {
  assert.equal(compileRules(MANUAL, 'x.yml').manual[0].ref, 'x.yml:3')
})

test('rejects an unknown key with its line', () => {
  assert.throws(() => compileRules(`manual:
  - match: { tdwg: 12FRA }
    subdivison_of: { country: France }
`), /placement.yml:3: unknown key "subdivison_of"/)
})

test('rejects an action-less rule', () => {
  assert.throws(() => compileRules(`manual:
  - match: { tdwg: 12FRA }
    why: nothing
`), /placement.yml:2: .*action/)
})

test('rejects two actions in one rule', () => {
  assert.throws(() => compileRules(`manual:
  - match: { tdwg: 12FRA }
    subdivision_of: { country: France }
    not_placeable: both
`), /placement.yml:2: .*one action/)
})

test('rejects a bad area key and an unknown section', () => {
  assert.throws(() => compileRules(`manual:
  - match: { area: "78" }
    not_placeable: x
`), /placement.yml:2: .*area/)
  assert.throws(() => compileRules('bogus: []\n'), /placement.yml:1: unknown key "bogus"/)
})

test('the real file compiles', () => {
  const text = readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8')
  const rules = compileRules(text)
  assert.ok(rules.overlap.length >= 100)
  assert.ok(rules.checklists.some((c) => c.name === 'Northern Mariana Islands' && c.iso2 === 'MP' && c.areas.includes('GA 31750')))
  assert.ok(rules.checklists.some((c) => c.name === 'Kosovo' && c.iso2 === 'XK'))
  const norfolk = rules.checklists.find((c) => c.name === 'Norfolk Island')
  assert.deepEqual(norfolk?.areas, ['GA 33700', 'GZ 10458'])
  assert.equal(norfolk.outline, 'natural_earth')
  assert.equal(rules.coastalTolerance.degrees, 0.05)
  assert.ok(!rules.manual.some((rule) => rule.match.tdwg === '50NFK'))
  assert.deepEqual(rules.checklists.find((c) => c.name === 'French Guiana').areas, ['GA 32253', 'GA 78', 'GA 34200'])
  assert.ok(rules.parts.France.some((p) => p.rest))
  assert.ok(rules.manual.length >= 2)
  assert.ok(rules.ignoredNameWords.words.includes('oblast'))
  assert.deepEqual(rules.stateCountries.names, ['United States', 'Canada', 'Australia', 'China', 'Russia'])
})

test('coastal_tolerance_degrees compiles with its line; a bad value is an error', () => {
  const rules = compileRules('synonyms: []\ncoastal_tolerance_degrees: 0.05\n')
  assert.deepEqual(rules.coastalTolerance, { degrees: 0.05, ref: 'placement.yml:2' })
  assert.deepEqual(compileRules(MANUAL).coastalTolerance, { degrees: 0, ref: null })
  assert.throws(() => compileRules('coastal_tolerance_degrees: about 5 km\n'), /placement.yml:1: "coastal_tolerance_degrees" must be a number/)
})

test('a checklist outline: only natural_earth, compiled with its line', () => {
  const rules = compileRules(`checklists:
  - name: Norfolk Island
    iso2: NF
    outline: natural_earth
`)
  assert.equal(rules.checklists[0].outline, 'natural_earth')
  assert.equal(rules.checklists[0].outlineRef, 'placement.yml:4')
  assert.throws(() => compileRules(`checklists:
  - name: Norfolk Island
    iso2: NF
    outline: tdwg
`), /placement.yml:4: "outline" must be one of natural_earth/)
})

test('rest must be true or false', () => {
  assert.throws(() => compileRules(`parts:
  France:
    - name: Mainland France
      rest: yes please
`), /placement.yml:4: "rest" must be true or false/)
  assert.equal(compileRules(`parts:
  France:
    - name: Mainland France
      rest: false
`).parts.France[0].rest, undefined)
})

// validateRules: a small rules file against two checklists.
const validChecklists = [
  { id: 1, name: 'France', iso2: 'FR', areaIds: [1], states: false },
  { id: 2, name: 'Russia', iso2: 'RU', areaIds: [2], states: true }
]
const stateNamesOf = (checklist) => (checklist.id === 2 ? [{ name: 'Moscow', aliases: ['Moskva'] }] : [])
const VALID = `state_countries: [Russia]
synonyms:
  - [Russia, Russian Federation]
parts:
  France:
    - name: Corsica
      areas: [GA 5]
manual:
  - match: { area: GA 7 }
    subdivision_of: { country: Russian Federation, state: Moscow }
  - match: { tdwg: 12FRA }
    subdivision_of: { country: France, part: Corsica }
`
const validate = (text) => validateRules(compileRules(text), { checklists: validChecklists, stateNamesOf })

test('validateRules: a consistent file passes', () => {
  assert.deepEqual(validate(VALID), { warnings: [] })
})

test('validateRules: unknown country, part, state, state country, parts key and synonym head throw with the line', () => {
  assert.throws(() => validate(VALID.replace('country: France, part', 'country: Frankreich, part')), /^Error: placement.yml:11: unknown country "Frankreich"$/)
  assert.throws(() => validate(VALID.replace('part: Corsica }', 'part: Korsika }')), /placement.yml:11: unknown part "Korsika" of France/)
  assert.throws(() => validate(VALID.replace('state: Moscow', 'state: Moskva')), /placement.yml:9: unknown state "Moskva" of Russia/)
  assert.throws(() => validate(VALID.replace('[Russia]', '[Russia, Utopia]')), /placement.yml:1: unknown country "Utopia" in state_countries/)
  assert.throws(() => validate(VALID.replace('  France:', '  Gallia:').replace('country: France, part: Corsica', 'country: France')), /placement.yml:5: unknown country "Gallia" in parts/)
  assert.throws(() => validate(VALID.replace('[Russia, Russian Federation]', '[Russian Federation, Russia]')), /placement.yml:3: the first name of a synonym list must be a checklist/)
  assert.throws(() => validate(VALID.replace('Russian Federation, state', 'France, state')), /placement.yml:9: France is not in state_countries/)
})

test('validateRules: a rule that matches no used area is a warning', () => {
  const rules = compileRules(VALID)
  const areas = [{ key: 'GA 7', kind: 'GA', id: 7, name: 'Moscow', tdwg: null, iso2: null }]
  const { warnings } = validateRules(rules, { checklists: validChecklists, stateNamesOf, areas, matches: ruleMatches })
  assert.deepEqual(warnings, ['placement.yml:11: matches no used area (tdwg 12FRA)'])
})

test('the real rules file names no state of the United Kingdom, which has no states (R50)', () => {
  const rules = compileRules(readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8'))
  assert.ok(!rules.stateCountries.names.includes('United Kingdom'))
  const uk = [{ id: 236, name: 'United Kingdom', iso2: 'GB', areaIds: [236], states: false }]
  const withState = compileRules(`manual:
  - match: { area: GA 32348 }
    subdivision_of: { country: United Kingdom, state: England }
`)
  assert.throws(() => validateRules(withState, { checklists: uk, stateNamesOf: () => [] }),
    /placement.yml:2: United Kingdom is not in state_countries, so it has no state "England"/)
})
