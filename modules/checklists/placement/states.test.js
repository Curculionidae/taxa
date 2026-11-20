import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizePlace, buildSubdivisionIndex, resolveSubdivision, matchSubdivision, stateIndex } from './states.js'

const feature = (name, aliases) => ({ properties: { name, ...(aliases ? { aliases } : {}) } })
const WORDS = ['oblast', 'krai', 'republic', 'of']

test('normalizePlace removes accents, case, punctuation and spells out &', () => {
  assert.equal(normalizePlace("Tver' Oblast"), 'tver oblast')
  assert.equal(normalizePlace('Trinidad & Tobago'), 'trinidad and tobago')
  assert.equal(normalizePlace(null), '')
})

test('resolveSubdivision matches exact names, aliases and core names', () => {
  const index = buildSubdivisionIndex([feature('Krasnoyarsk'), feature('Sakha', ['Yakutia']), feature('Moskva')], WORDS)
  assert.equal(resolveSubdivision(index, 'Krasnoyarsk Krai'), 'Krasnoyarsk')
  assert.equal(resolveSubdivision(index, 'Republic of Sakha'), 'Sakha')
  assert.equal(resolveSubdivision(index, 'Yakutia'), 'Sakha')
  assert.equal(resolveSubdivision(index, '', 'Moskva'), 'Moskva')
  assert.equal(resolveSubdivision(index, 'Evenk'), '')
})

test('the ignored words come from the caller: without them only exact names and aliases match', () => {
  const index = buildSubdivisionIndex([feature('Krasnoyarsk')])
  assert.equal(resolveSubdivision(index, 'Krasnoyarsk'), 'Krasnoyarsk')
  assert.equal(resolveSubdivision(index, 'Krasnoyarsk Krai'), '')
})

test('matchSubdivision says how a state matched', () => {
  const index = buildSubdivisionIndex([feature('Pskov'), feature('Moscow', ['Moskva', 'Moscow']), feature('Sakha', ['Yakutia'])], WORDS)
  assert.deepEqual(matchSubdivision(index, 'Pskov'), { state: 'Pskov', candidate: 'Pskov', alias: null, ignored: [] })
  assert.deepEqual(matchSubdivision(index, 'Moskva'), { state: 'Moscow', candidate: 'Moskva', alias: 'Moskva', ignored: [] })
  assert.deepEqual(matchSubdivision(index, 'Moscow'), { state: 'Moscow', candidate: 'Moscow', alias: null, ignored: [] })
  assert.deepEqual(matchSubdivision(index, 'Pskov Oblast'), { state: 'Pskov', candidate: 'Pskov Oblast', alias: null, ignored: ['oblast'] })
  assert.deepEqual(matchSubdivision(index, 'Yakutia Republic'), { state: 'Sakha', candidate: 'Yakutia Republic', alias: 'Yakutia', ignored: ['republic'] })
  assert.equal(matchSubdivision(index, 'Evenk'), null)
})

test('a state\'s own name wins over another state\'s alias', () => {
  // Natural Earth lists "Moskovskaya" under both Moscow Oblast and Moscow.
  const index = buildSubdivisionIndex([feature('Moscow Oblast', ['Moskovskaya']), feature('Moscow', ['Moskovskaya', 'Moscow Oblast'])], WORDS)
  assert.equal(resolveSubdivision(index, 'Moscow Oblast'), 'Moscow Oblast')
  assert.equal(resolveSubdivision(index, 'Moskovskaya'), 'Moscow Oblast')
})

test('stateIndex builds the index from names only; aliases are left out (R51)', () => {
  const index = stateIndex([{ name: 'Georgia', aliases: [] }, { name: 'Hawaii', aliases: ["Hawai'i"] }], ['state', 'of'])
  assert.equal(resolveSubdivision(index, 'Georgia'), 'Georgia')
  assert.equal(resolveSubdivision(index, 'State of Hawaii'), 'Hawaii')
  assert.equal(resolveSubdivision(index, "Hawai'i"), '')
})

test('the real Natural Earth aliases: the engine index ignores them (R51), buildSubdivisionIndex still resolves them as the old page did', () => {
  const file = new URL('../../../public/checklists/subdivisions.geojson', import.meta.url)
  const features = JSON.parse(readFileSync(file, 'utf8')).features
  const of = (country) => features.filter((f) => f.properties.country === country)
    .map((f) => ({ name: f.properties.name, aliases: f.properties.aliases }))
  assert.equal(resolveSubdivision(stateIndex(of('Russia'), WORDS), 'Moskva'), '')
  const old = (list) => buildSubdivisionIndex(list.map((properties) => ({ properties })), WORDS)
  const china = old(of('China'))
  const russia = old(of('Russia'))
  assert.equal(resolveSubdivision(china, 'Xinjiang Uygur'), 'Xinjiang')
  // "Sakha" is the alias "Sakha Republic" with "republic" ignored.
  assert.deepEqual(matchSubdivision(russia, 'Sakha'), { state: 'Sakha (Yakutia)', candidate: 'Sakha', alias: 'Sakha Republic', ignored: ['republic'] })
  assert.equal(resolveSubdivision(russia, 'Moskva'), 'Moscow')
})
