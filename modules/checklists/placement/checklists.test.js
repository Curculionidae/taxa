import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules } from './rules.js'
import { toArea, normalizeName, containsName, isCountryArea, isStateArea } from './areas.js'
import { deriveChecklists, checklistNames, findByName } from './checklists.js'
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
const checklists = deriveChecklists(areas, rules).checklists
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

test('Northern Mariana Islands exists with iso2 MP and its country area', () => {
  const mp = byName('Northern Mariana Islands')
  assert.equal(mp.iso2, 'MP')
  assert.equal(mp.id, 31750)
  assert.deepEqual(mp.areaIds, [31750])
  // An entry without GA areas is identified by its ISO code.
  assert.equal(byName('Kosovo').id, 'XK')
  assert.deepEqual(byName('Kosovo').areaIds, [])
})

test('states flag on Australia and Russia, not on the United Kingdom (R50); France has parts Corsica and Mainland France', () => {
  const states = checklists.filter((c) => c.states).map((c) => c.name).sort()
  assert.deepEqual(states, ['Australia', 'Russia'])
  assert.equal(byName('United Kingdom').states, false)
  assert.equal(byName('France').states, false)
  assert.deepEqual(byName('France').parts, ['Corsica', 'Mainland France'])
  assert.equal(byName('Australia').parts, undefined)
})

test('states flag covers the five countries by name', () => {
  const six = ['United States', 'Canada', 'Australia', 'China', 'Russia']
  const fake = six.map((name, i) => ga({ id: 900 + i, name, level0_id: 900 + i, iso_3166_a2: null }))
  const list = deriveChecklists(fake, { ...rules, checklists: [] }).checklists
  assert.deepEqual(list.map((c) => c.name), six)
  assert.deepEqual(list.map((c) => c.states), six.map(() => true))
})

test('the states flag comes from the rules file state_countries, accent and case insensitive', () => {
  const fake = ['Canada', 'Brazil', 'Russia'].map((name, i) => ga({ id: 950 + i, name, level0_id: 950 + i, iso_3166_a2: null }))
  const own = { ...rules, checklists: [], stateCountries: { names: ['brazil'], ref: 'placement.yml:1' } }
  assert.deepEqual(deriveChecklists(fake, own).checklists.map((c) => c.states), [false, true, false])
  const none = { ...rules, checklists: [], stateCountries: { names: [], ref: null } }
  assert.ok(deriveChecklists(fake, none).checklists.every((c) => !c.states))
})

test('no area id belongs to two checklists', () => {
  const guyane = ga({ ...fx.ga32253, id: 32253, level0_id: 32253 })
  const list = deriveChecklists([guyane, ...areas], rules).checklists
  const owners = list.filter((c) => c.areaIds.includes(32253))
  assert.equal(owners.length, 1)
  assert.equal(owners[0].name, 'French Guiana')
})

test('own checklists keep the ids of today\'s country files', () => {
  const ids = Object.fromEntries(checklists.map((c) => [c.name, c.id]))
  assert.equal(ids.Guadeloupe, 90)
  assert.equal(ids.Martinique, 32213)
  assert.equal(ids['Réunion'], 33048)
  assert.equal(ids.Mayotte, 34156)
  assert.equal(ids['French Guiana'], 32253)
  assert.deepEqual(byName('Guadeloupe').areaIds, [90, 32432, 34212])
})

const spain = ga({ id: 9001, name: 'Madrid', level0_id: 210, level1_id: 9001, parent_id: 210, parent: { name: 'Spain' } })

test('a country used only through a subdivision becomes a checklist', () => {
  const { checklists: list, warnings } = deriveChecklists([spain], rules, new Map([[210, 'Spain']]))
  assert.deepEqual(warnings, [])
  assert.deepEqual(list.filter((c) => c.name === 'Spain').map((c) => [c.id, c.areaIds]), [[210, [210]]])
})

test('a level0 id without a name is skipped with a warning', () => {
  const { checklists: list, warnings } = deriveChecklists([spain], rules)
  assert.equal(list.find((c) => c.name === 'Spain'), undefined)
  assert.deepEqual(warnings, ['level0 210 has no name (areas: 9001)'])
})

test('a stub country merges by synonyms with a country area', () => {
  const taaf = ga({ id: 80, name: 'TAAF', level0_id: 80, iso_3166_a2: 'TF', parent_id: 1, parent: { name: 'Earth' } })
  const sub = ga({ id: 9002, name: 'Kerguelen', level0_id: 81, parent_id: 81, parent: { name: 'French Southern Territories' } })
  const { checklists: list } = deriveChecklists([taaf, sub], rules, new Map([[81, 'French Southern Territories']]))
  const merged = list.filter((c) => c.name === 'French Southern Territories')
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 80)
  assert.deepEqual(merged[0].areaIds.sort((a, b) => a - b), [80, 81])
})

test('a country-level area under another country joins that country', () => {
  const england = ga({ id: 26372, name: 'England', level0_id: 26372, parent_id: 236, parent: { name: 'United Kingdom' } })
  const { checklists: list } = deriveChecklists([fx.ga236, england].map((s) => (s.kind ? s : ga(s))), rules)
  assert.equal(list.find((c) => c.name === 'England'), undefined)
  assert.deepEqual(list.find((c) => c.name === 'United Kingdom').areaIds, [236, 26372])
})

test('Turks and Caicos areas merge; without or with several ISO codes the lowest id wins', () => {
  const a = ga({ id: 231, name: 'Turks and Caicos Islands', level0_id: 231, parent_id: 1, parent: { name: 'Earth' } })
  const b = ga({ id: 31800, name: 'Turks and Caicos Is.', level0_id: 31800, parent_id: 1, parent: { name: 'Earth' } })
  const merged = deriveChecklists([b, a], rules).checklists.filter((c) => c.name === 'Turks and Caicos Islands')
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 231)
  const both = deriveChecklists([{ ...b, iso2: 'TC' }, { ...a, iso2: 'TC' }], rules).checklists
  assert.equal(both.find((c) => c.name === 'Turks and Caicos Islands').id, 231)
})

test('United States of America (GA 33412, type Country, level0 empty) merges with GA 237 into United States (R17)', () => {
  const list = deriveChecklists([fx.ga237, fx.ga33412, fx.ga33455].map(ga), rules).checklists
  const us = list.filter((c) => /united states/i.test(c.name))
  assert.equal(us.length, 1)
  assert.equal(us[0].name, 'United States')
  assert.equal(us[0].id, 237)
  assert.deepEqual(us[0].areaIds.sort((a, b) => a - b), [237, 33412])
})

test('isCountryArea follows TaxonWorks GeographicArea#categorize (R17)', () => {
  assert.equal(isCountryArea(ga(fx.ga237)), true) // id equals level0
  assert.equal(isCountryArea(ga(fx.ga33412)), true) // type Country, level0 empty
  assert.equal(isCountryArea(ga({ ...fx.ga33455, geographic_area_type: { name: 'Governorate' } })), true)
  // parent Earth and not TDWG, whatever the type
  assert.equal(isCountryArea(ga({ ...fx.ga8837, parent_id: 1, parent: { name: 'Earth' } })), true)
  assert.equal(isCountryArea(ga({ ...fx.ga33639, parent_id: 1, parent: { name: 'Earth' } })), false) // TDWG
  assert.equal(isCountryArea(ga(fx.ga33455)), false) // a state
  assert.equal(isCountryArea(ga(fx.ga33639)), false)
  assert.equal(isCountryArea(gz(fx.gz3529)), false)
})

test('GA 33412 is a country area itself, not a stub: its own name, no level0Names needed (R17)', () => {
  const countriesOf = (list) => list.filter((c) => !c.ref).map((c) => [c.name, c.areaIds])
  const result = deriveChecklists([fx.ga33455, fx.ga33412].map(ga), rules, new Map([[33412, 'USA']]))
  assert.deepEqual(countriesOf(result.checklists), [['United States', [33412]]])
  assert.deepEqual(result.warnings, [])
})

test('a checklist without ISO code takes it from isoByName, also through a synonym (R18)', () => {
  const iso = new Map([[normalizeName('Solomon Islands'), 'SB'], [normalizeName('France'), 'XX']])
  const list = deriveChecklists([fx.ga31761, fx.ga77].map(ga), rules, new Map(), iso).checklists
  assert.equal(list.find((c) => c.name === 'Solomon Islands').iso2, 'SB')
  // An ISO code from TaxonWorks is kept.
  assert.equal(list.find((c) => c.name === 'France').iso2, 'FR')
  const viaSynonym = deriveChecklists([fx.ga31761].map(ga), rules, new Map(), new Map([['solomon is', 'SB']])).checklists
  assert.equal(viaSynonym[0].iso2, 'SB')
})

test('isStateArea follows TaxonWorks GeographicArea#categorize (R30)', () => {
  assert.equal(isStateArea(ga(fx.ga33455)), true) // type State
  assert.equal(isStateArea(ga({ ...fx.ga33455, geographic_area_type: { name: 'Province' } })), true)
  assert.equal(isStateArea(ga(fx.ga32253)), true) // Natural Earth state, parent is its level0
  assert.equal(isStateArea(ga({ ...fx.ga30398, id: 26386 })), true) // id equals level1
  // A gadm state: type Unknown, no level ids; a state only when its parent is a country.
  assert.equal(isStateArea(ga(fx.ga26370)), false)
  assert.equal(isStateArea(ga(fx.ga26370), true), true)
  // Counties are not states, whatever their name.
  assert.equal(isStateArea(ga(fx.ga30398)), false)
  assert.equal(isStateArea(ga(fx.ga29533)), false)
  // Countries, TDWG areas and gazetteers never are.
  assert.equal(isStateArea(ga(fx.ga237)), false)
  assert.equal(isStateArea(ga(fx.ga33412)), false)
  assert.equal(isStateArea(ga(fx.ga33696)), false)
  assert.equal(isStateArea(gz(fx.gz3529), true), false)
})

test('checklistNames gives the checklist name and every synonym of it', () => {
  const synonyms = compileRules(`synonyms:
  - [Saint Barthélemy, Saint BarthÉlemy, St. Barth]
  - [Tanzania, United Republic of Tanzania]
`)
  assert.deepEqual(checklistNames('Saint Barthélemy', synonyms), ['Saint Barthélemy', 'Saint BarthÉlemy', 'St. Barth'])
  assert.deepEqual(checklistNames('Spain', synonyms), ['Spain'])
})

test('findByName finds an outline by the checklist name or a synonym, accent and case insensitive', () => {
  const synonyms = compileRules(`synonyms:
  - [Saint Barthélemy, St. Barth]
`)
  const fallback = new Map([['saint barthelemy', 'A'], ['st barth', 'B'], ['spain', 'C']])
  assert.equal(findByName(fallback, 'Saint Barthélemy', synonyms), 'A')
  const onlySynonym = new Map([['st barth', 'B']])
  assert.equal(findByName(onlySynonym, 'Saint Barthélemy', synonyms), 'B')
  assert.equal(findByName(fallback, 'Spain', synonyms), 'C')
  assert.equal(findByName(fallback, 'France', synonyms), undefined)
})
