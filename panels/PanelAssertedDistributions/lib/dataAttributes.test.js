import { test } from 'node:test'
import assert from 'node:assert/strict'

import { withPredicates, attributesBySubject } from './dataAttributes.js'

const attr = (id, subjectId, predicate, value = 'v') => ({
  id,
  attribute_subject_id: subjectId,
  predicate_name: predicate,
  value
})

test('withPredicates: keeps only the listed predicates, ignoring case', () => {
  const list = [attr(1, 70, 'Reassessment'), attr(2, 70, 'Microhabitat'), attr(3, 71, 'Activity pattern')]
  assert.deepEqual(withPredicates(list, ['reassessment']).map((a) => a.id), [1])
  assert.deepEqual(withPredicates(list, ['Reassessment', 'microhabitat']).map((a) => a.id), [1, 2])
})

test('withPredicates: an import predicate counts when there is no predicate name', () => {
  const imported = { id: 4, attribute_subject_id: 70, import_predicate: 'Reassessment', value: 'x' }
  assert.deepEqual(withPredicates([imported], ['Reassessment']).map((a) => a.id), [4])
})

test('attributesBySubject: entries per subject id with their citation', () => {
  const cit = { id: 9, display: 'Winkelmann & Sprick, 2026' }
  const out = attributesBySubject([attr(1, 70, 'Reassessment', 'Misidentified'), attr(2, 71, 'Note')], new Map([[1, cit]]))
  assert.deepEqual(out.get(70), [{ id: 1, predicate: 'Reassessment', value: 'Misidentified', citation: cit }])
  assert.deepEqual(out.get(71), [{ id: 2, predicate: 'Note', value: 'v', citation: null }])
})
