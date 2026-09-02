import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRelation, relationLabel, RELATIONS } from './conceptRelation.js'

const A = 'latus|herbst|1783'
const B = 'mutabilis|host|1789'
const C = 'cardui|rossi|1790'
const D = 'subcostatus|brullé|1832'

test('congruent when the key sets are equal', () => {
  const r = deriveRelation([A, B], [A, B])
  assert.equal(r.kind, 'congruent')
  assert.equal(r.symbol, '≡')
  assert.equal(r.otuRelationship, 'Equal')
  assert.equal(r.confidence, 'clear')
  assert.deepEqual(r.reconciliation, { adds: [], drops: [] })
  assert.equal(r.sharedCount, 2)
})

test('included in when GBIF has extra keys', () => {
  const r = deriveRelation([A], [A, C])
  assert.equal(r.kind, 'included')
  assert.equal(r.symbol, '⊂')
  assert.equal(r.otuRelationship, 'ProperPart')
  assert.deepEqual(r.reconciliation, { adds: [C], drops: [] })
})

test('includes when TaxonWorks has extra keys', () => {
  const r = deriveRelation([A, D], [A])
  assert.equal(r.kind, 'includes')
  assert.equal(r.symbol, '⊃')
  assert.equal(r.otuRelationship, 'ProperPartInverse')
  assert.deepEqual(r.reconciliation, { adds: [], drops: [D] })
})

test('overlap when each side has extra keys', () => {
  const r = deriveRelation([A, D], [A, C])
  assert.equal(r.kind, 'overlap')
  assert.equal(r.symbol, '><')
  assert.equal(r.otuRelationship, 'PartiallyOverlapping')
  assert.equal(r.sharedCount, 1)
  assert.deepEqual(r.reconciliation, { adds: [C], drops: [D] })
})

test('no comparison when the sets do not intersect', () => {
  const r = deriveRelation([A], [C])
  assert.equal(r.kind, 'none')
  assert.equal(r.symbol, null)
  assert.equal(r.confidence, 'uncertain')
})

test('one unmatched TaxonWorks name downgrades a clear result to provisional', () => {
  const r = deriveRelation([A], [A, C], { unmatchedCount: 1 })
  assert.equal(r.kind, 'included')
  assert.equal(r.confidence, 'provisional')
})

test('ambiguous synonym status on G members does NOT downgrade confidence', () => {
  const r = deriveRelation([A, B], [A, B], { gHasAmbiguousOnly: true })
  assert.equal(r.confidence, 'clear')
})

test('reconstructed synonymy yields uncertain plus an alternative', () => {
  const r = deriveRelation([A, D], [A, C], { synonymyReconstructed: true })
  assert.equal(r.confidence, 'uncertain')
  assert.ok(r.alternative)
  assert.equal(r.alternative.kind, 'included')
})

test('relationLabel substitutes the names', () => {
  const r = deriveRelation([A, D], [A, C])
  const s = relationLabel(r, { twName: 'Larinus latus', colAcceptedName: 'Larinus latus' })
  assert.ok(s.includes('Larinus latus'))
  assert.ok(!s.includes(' - '))
  assert.ok(!/[—–]/.test(s))
})
