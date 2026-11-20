import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules } from './rules.js'

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
  assert.deepEqual(rules.checklists.find((c) => c.name === 'Norfolk Island')?.areas, ['GA 33700'])
  assert.ok(!rules.manual.some((rule) => rule.match.tdwg === '50NFK'))
  assert.deepEqual(rules.checklists.find((c) => c.name === 'French Guiana').areas, ['GA 32253', 'GA 78', 'GA 34200'])
  assert.ok(rules.parts.France.some((p) => p.rest))
  assert.ok(rules.manual.length >= 2)
  assert.ok(rules.ignoredNameWords.words.includes('oblast'))
  assert.deepEqual(rules.stateCountries.names, ['United States', 'Canada', 'Australia', 'China', 'Russia', 'United Kingdom'])
})
