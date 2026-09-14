import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupRecords } from './groupRecords.js'

const co = (id, fields = {}) => ({
  id,
  dwc_occurrence_object_type: 'CollectionObject',
  dwc_occurrence_object_id: id,
  country: 'Ukraine',
  verbatimLocality: 'Vinnytsia',
  eventDate: '2020-06-01',
  recordedBy: 'X',
  ...fields
})
const fo = (id, fields = {}) => ({ ...co(id, fields), dwc_occurrence_object_type: 'FieldOccurrence' })
const sizes = (records) => groupRecords(records).map((g) => g.records.length).sort()

test('specimens with different collecting events stay separate even when DwC text matches', () => {
  assert.deepEqual(sizes([co(1, { collectingEventId: 10 }), co(2, { collectingEventId: 11 })]), [1, 1])
})

test('specimens sharing a collecting event collapse even when a DwC field differs', () => {
  assert.deepEqual(sizes([co(1, { collectingEventId: 10 }), co(2, { collectingEventId: 10, habitat: 'marsh' })]), [2])
})

test('a shared collecting event with no event fields still collapses', () => {
  const blank = { country: null, verbatimLocality: null, eventDate: null, recordedBy: null }
  assert.deepEqual(sizes([co(1, { ...blank, collectingEventId: 10 }), co(2, { ...blank, collectingEventId: 10 })]), [2])
})

test('institutionCode still splits a shared collecting event', () => {
  assert.deepEqual(
    sizes([co(1, { collectingEventId: 10, institutionCode: 'A' }), co(2, { collectingEventId: 10, institutionCode: 'B' })]),
    [1, 1]
  )
})

test('fallback splits on fields the row text shows (coordinates, locality)', () => {
  assert.deepEqual(sizes([fo(1, { verbatimCoordinates: 'N44.73 E34.33' }), fo(2, { verbatimCoordinates: 'N44.75 E34.31' })]), [1, 1])
  assert.deepEqual(sizes([fo(1, { locality: 'A' }), fo(2, { locality: 'B' })]), [1, 1])
})

test('fallback splits on event fields not shown in the row (habitat)', () => {
  assert.deepEqual(sizes([fo(1, { habitat: 'meadow' }), fo(2, { habitat: 'marsh' })]), [1, 1])
})

test('fallback collapses identical events and ignores number vs string', () => {
  assert.deepEqual(sizes([fo(1, { year: 2020 }), fo(2, { year: '2020' })]), [2])
})

test('specimen without a collecting event id uses the fallback', () => {
  assert.deepEqual(sizes([co(1), co(2)]), [2])
  assert.deepEqual(sizes([co(1), co(2, { habitat: 'marsh' })]), [1, 1])
})

test('records with no event data stay singletons', () => {
  const blank = { country: null, verbatimLocality: null, eventDate: null, recordedBy: null, institutionCode: 'A' }
  assert.deepEqual(sizes([fo(1, blank), fo(2, blank)]), [1, 1])
})
