import { test } from 'node:test'
import assert from 'node:assert/strict'

import { needsDescendantAd, needsSpecimenPass, fieldForRank } from './geoScope.js'

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

test('needsSpecimenPass: genus runs only when not huge, same gate as subgenus', () => {
  // A named genus terminal is normally pre-routed to the flat pass and never
  // reaches this function (excluded via flatFieldOtuIds in
  // useKeyGeography.js), but an edge case that does reach it (empty/missing
  // name) must not trigger an unconditional full inventory call for a giant
  // genus — the size gate has to apply here too.
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 50 }), true)
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 2000 }), true)
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 2001 }), false)
  assert.equal(needsSpecimenPass({ rank: 'genus', hasName: true, adTotal: 999999 }), false)
})

test('needsSpecimenPass: subgenus runs only when not huge (no flat column for it)', () => {
  assert.equal(needsSpecimenPass({ rank: 'subgenus', hasName: true, adTotal: 50 }), true)
  assert.equal(needsSpecimenPass({ rank: 'subgenus', hasName: true, adTotal: 2000 }), true)
  assert.equal(needsSpecimenPass({ rank: 'subgenus', hasName: true, adTotal: 2001 }), false)
  assert.equal(needsSpecimenPass({ rank: 'subgenus', hasName: true, adTotal: 9000 }), false)
})

test('needsSpecimenPass: threshold is overridable (subgenus)', () => {
  assert.equal(needsSpecimenPass({ rank: 'subgenus', hasName: true, adTotal: 500 }, 100), false)
  assert.equal(needsSpecimenPass({ rank: 'subgenus', hasName: true, adTotal: 80 }, 100), true)
})

test('needsSpecimenPass: unknown rank with a name is not over-filtered', () => {
  assert.equal(needsSpecimenPass({ rank: 'weird', hasName: true, adTotal: 0 }), true)
})

test('fieldForRank: maps ranks with a well-populated dwc_occurrences column', () => {
  assert.equal(fieldForRank('family'), 'family')
  assert.equal(fieldForRank('subfamily'), 'subfamily')
  assert.equal(fieldForRank('tribe'), 'tribe')
  assert.equal(fieldForRank('genus'), 'genus')
  assert.equal(fieldForRank('NomenclaturalRank::Iczn::FamilyGroup::Family'), 'family')
})

test('fieldForRank: null when there is no reliable flat column', () => {
  // subgenus is 0% populated in dwc_occurrences on this project (verified live,
  // 2026-09-05) even though the column exists, must not be mapped.
  assert.equal(fieldForRank('subgenus'), null)
  assert.equal(fieldForRank('species'), null)
  assert.equal(fieldForRank('subtribe'), null)
  assert.equal(fieldForRank(undefined), null)
  assert.equal(fieldForRank('weird'), null)
})
