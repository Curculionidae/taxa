import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCompletenessReport } from './completeness.js'

// A genus with five species. A, B, C are keyed out; D and E are not.
const DESCENDANTS = [
  { id: 1, parentId: null, rank: 'genus', name: 'Gen', valid: true },
  { id: 10, parentId: 1, rank: 'species', name: 'A', valid: true },
  { id: 20, parentId: 1, rank: 'species', name: 'B', valid: true },
  { id: 30, parentId: 1, rank: 'species', name: 'C', valid: true },
  { id: 40, parentId: 1, rank: 'species', name: 'D', valid: true },
  { id: 50, parentId: 1, rank: 'species', name: 'E', valid: true }
]
const BASE = {
  scopeRank: 'genus',
  descendants: DESCENDANTS,
  terminalTnIds: [10, 20, 30]
}

test('no geoScope: report is unchanged, no geographic block', () => {
  const r = buildCompletenessReport(BASE)
  assert.equal(r.expectedCount, 5)
  assert.equal(r.coveredCount, 3)
  assert.deepEqual(r.missing, ['D', 'E'])
  assert.equal(r.geographic, undefined)
})

test('empty effectiveKeys: no geographic block', () => {
  const r = buildCompletenessReport({
    ...BASE,
    geoScope: {
      effectiveKeys: new Set(),
      territoriesByTaxonId: new Map(),
      label: 'Europe'
    }
  })
  assert.equal(r.geographic, undefined)
})

test('geoScope present: second measure scoped to the selected territories', () => {
  const r = buildCompletenessReport({
    ...BASE,
    geoScope: {
      label: 'Europe',
      effectiveKeys: new Set(['DE', 'FR', 'PL', 'russia-european']),
      territoriesByTaxonId: new Map([
        [10, new Set(['DE'])], // A: in area, keyed
        [20, new Set(['FR', 'russia-european'])], // B: in area, keyed
        [30, new Set(['west-siberia'])], // C: keyed, but OUT of area
        [40, new Set(['PL'])] // D: in area, NOT keyed
        // E (50): no distribution data -> unknown
      ])
    }
  })

  // taxonomic measure untouched
  assert.equal(r.expectedCount, 5)
  assert.equal(r.coveredCount, 3)

  assert.ok(r.geographic, 'geographic block present')
  assert.equal(r.geographic.label, 'Europe')
  assert.equal(r.geographic.expectedCount, 3) // A, B, D (C out of area, E unknown)
  assert.equal(r.geographic.keyedCount, 2) // A, B
  assert.deepEqual(r.geographic.missing, ['D'])
  assert.deepEqual(r.geographic.unknownExpected, ['E'])
  assert.deepEqual(r.geographic.outOfAreaTerminals, ['C'])
  assert.equal(r.geographic.isComplete, false)
})

test('geoScope: no expected taxon in the area (or data still loading) is not "complete"', () => {
  const r = buildCompletenessReport({
    ...BASE,
    geoScope: {
      label: 'Europe',
      effectiveKeys: new Set(['DE']),
      territoriesByTaxonId: new Map() // nothing resolved yet
    }
  })
  assert.equal(r.geographic.expectedCount, 0)
  assert.equal(r.geographic.isComplete, false)
  assert.equal(r.geographic.unknownExpected.length, 5)
})

test('geoScope: every in-area expected taxon keyed -> geographic.isComplete', () => {
  const r = buildCompletenessReport({
    ...BASE,
    geoScope: {
      label: 'Europe',
      effectiveKeys: new Set(['DE']),
      territoriesByTaxonId: new Map([
        [10, new Set(['DE'])],
        [20, new Set(['DE'])],
        [30, new Set(['DE'])],
        [40, new Set(['west-siberia'])], // D: out of area, so not expected
        [50, new Set(['west-siberia'])] // E: out of area
      ])
    }
  })
  assert.equal(r.geographic.expectedCount, 3)
  assert.equal(r.geographic.keyedCount, 3)
  assert.deepEqual(r.geographic.missing, [])
  assert.deepEqual(r.geographic.unknownExpected, [])
  assert.deepEqual(r.geographic.outOfAreaTerminals, [])
  assert.equal(r.geographic.isComplete, true)
})
