import { test } from 'node:test'
import assert from 'node:assert/strict'

import { needsDescendantAd, needsSpecimenPass } from './geoScope.js'

test('needsDescendantAd: true above species, false at/below, false for unknown', () => {
  assert.equal(needsDescendantAd('family'), true)
  assert.equal(needsDescendantAd('genus'), true)
  assert.equal(needsDescendantAd('subgenus'), true)
  assert.equal(needsDescendantAd('species'), false)
  assert.equal(needsDescendantAd('subspecies'), false)
  assert.equal(needsDescendantAd(undefined), false)
  assert.equal(needsDescendantAd('NomenclaturalRank::Iczn::GenusGroup::Genus'), true)
})

test('needsSpecimenPass: species and subspecies terminals always run', () => {
  assert.equal(needsSpecimenPass({ rank: 'species', hasName: true }), true)
  assert.equal(needsSpecimenPass({ rank: 'subspecies', hasName: true }), true)
})

test('needsSpecimenPass: a name-less OTU always runs (cheap informal grouping)', () => {
  assert.equal(needsSpecimenPass({ rank: undefined, hasName: false }), true)
})

test('needsSpecimenPass: family / tribe / superfamily never run (AD-only)', () => {
  assert.equal(needsSpecimenPass({ rank: 'superfamily', hasName: true, adTotal: 10 }), false)
  assert.equal(needsSpecimenPass({ rank: 'family', hasName: true, adTotal: 48391 }), false)
  assert.equal(needsSpecimenPass({ rank: 'subfamily', hasName: true, adTotal: 1115 }), false)
  assert.equal(needsSpecimenPass({ rank: 'tribe', hasName: true, adTotal: 5 }), false)
})

test('needsSpecimenPass: genus / subgenus run only when not huge', () => {
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 50 }), true)
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 2000 }), true)
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 2001 }), false)
  assert.equal(needsSpecimenPass({ rank: 'subgenus', hasName: true, adTotal: 9000 }), false)
})

test('needsSpecimenPass: threshold is overridable', () => {
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 500 }, 100), false)
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 80 }, 100), true)
})

test('needsSpecimenPass: unknown rank with a name is not over-filtered', () => {
  assert.equal(needsSpecimenPass({ rank: 'weird', hasName: true, adTotal: 0 }), true)
})
