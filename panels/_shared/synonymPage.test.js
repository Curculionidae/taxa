import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isSynonymPage } from './synonymPage.js'

test('isSynonymPage: only a name TaxonWorks marks invalid', () => {
  assert.equal(isSynonymPage({ is_valid: false }), true)
  assert.equal(isSynonymPage({ is_valid: true }), false)
})

test('isSynonymPage: an OTU without a taxon name (no is_valid) counts as valid', () => {
  assert.equal(isSynonymPage({}), false)
  assert.equal(isSynonymPage(undefined), false)
})
