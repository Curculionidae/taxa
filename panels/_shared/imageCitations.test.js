import { test } from 'node:test'
import assert from 'node:assert/strict'

import { groupCitationsByImage, imageIdFromOriginalPng } from './imageCitations.js'

const row = (id, citId) => ({
  id: citId,
  citation_object_type: 'Image',
  citation_object_id: id,
  citation_source_body: `cit ${citId}`
})

test('groupCitationsByImage: empty / non-array input -> empty Map', () => {
  assert.equal(groupCitationsByImage([]).size, 0)
  assert.equal(groupCitationsByImage(undefined).size, 0)
  assert.equal(groupCitationsByImage(null).size, 0)
})

test('groupCitationsByImage: several citations on one image collapse into one entry, order kept', () => {
  const m = groupCitationsByImage([row(100, 1), row(100, 2), row(100, 3)])
  assert.deepEqual([...m.keys()], [100])
  assert.deepEqual(m.get(100).map((c) => c.id), [1, 2, 3])
})

test('groupCitationsByImage: distinct image ids get distinct entries', () => {
  const m = groupCitationsByImage([row(100, 1), row(200, 2), row(100, 3)])
  assert.deepEqual(m.get(100).map((c) => c.id), [1, 3])
  assert.deepEqual(m.get(200).map((c) => c.id), [2])
})

test('groupCitationsByImage: string citation_object_id is coerced to a number key', () => {
  const m = groupCitationsByImage([row('847941', 1)])
  assert.ok(m.has(847941))
  assert.equal(m.get(847941).length, 1)
})

test('groupCitationsByImage: rows without a usable citation_object_id are dropped', () => {
  const m = groupCitationsByImage([
    { id: 1, citation_object_id: 0 },
    { id: 2, citation_object_id: null },
    { id: 3 },
    row(100, 4)
  ])
  assert.deepEqual([...m.keys()], [100])
  assert.equal(m.get(100)[0].id, 4)
})

test('imageIdFromOriginalPng: pulls the numeric id from an inventory / lead-figure path', () => {
  assert.equal(
    imageIdFromOriginalPng('/api/v1/images/847941/scale_to_box/0/0/588/780/588/780'),
    847941
  )
  assert.equal(
    imageIdFromOriginalPng('/api/v1/images/1199100/scale_to_box/0/0/706/584/706/584'),
    1199100
  )
})

test('imageIdFromOriginalPng: null for missing / external / malformed input', () => {
  assert.equal(imageIdFromOriginalPng(''), null)
  assert.equal(imageIdFromOriginalPng(null), null)
  assert.equal(imageIdFromOriginalPng(undefined), null)
  assert.equal(imageIdFromOriginalPng('https://www.inaturalist.org/photos/12345'), null)
  assert.equal(imageIdFromOriginalPng('/api/v1/images/abc/scale_to_box'), null)
})
