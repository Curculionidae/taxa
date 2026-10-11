import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  wktToGeometry,
  specimensNotOnMap,
  specimenGeometry,
  buildTypeSpecimenFeatures
} from './typeSpecimenFeatures.js'

const feature = (base, shape) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { base, target: base.map(() => ({ id: 1, type: 'Otu' })), shape }
})
const specimen = (co, ...tms) => ({
  collectionObjectId: co,
  typeMaterials: tms.map((id) => ({ id, label: `holotype of N${id}` }))
})
const target = { id: 1, type: 'Otu', label: '' }

test('wktToGeometry: point with Z', () => {
  assert.deepEqual(wktToGeometry('POINT Z (-0.985336 37.614843 0)'), {
    type: 'Point',
    coordinates: [-0.985336, 37.614843]
  })
})

test('wktToGeometry: polygon with a hole, no Z', () => {
  assert.deepEqual(
    wktToGeometry('POLYGON ((0 0, 4 0, 4 4, 0 0), (1 1, 2 1, 2 2, 1 1))'),
    {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 0]],
        [[1, 1], [2, 1], [2, 2], [1, 1]]
      ]
    }
  )
})

test('wktToGeometry: multipolygon with Z', () => {
  const g = wktToGeometry('MULTIPOLYGON Z (((0 0 0, 1 0 0, 1 1 0, 0 0 0)), ((5 5 0, 6 5 0, 6 6 0, 5 5 0)))')
  assert.equal(g.type, 'MultiPolygon')
  assert.equal(g.coordinates.length, 2)
  assert.deepEqual(g.coordinates[1][0][1], [6, 5])
})

test('wktToGeometry: empty, unsupported or malformed -> null', () => {
  assert.equal(wktToGeometry(null), null)
  assert.equal(wktToGeometry(''), null)
  assert.equal(wktToGeometry('LINESTRING (0 0, 1 1)'), null)
  assert.equal(wktToGeometry('POINT (abc)'), null)
  assert.equal(wktToGeometry('POLYGON ((0 0, 1 1))'), null)
})

test('specimensNotOnMap: drops specimens present as a CollectionObject or through their TypeMaterial', () => {
  const features = [
    feature([{ type: 'CollectionObject', id: 501 }], { type: 'Georeference', id: 1 }),
    feature([{ type: 'TypeMaterial', id: 902 }], { type: 'GeographicArea', id: 2 })
  ]
  const missing = specimensNotOnMap(features, [specimen(501, 901), specimen(502, 902), specimen(503, 903)])
  assert.deepEqual(missing.map((s) => s.collectionObjectId), [503])
})

test('specimenGeometry: the footprint wins, coordinates are the fallback', () => {
  const coords = { decimalLatitude: '26.6', decimalLongitude: '-81.8' }
  assert.deepEqual(specimenGeometry({ ...coords, footprintWKT: 'POINT Z (1 2 0)' }), {
    type: 'Point',
    coordinates: [1, 2]
  })
  assert.deepEqual(specimenGeometry({ ...coords, footprintWKT: 'LINESTRING (0 0, 1 1)' }), {
    type: 'Point',
    coordinates: [-81.8, 26.6]
  })
  assert.deepEqual(specimenGeometry(coords), { type: 'Point', coordinates: [-81.8, 26.6] })
})

test('specimenGeometry: no footprint and no coordinates -> null', () => {
  assert.equal(specimenGeometry({ country: 'United States', stateProvince: 'Indiana' }), null)
  assert.equal(specimenGeometry({ decimalLatitude: null, decimalLongitude: null }), null)
  assert.equal(specimenGeometry({ decimalLatitude: 'x', decimalLongitude: '1' }), null)
  assert.equal(specimenGeometry(null), null)
})

test('buildTypeSpecimenFeatures: one feature per place, specimens at the same place share it', () => {
  const here = { type: 'Point', coordinates: [1, 2] }
  const features = buildTypeSpecimenFeatures(
    [
      { collectionObjectId: 503, geometry: here },
      { collectionObjectId: 504, geometry: { type: 'Point', coordinates: [1, 2] } },
      { collectionObjectId: 505, geometry: { type: 'Point', coordinates: [9, 9] } }
    ],
    target
  )
  assert.equal(features.length, 2)
  assert.deepEqual(features[0].properties.base.map((b) => b.id), [503, 504])
  assert.deepEqual(features[0].properties.target, [target, target])
  assert.deepEqual(features[0].properties.base[0], {
    type: 'CollectionObject',
    id: 503,
    label: 'CollectionObject 503',
    undetermined: true
  })
  assert.deepEqual(features[1].properties.base.map((b) => b.id), [505])
})

test('buildTypeSpecimenFeatures: a specimen without a geometry is left out', () => {
  assert.deepEqual(buildTypeSpecimenFeatures([{ collectionObjectId: 503, geometry: null }], target), [])
  assert.deepEqual(buildTypeSpecimenFeatures(undefined, target), [])
})
