import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fieldForRank } from './geoScope.js'

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
