import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupRecords } from './groupRecords.js'

const co = (id, fields = {}) => ({
  id,
  dwc_occurrence_object_type: 'CollectionObject',
  dwc_occurrence_object_id: id,
  scientificName: 'Lixus cardui',
  country: 'Ukraine',
  verbatimLocality: 'Vinnytsia',
  eventDate: '2020-06-01',
  recordedBy: 'X',
  ...fields
})
const fo = (id, fields = {}) => ({ ...co(id, fields), dwc_occurrence_object_type: 'FieldOccurrence' })
const sizes = (records) => groupRecords(records).map((g) => g.records.length).sort()

test('records differing only in habitat or samplingProtocol collapse', () => {
  assert.deepEqual(sizes([co(1, { habitat: 'meadow' }), co(2, { habitat: 'marsh', samplingProtocol: 'sweeping' })]), [2])
  assert.deepEqual(sizes([fo(1, { samplingProtocol: 'light trap' }), fo(2)]), [2])
})

test('fields the row text shows split groups (coordinates, locality)', () => {
  assert.deepEqual(sizes([fo(1, { verbatimCoordinates: 'N44.73 E34.33' }), fo(2, { verbatimCoordinates: 'N44.75 E34.31' })]), [1, 1])
  assert.deepEqual(sizes([fo(1, { locality: 'A' }), fo(2, { locality: 'B' })]), [1, 1])
})

test('event fields not shown in the row still split groups (elevation, fieldNumber)', () => {
  assert.deepEqual(sizes([co(1, { minimumElevationInMeters: 100 }), co(2, { minimumElevationInMeters: 900 })]), [1, 1])
  assert.deepEqual(sizes([co(1, { fieldNumber: 'A1' }), co(2)]), [1, 1])
})

test('institutionCode and scientificName split groups', () => {
  assert.deepEqual(sizes([co(1, { institutionCode: 'A' }), co(2, { institutionCode: 'B' })]), [1, 1])
  assert.deepEqual(sizes([co(1), co(2, { scientificName: 'Lixus cardui cardui' })]), [1, 1])
})

test('identical events collapse, number vs string is ignored', () => {
  assert.deepEqual(sizes([fo(1, { year: 2020 }), fo(2, { year: '2020' })]), [2])
})

test('records with no event data stay singletons, even with a habitat', () => {
  const blank = { country: null, verbatimLocality: null, eventDate: null, recordedBy: null, institutionCode: 'A' }
  assert.deepEqual(sizes([fo(1, blank), fo(2, blank)]), [1, 1])
  assert.deepEqual(sizes([fo(1, { ...blank, habitat: 'marsh' }), fo(2, { ...blank, habitat: 'marsh' })]), [1, 1])
})
