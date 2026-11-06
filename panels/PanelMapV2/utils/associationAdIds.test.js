import { test } from 'node:test'
import assert from 'node:assert/strict'

import { associationAdIds } from './associationAdIds.js'

test('associationAdIds: AD ids per biological association, plain ADs left out', () => {
  const ads = [
    { id: 1, asserted_distribution_object_type: 'BiologicalAssociation', asserted_distribution_object_id: 70 },
    { id: 2, asserted_distribution_object_type: 'Otu', asserted_distribution_object_id: 5 },
    { id: 3, asserted_distribution_object_type: 'BiologicalAssociation', asserted_distribution_object_id: 70 },
    { id: 4, asserted_distribution_object_type: 'BiologicalAssociation', asserted_distribution_object_id: 71 }
  ]
  assert.deepEqual(associationAdIds(ads), new Map([[70, [1, 3]], [71, [4]]]))
})

test('associationAdIds: nothing for an empty or missing list', () => {
  assert.deepEqual(associationAdIds([]), new Map())
  assert.deepEqual(associationAdIds(null), new Map())
})
