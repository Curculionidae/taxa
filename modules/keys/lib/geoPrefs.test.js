import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveKeys, parseStored } from './geoPrefs.js'

const GROUPINGS = [
  { id: 'europe', label: 'Europe', members: ['AT', 'DE', 'PL', 'russia-european'] }
]

test('effectiveKeys: explicit territories only', () => {
  const set = effectiveKeys({ groupings: [], territories: ['DE', 'PL'] }, GROUPINGS)
  assert.deepEqual([...set].sort(), ['DE', 'PL'])
})

test('effectiveKeys: a grouping expands to its full member list', () => {
  const set = effectiveKeys({ groupings: ['europe'], territories: [] }, GROUPINGS)
  assert.deepEqual([...set].sort(), ['AT', 'DE', 'PL', 'russia-european'])
})

test('effectiveKeys: grouping members and explicit territories union, deduped', () => {
  const set = effectiveKeys(
    { groupings: ['europe'], territories: ['DE', 'FR'] },
    GROUPINGS
  )
  assert.deepEqual([...set].sort(), ['AT', 'DE', 'FR', 'PL', 'russia-european'])
})

test('effectiveKeys: unknown grouping id is ignored', () => {
  const set = effectiveKeys(
    { groupings: ['atlantis'], territories: ['DE'] },
    GROUPINGS
  )
  assert.deepEqual([...set], ['DE'])
})

test('effectiveKeys: empty selection -> empty set', () => {
  assert.equal(effectiveKeys({ groupings: [], territories: [] }, GROUPINGS).size, 0)
  assert.equal(effectiveKeys(null, GROUPINGS).size, 0)
})

test('parseStored: valid JSON round-trips to arrays', () => {
  assert.deepEqual(
    parseStored('{"groupings":["europe"],"territories":["DE"]}'),
    { groupings: ['europe'], territories: ['DE'] }
  )
})

test('parseStored: malformed / missing -> empty selection', () => {
  assert.deepEqual(parseStored('not json'), { groupings: [], territories: [] })
  assert.deepEqual(parseStored(null), { groupings: [], territories: [] })
  assert.deepEqual(parseStored('{"groupings":"x"}'), {
    groupings: [],
    territories: []
  })
})
