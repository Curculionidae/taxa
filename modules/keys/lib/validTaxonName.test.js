import { test } from 'node:test'
import assert from 'node:assert/strict'

import { effectiveTaxonNameId } from './validTaxonName.js'

test('effectiveTaxonNameId: valid name returns its own id', () => {
  assert.equal(effectiveTaxonNameId({ id: 5, cached_is_valid: true }), 5)
})

test('effectiveTaxonNameId: missing validity flag returns its own id', () => {
  assert.equal(effectiveTaxonNameId({ id: 5 }), 5)
})

test('effectiveTaxonNameId: synonym redirects to the valid id', () => {
  assert.equal(
    effectiveTaxonNameId({ id: 5, cached_is_valid: false, cached_valid_taxon_name_id: 9 }),
    9
  )
})

test('effectiveTaxonNameId: invalid but no valid target falls back to own id', () => {
  assert.equal(effectiveTaxonNameId({ id: 5, cached_is_valid: false }), 5)
})

test('effectiveTaxonNameId: null/undefined row returns null', () => {
  assert.equal(effectiveTaxonNameId(null), null)
  assert.equal(effectiveTaxonNameId(undefined), null)
})
