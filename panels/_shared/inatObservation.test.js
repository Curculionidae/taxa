import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  INAT_OBSERVATION_IDENTIFIER,
  observationUrl,
  indexInatIdentifiers,
  formatRecordedBy,
  inatSourceLabel
} from './inatObservation.js'

const inatRow = (objectId, uuid, type = 'FieldOccurrence') => ({
  id: 9657582,
  identifier_object_id: objectId,
  identifier_object_type: type,
  identifier: uuid,
  type: INAT_OBSERVATION_IDENTIFIER,
  cached: uuid
})

const UUID = '974a95e8-d730-4480-ae39-b301cbad74d3'

test('observationUrl: builds the uuid observation URL (the uuid route resolves on iNaturalist)', () => {
  assert.equal(
    observationUrl(UUID),
    `https://www.inaturalist.org/observations/${UUID}`
  )
})

test('observationUrl: null for missing / blank input', () => {
  assert.equal(observationUrl(''), null)
  assert.equal(observationUrl(null), null)
  assert.equal(observationUrl(undefined), null)
  assert.equal(observationUrl('   '), null)
})

test('indexInatIdentifiers: keys by specimenKey() so CO and FO ids cannot collide', () => {
  const m = indexInatIdentifiers([
    inatRow(5022, UUID, 'FieldOccurrence'),
    inatRow(5022, 'c7918625-7a6b-49fa-aab7-624a5ceb03e3', 'CollectionObject')
  ])
  assert.deepEqual([...m.keys()], ['FieldOccurrence:5022', 'CollectionObject:5022'])
  assert.equal(m.get('FieldOccurrence:5022').uuid, UUID)
})

test('indexInatIdentifiers: entry carries the ready-to-use observation URL', () => {
  const m = indexInatIdentifiers([inatRow(5022, UUID)])
  assert.deepEqual(m.get('FieldOccurrence:5022'), {
    uuid: UUID,
    url: `https://www.inaturalist.org/observations/${UUID}`
  })
})

test('indexInatIdentifiers: non-iNaturalist identifier types are ignored', () => {
  // Every TaxonWorks record carries a DwcOccurrence GUID — including records
  // that never came from iNaturalist (verified: FO 5024-5027, all 500 sampled
  // CollectionObjects). Only the InaturalistObservation type means "imported".
  const m = indexInatIdentifiers([
    {
      identifier_object_id: 5024,
      identifier_object_type: 'FieldOccurrence',
      identifier: '12c64a5b-46f5-4a47-8a6f-cba0ab05601d',
      type: 'Identifier::Global::Uuid::TaxonworksDwcOccurrence'
    },
    {
      identifier_object_id: 1198803,
      identifier_object_type: 'Image',
      identifier: 'cbd50f42-8fc0-4bde-97da-8409e12fe046',
      type: 'Identifier::Global::Uuid::InaturalistObservationPhoto'
    }
  ])
  assert.equal(m.size, 0)
})

test('indexInatIdentifiers: empty / non-array input -> empty Map', () => {
  assert.equal(indexInatIdentifiers([]).size, 0)
  assert.equal(indexInatIdentifiers(undefined).size, 0)
  assert.equal(indexInatIdentifiers(null).size, 0)
})

test('indexInatIdentifiers: rows missing an id or a uuid are dropped', () => {
  const m = indexInatIdentifiers([
    inatRow(null, UUID),
    inatRow(5022, ''),
    { identifier_object_id: 5023, type: INAT_OBSERVATION_IDENTIFIER },
    inatRow(5029, 'c7918625-7a6b-49fa-aab7-624a5ceb03e3')
  ])
  assert.deepEqual([...m.keys()], ['FieldOccurrence:5029'])
})

test('indexInatIdentifiers: first row wins if a record somehow has two', () => {
  const m = indexInatIdentifiers([
    inatRow(5022, UUID),
    inatRow(5022, 'c7918625-7a6b-49fa-aab7-624a5ceb03e3')
  ])
  assert.equal(m.get('FieldOccurrence:5022').uuid, UUID)
})

test('formatRecordedBy: TaxonWorks joins multiple collectors with a pipe', () => {
  // e.g. FO 5025's recordedBy is "Jiří Krátký | P. Kresl"
  assert.equal(formatRecordedBy('Jiří Krátký | P. Kresl'), 'Jiří Krátký, P. Kresl')
  assert.equal(formatRecordedBy('A|B|C'), 'A, B, C')
})

test('formatRecordedBy: single collector passes through, trimmed', () => {
  assert.equal(formatRecordedBy('Jakob Jilg'), 'Jakob Jilg')
  assert.equal(formatRecordedBy('  Jakob Jilg  '), 'Jakob Jilg')
})

test('formatRecordedBy: empty for missing input or pipe-only noise', () => {
  assert.equal(formatRecordedBy(''), '')
  assert.equal(formatRecordedBy(null), '')
  assert.equal(formatRecordedBy(undefined), '')
  assert.equal(formatRecordedBy(' | '), '')
})

test('inatSourceLabel: names the observer when recordedBy is present', () => {
  assert.equal(inatSourceLabel('Jakob Jilg'), 'iNaturalist observation by Jakob Jilg')
  assert.equal(
    inatSourceLabel('Jiří Krátký | P. Kresl'),
    'iNaturalist observation by Jiří Krátký, P. Kresl'
  )
})

test('inatSourceLabel: drops the "by" clause when there is no observer', () => {
  assert.equal(inatSourceLabel(''), 'iNaturalist observation')
  assert.equal(inatSourceLabel(null), 'iNaturalist observation')
  assert.equal(inatSourceLabel(undefined), 'iNaturalist observation')
})
