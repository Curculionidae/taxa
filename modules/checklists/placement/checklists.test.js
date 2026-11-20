import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules } from './rules.js'
import { toArea, normalizeName, containsName } from './areas.js'
import { deriveChecklists } from './checklists.js'
import * as fx from './fixtures.js'

const rules = compileRules(
  readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8')
)
const ga = (shape) => toArea('GeographicArea', shape)
const gz = (shape) => toArea('Gazetteer', shape)
const areas = [
  fx.ga77, fx.ga8837, fx.ga32253, fx.ga34200, fx.ga32254, fx.ga33696, fx.ga33876,
  fx.ga33639, fx.ga19713, fx.ga236, fx.ga34271, fx.ga15, fx.ga31721, fx.ga31745,
  fx.ga188, fx.ga243, fx.ga31774
].map(ga).concat([fx.gz3529, fx.gz10453].map(gz))
const checklists = deriveChecklists(areas, rules)
const byName = (name) => checklists.find((c) => c.name === name)

test('toArea normalizes a geographic area', () => {
  assert.deepEqual(ga(fx.ga8837), {
    key: 'GA 8837', kind: 'GA', id: 8837, name: 'Cayenne', origin: 'gadm',
    type: 'Unknown', tdwg: null, iso2: null, level0: null, level1: null,
    parentId: 78, parentName: 'French Guiana'
  })
  assert.equal(ga(fx.ga77).iso2, 'FR')
  assert.equal(ga(fx.ga34200).tdwg, '82FRG-OO')
})

test('toArea normalizes a gazetteer', () => {
  const area = gz(fx.gz10453)
  assert.equal(area.key, 'GZ 10453')
  assert.equal(area.kind, 'GZ')
  assert.equal(area.iso2, 'US')
  assert.equal(area.level0, null)
  assert.equal(area.parentId, null)
})

test('normalizeName and containsName ignore accents, case and punctuation', () => {
  assert.equal(normalizeName('  São Tomé,  and Principe '), 'sao tome and principe')
  assert.equal(normalizeName('St. Kitts'), 'st kitts')
  assert.equal(containsName('REU-00 (Reunion aggregation)', 'Réunion'), true)
  assert.equal(containsName('Guinea-Bissau', 'Guinea'), true)
  assert.equal(containsName('Papua New Guinea', 'Guinea Bissau'), false)
  assert.equal(containsName('Mayotte2', 'Mayotte'), false)
})

test('merges synonymous country areas into one checklist', () => {
  const matches = checklists.filter((c) => c.name === 'Saint Kitts and Nevis')
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0].areaIds.sort((a, b) => a - b), [188, 31745])
  assert.equal(matches[0].id, 188)
  assert.equal(matches[0].iso2, 'KN')
  const vietnam = byName('Vietnam')
  assert.equal(vietnam.id, 243)
  assert.equal(vietnam.iso2, 'VN')
})

test('keeps a lone synonymous country under its checklist name', () => {
  const bosnia = byName('Bosnia and Herzegovina')
  assert.deepEqual(bosnia.areaIds, [31721])
  assert.equal(bosnia.id, 31721)
})

test('French Guiana is its own checklist with GA 32253, 78, 34200', () => {
  const guiana = byName('French Guiana')
  assert.equal(guiana.id, 32253)
  assert.equal(guiana.iso2, 'GF')
  assert.deepEqual(guiana.areaIds, [32253, 78, 34200])
  assert.equal(guiana.states, false)
  assert.match(guiana.ref, /^placement\.yml:\d+$/)
})

test('Northern Mariana Islands exists with iso2 MP', () => {
  const mp = byName('Northern Mariana Islands')
  assert.equal(mp.iso2, 'MP')
  assert.equal(mp.id, 'MP')
  assert.deepEqual(mp.areaIds, [])
})

test('United States has states, France has parts Corsica and Mainland France', () => {
  const states = checklists.filter((c) => c.states).map((c) => c.name).sort()
  assert.deepEqual(states, ['Australia', 'Russia', 'United Kingdom'])
  assert.equal(byName('France').states, false)
  assert.deepEqual(byName('France').parts, ['Corsica', 'Mainland France'])
  assert.equal(byName('Australia').parts, undefined)
})

test('states flag covers the six countries by name', () => {
  const six = ['United States', 'Canada', 'Australia', 'China', 'Russia', 'United Kingdom']
  const fake = six.map((name, i) => ga({ id: 900 + i, name, level0_id: 900 + i, iso_3166_a2: null }))
  const list = deriveChecklists(fake, { ...rules, checklists: [] })
  assert.deepEqual(list.map((c) => c.name), six)
  assert.deepEqual(list.map((c) => c.states), six.map(() => true))
})

test('no area id belongs to two checklists', () => {
  const guyane = ga({ ...fx.ga32253, id: 32253, level0_id: 32253 })
  const list = deriveChecklists([guyane, ...areas], rules)
  const owners = list.filter((c) => c.areaIds.includes(32253))
  assert.equal(owners.length, 1)
  assert.equal(owners[0].name, 'French Guiana')
})
