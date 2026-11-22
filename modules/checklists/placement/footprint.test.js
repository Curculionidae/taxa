import { test } from 'node:test'
import assert from 'node:assert/strict'
import { footprintPoint, footprintPolygons, parseWkt } from './footprint.js'
import { contains, prepared, polygonsOf } from './geometry.js'

// CO 2707818 "Sanju", drawn in TaxonWorks with the shape tool (shortened).
const SANJU = 'POLYGON Z ((78.18 36.79 0,78.27 36.65 0,78.30 36.55 0,78.20 36.50 0,78.12 36.60 0,78.18 36.79 0))'

test('parseWkt: POLYGON Z and MULTIPOLYGON to GeoJSON, z dropped', () => {
  assert.deepEqual(parseWkt('POLYGON ((0 0, 2 0, 2 2, 0 0))'), { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] })
  assert.deepEqual(parseWkt('POLYGON Z ((0 0 5,2 0 5,2 2 5,0 0 5))').coordinates[0][1], [2, 0])
  const multi = parseWkt('MULTIPOLYGON (((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5)))')
  assert.equal(multi.type, 'MultiPolygon')
  assert.equal(multi.coordinates.length, 2)
  assert.equal(parseWkt('POINT (1 2)'), null)
  assert.equal(parseWkt(''), null)
  assert.equal(parseWkt(null), null)
})

test('footprintPoint: a point inside the drawn shape, rounded to 4 decimals', () => {
  const point = footprintPoint(SANJU)
  const shape = prepared(polygonsOf(parseWkt(SANJU)))
  assert.ok(contains(shape, [point.lng, point.lat]), JSON.stringify(point))
  assert.equal(point.lat, Math.round(point.lat * 1e4) / 1e4)
})

test('footprintPoint: a concave shape whose centre lies outside still gives a point inside', () => {
  // A "C": the centre of the box is in the gap.
  const c = 'POLYGON ((0 0,10 0,10 2,2 2,2 8,10 8,10 10,0 10,0 0))'
  const point = footprintPoint(c)
  assert.ok(contains(prepared(polygonsOf(parseWkt(c))), [point.lng, point.lat]), JSON.stringify(point))
})

test('footprintPoint: of a MULTIPOLYGON, a point in its largest polygon', () => {
  const point = footprintPoint('MULTIPOLYGON (((0 0,1 0,1 1,0 1,0 0)),((10 10,20 10,20 20,10 20,10 10)))')
  assert.ok(point.lng > 10 && point.lat > 10, JSON.stringify(point))
})

test('footprintPoint: nothing usable gives null', () => {
  assert.equal(footprintPoint(''), null)
  assert.equal(footprintPoint('POINT (1 2)'), null)
  assert.equal(footprintPoint('POLYGON (('), null)
  assert.equal(footprintPoint('POLYGON ((179 0,-179 0,-179 1,179 1,179 0))'), null)
})

test('footprintPolygons: every polygon of the shape, null for none', () => {
  assert.deepEqual(footprintPolygons('MULTIPOLYGON (((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5)))').length, 2)
  assert.deepEqual(footprintPolygons('POLYGON Z ((0 0 1,1 0 1,1 1 1,0 0 1))'), [[[[0, 0], [1, 0], [1, 1], [0, 0]]]])
  assert.equal(footprintPolygons('POINT (1 2)'), null)
  assert.equal(footprintPolygons(''), null)
})
