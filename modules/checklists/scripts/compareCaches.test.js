import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  oldCountryKey, oldStateIndexes, oldState, recordKey, pairEntries, classifyPair, oldToNewNames,
  changedInTaxonWorks, groupBy, cacheEntries
} from './compareCaches.mjs'
import { decidingStep } from './cacheFiles.mjs'

const feature = (country, name, aliases) => ({ properties: { country, name, ...(aliases ? { aliases } : {}) } })
const FEATURES = [
  feature('Russia', 'Tver\''),
  feature('Russia', 'Krasnoyarsk', ['Krasnoyarsk Krai']),
  feature('United States', 'Georgia'),
  feature('United States', 'Hawaii'),
  feature('Mexico', 'Sonora') // not a state country of the old page
]
const indexes = oldStateIndexes(FEATURES)

test('oldCountryKey: the old page aliases of the state countries', () => {
  assert.equal(oldCountryKey(' United  States of America '), 'united states')
  assert.equal(oldCountryKey('Russian Federation'), 'russia')
  assert.equal(oldCountryKey('Georgia'), 'georgia')
})

test('oldStateIndexes: only the six state countries', () => {
  assert.deepEqual([...indexes.keys()].sort(), ['russia', 'united states'])
})

test('oldState: stateProvince first, then the distribution place, then county', () => {
  const ad = (fields) => ({ dwc_occurrence_object_type: 'AssertedDistribution', ...fields })
  const co = (fields) => ({ dwc_occurrence_object_type: 'CollectionObject', ...fields })
  assert.equal(oldState(co({ stateProvince: 'Krasnoyarsk Krai' }), 'Russia', indexes), 'Krasnoyarsk')
  assert.equal(oldState(ad({ place: 'Tver Oblast' }), 'Russia', indexes), 'Tver\'')
  assert.equal(oldState(ad({ stateProvince: 'Hawaii', place: 'Georgia' }), 'United States', indexes), 'Hawaii')
  assert.equal(oldState(co({ county: 'Georgia' }), 'United States of America', indexes), 'Georgia')
})

test('oldState: no state for a specimen place, other countries, or a country with parts', () => {
  // The old page kept `place` only for asserted distributions.
  assert.equal(oldState({ dwc_occurrence_object_type: 'CollectionObject', place: 'Hawaii' }, 'United States', indexes), '')
  // The US state Georgia is never found for the country Georgia.
  assert.equal(oldState({ dwc_occurrence_object_type: 'CollectionObject', stateProvince: 'Georgia' }, 'Georgia', indexes), '')
  assert.equal(oldState({ dwc_occurrence_object_type: 'CollectionObject', stateProvince: 'Sonora' }, 'Mexico', indexes), '')
  assert.equal(oldState({ dwc_occurrence_object_type: 'CollectionObject', stateProvince: 'Hawaii' }, 'United States', indexes, true), '')
})

test('recordKey: type and id', () => {
  assert.equal(recordKey({ dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: '5' }), 'CollectionObject:5')
})

test('pairEntries: by OTU first, then in order, leftovers alone', () => {
  const a = { otu: '1', tag: 'old a' }
  const b = { otu: '2', tag: 'old b' }
  const c = { otu: '3', tag: 'old c' }
  const x = { otu: '2', tag: 'new x' }
  const y = { otu: '9', tag: 'new y' }
  assert.deepEqual(pairEntries([a, b, c], [y, x]), [[b, x], [a, y], [c, null]])
  assert.deepEqual(pairEntries([], [x]), [[null, x]])
  assert.deepEqual(pairEntries([a], []), [[a, null]])
})

test('classifyPair: same, moved, newly placed, no longer placed, part and state', () => {
  const entry = (checklist, part, state) => ({ checklist, part, state })
  assert.deepEqual(classifyPair(entry('Spain'), entry('Spain')), { status: 'same', partChanged: false, stateChanged: false })
  assert.deepEqual(classifyPair(entry('Spain'), entry('Andorra')), { status: 'moved', partChanged: false, stateChanged: false })
  assert.equal(classifyPair(null, entry('Spain')).status, 'newly placed')
  assert.equal(classifyPair(entry('Spain'), null).status, 'no longer placed')
  assert.deepEqual(classifyPair(entry('France', 'Corsica'), entry('France', 'Mainland France')),
    { status: 'same', partChanged: true, stateChanged: false })
  assert.deepEqual(classifyPair(entry('Russia', undefined, ''), entry('Russia', null, 'Tver\'')),
    { status: 'same', partChanged: false, stateChanged: true })
  assert.deepEqual(classifyPair(entry('Russia', undefined, ''), entry('Russia', null, null)),
    { status: 'same', partChanged: false, stateChanged: false })
  assert.throws(() => classifyPair(null, null))
})

test('oldToNewNames: same id, then a shared area, then the name', () => {
  const news = [
    { id: 77, name: 'France', areaIds: [77] },
    { id: 186, name: 'Saint Barthélemy', areaIds: [186, 31880] },
    { id: 5, name: 'Algeria', areaIds: [5] },
    { id: 900, name: 'Czechia', areaIds: [900] }
  ]
  const olds = [
    { id: 77, name: 'France', areas: [77] },
    { id: 31880, name: 'Saint Barthelemy', areas: [31880] },
    { id: 999, name: 'CZECHIA', areas: [999] },
    { id: 1234, name: 'Gone', areas: [1234] }
  ]
  assert.deepEqual([...oldToNewNames(olds, news)], [
    ['France', 'France'], ['Saint Barthelemy', 'Saint Barthélemy'], ['CZECHIA', 'Czechia'], ['Gone', null]
  ])
})

test('changedInTaxonWorks: created or updated after the old download', () => {
  const cutoff = new Date('2026-11-17T23:00:00Z')
  assert.deepEqual(changedInTaxonWorks({ created: '2026-11-19 10:00:00 UTC', updated: ['2026-11-19 10:00:00 UTC'] }, cutoff),
    { created: true, updated: true, date: '2026-11-19' })
  assert.deepEqual(changedInTaxonWorks({ created: '2025-01-01T00:00:00.000Z', updated: ['2026-11-18T09:00:00.000Z', ''] }, cutoff),
    { created: false, updated: true, date: '2026-11-18' })
  assert.deepEqual(changedInTaxonWorks({ created: '2025-01-01 00:00:00 UTC', updated: [] }, cutoff),
    { created: false, updated: false, date: '2025-01-01' })
})

test('groupBy: largest group first', () => {
  assert.deepEqual(groupBy(['b', 'a', 'b', 'c', 'a', 'b'], (item) => item), [['b', ['b', 'b', 'b']], ['a', ['a', 'a']], ['c', ['c']]])
})

test('decidingStep: the step about the checklist, not the state', () => {
  const placement = {
    steps: [
      { text: 'Central European Russia (TDWG 14RUC) lies in Russia', source: 'overlap' },
      { text: 'no state: spans several states', source: 'overlap' }
    ]
  }
  assert.equal(decidingStep(placement).text, 'Central European Russia (TDWG 14RUC) lies in Russia')
})

test('cacheEntries: an old-format cache (files <id>.json, no state) gets the old page state', () => {
  const index = { countries: [{ id: 237, name: 'United States' }] }
  const files = { '237.json': [{ dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: 5, otu_id: 1, stateProvince: 'Texas' }] }
  const asked = []
  const entries = cacheEntries(index, (file) => { asked.push(file); return files[file] }, {
    checklistOf: (name) => `${name}!`,
    oldStateOf: (record) => record.stateProvince
  })
  assert.deepEqual(asked, ['237.json'])
  assert.deepEqual(entries.map(({ key, checklist, oldName, state, part }) => ({ key, checklist, oldName, state, part })),
    [{ key: 'CollectionObject:5', checklist: 'United States!', oldName: 'United States', state: 'Texas', part: '' }])
})

test('cacheEntries: an engine cache (file, stored state) uses record.state, also when it has none', () => {
  const index = { countries: [{ name: 'United States', file: 'united-states.json' }, { name: 'United Kingdom', file: 'united-kingdom.json' }] }
  const files = {
    'united-states.json': [{ dwc_occurrence_object_type: 'AssertedDistribution', dwc_occurrence_object_id: 7, otu_id: 2, state: 'Hawaii' }],
    'united-kingdom.json': [{ dwc_occurrence_object_type: 'AssertedDistribution', dwc_occurrence_object_id: 8, otu_id: 2, stateProvince: 'Cornwall' }]
  }
  const entries = cacheEntries(index, (file) => files[file], { oldStateOf: () => 'never asked' })
  assert.deepEqual(entries.map(({ key, checklist, state }) => [key, checklist, state]),
    [['AssertedDistribution:7', 'United States', 'Hawaii'], ['AssertedDistribution:8', 'United Kingdom', '']])
})
