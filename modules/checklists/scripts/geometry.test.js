import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileRules } from '../placement/rules.js'
import { createNodeGeometry, measureShares, listShapes } from './geometry-node.mjs'

// A rectangle as polygons (one polygon, outer ring only, closed).
const box = (west, south, east, north) => [[[
  [west, south], [east, south], [east, north], [west, north], [west, south]
]]]
const near = (actual, expected, tolerance = 2) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected} ±${tolerance}`)

const squareA = { name: 'A', polygons: box(0, 0, 1, 1) }
const squareB = { name: 'B', polygons: box(1, 0, 2, 1) }

test('measureShares: an area inside square A is all A', () => {
  const result = measureShares(box(0.2, 0.2, 0.8, 0.8), [squareA, squareB])
  assert.deepEqual(result.shares, [['A', 100]])
  assert.equal(result.outside, 0)
  assert.ok(result.points >= 30)
})

test('measureShares: an area straddling A and B splits 70/30', () => {
  const result = measureShares(box(0.3, 0, 1.3, 1), [squareA, squareB])
  assert.deepEqual(result.shares.map(([name]) => name), ['A', 'B'])
  near(result.shares[0][1], 70)
  near(result.shares[1][1], 30)
  assert.equal(result.outside, 0)
})

test('measureShares: points over the sea count as outside, shares are over land only', () => {
  const result = measureShares(box(0.5, 0, 1.5, 1), [squareA])
  assert.ok(result.outside > 0)
  near(result.outside / result.points * 100, 50)
  assert.deepEqual(result.shares, [['A', 100]])
})

test('measureShares: an area outside every target has no shares', () => {
  const result = measureShares(box(5, 5, 6, 6), [squareA, squareB])
  assert.deepEqual(result.shares, [])
  assert.equal(result.outside, result.points)
})

test('measureShares: holes are not part of the area', () => {
  // Area: square A with the left 70% cut out as a hole, plus nothing else;
  // what is left lies at x 0.7..1 in A. Ring of the hole inside the outer ring.
  const area = [[
    [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
    [[0.01, 0.01], [0.7, 0.01], [0.7, 0.99], [0.01, 0.99], [0.01, 0.01]]
  ]]
  const result = measureShares(area, [squareA, squareB])
  assert.deepEqual(result.shares, [['A', 100]])
})

test('measureShares: a sample in an own checklist and in its `of` country counts for the own one only (R22)', () => {
  const france = { name: 'France', polygons: box(0, 0, 10, 10) }
  const reunion = { name: 'Réunion', of: 'France', polygons: box(2, 2, 4, 4) }
  const inside = measureShares(box(2.5, 2.5, 3.5, 3.5), [france, reunion])
  assert.deepEqual(inside.shares, [['Réunion', 100]])
  const half = measureShares(box(3, 2, 5, 4), [france, reunion])
  assert.deepEqual(half.shares.map(([name]) => name), ['France', 'Réunion'])
  near(half.shares[0][1], 50)
  near(half.shares[1][1], 50)
})

test('measureShares: a thin area with no grid point inside is sampled at its vertices', () => {
  // A degenerate outline (all vertices on one line): no grid point is inside.
  const sliver = [[[[0.1, 0.5], [0.9, 0.5], [0.5, 0.5], [0.1, 0.5]]]]
  const result = measureShares(sliver, [squareA, squareB])
  assert.ok(result.points > 0)
  assert.deepEqual(result.shares, [['A', 100]])
})

test('measureShares: vertices just off a simplified coast count for the coast within 0.05 degrees', () => {
  const sliver = [[[[1.02, 0.5], [1.03, 0.5], [1.025, 0.5], [1.02, 0.5]]]]
  const result = measureShares(sliver, [squareA])
  assert.deepEqual(result.shares, [['A', 100]])
})

// A tiny shape cache on disk for the Node geometry.
function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'geometry-test-'))
  const shapeDir = join(dir, 'map-shapes')
  mkdirSync(join(shapeDir, 'GeographicArea'), { recursive: true })
  mkdirSync(join(shapeDir, 'Gazetteer'), { recursive: true })
  const write = (file, value) => writeFileSync(file, JSON.stringify(value))
  const polygon = (polygons) => ({ type: 'Polygon', coordinates: polygons[0] })
  const multi = (...list) => ({ type: 'MultiPolygon', coordinates: list.flatMap((polygons) => polygons) })
  // France: mainland 0..10 plus an overseas island 20..22 that is also Réunion's outline.
  write(join(shapeDir, 'GeographicArea', '1.json'), multi(box(0, 0, 10, 10), box(20, 0, 22, 2)))
  write(join(shapeDir, 'GeographicArea', '2.json'), polygon(box(20, 0, 22, 2)))      // Réunion
  write(join(shapeDir, 'GeographicArea', '3.json'), polygon(box(8, 0, 10, 2)))       // Corsica (part)
  write(join(shapeDir, 'GeographicArea', '4.json'), polygon(box(30, 0, 40, 10)))     // Russia
  write(join(shapeDir, 'Gazetteer', '9.json'), polygon(box(31, 1, 32, 2)))
  const fallbackFile = join(dir, 'fallback.geojson')
  write(fallbackFile, { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'Spain' }, geometry: polygon(box(-10, 0, 0, 10)) }
  ] })
  const subdivisionsFile = join(dir, 'subdivisions.geojson')
  write(subdivisionsFile, { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'Moscow', country: 'Russia' }, geometry: polygon(box(30, 0, 35, 10)) },
    { type: 'Feature', properties: { name: 'Tver', country: 'Russia' }, geometry: polygon(box(35, 0, 40, 10)) }
  ] })
  return { dir, shapeDir, fallbackFile, subdivisionsFile }
}

const rules = compileRules(`
checklists:
  - name: Réunion
    iso2: RE
    of: France
    areas: [GA 2]
parts:
  France:
    - name: Corsica
      areas: [GA 3]
    - name: Mainland France
      rest: true
      box: [0, 2, 8, 10]
`)
const checklists = [
  { id: 1, name: 'France', iso2: 'FR', areaIds: [1], parts: ['Corsica', 'Mainland France'], states: false },
  { id: 4, name: 'Russia', iso2: 'RU', areaIds: [4], states: true },
  { id: 50, name: 'Spain', iso2: 'ES', areaIds: [50], states: false },
  { id: 2, name: 'Réunion', iso2: 'RE', areaIds: [2], states: false }
]

test('Node geometry: checklistsAt finds the checklist outline, own checklist over its `of` country (R22)', async (t) => {
  const fx = fixtureDir()
  t.after(() => rmSync(fx.dir, { recursive: true, force: true }))
  const geometry = createNodeGeometry({ ...fx, checklists, rules })
  assert.deepEqual(await geometry.checklistsAt([5, 5]), [1])
  assert.deepEqual(await geometry.checklistsAt([21, 1]), [2])
  assert.deepEqual(await geometry.checklistsAt([-5, 5]), [50], 'Spain from the fallback outline')
  assert.deepEqual(await geometry.checklistsAt([50, 50]), [])
  assert.deepEqual(await geometry.checklistsAt([10.03, 5]), [1], 'a coastal point within 0.05 degrees')
  assert.deepEqual(await geometry.checklistsAt([10.2, 5]), [])
})

test('Node geometry: stateAt, stateNames and partAt', async (t) => {
  const fx = fixtureDir()
  t.after(() => rmSync(fx.dir, { recursive: true, force: true }))
  const geometry = createNodeGeometry({ ...fx, checklists, rules })
  assert.deepEqual(geometry.stateNames(4), ['Moscow', 'Tver'])
  assert.deepEqual(geometry.stateNames(1), [])
  assert.equal(await geometry.stateAt(4, [31, 5]), 'Moscow')
  assert.equal(await geometry.stateAt(4, [38, 5]), 'Tver')
  assert.equal(await geometry.stateAt(4, [60, 5]), null)
  assert.equal(await geometry.stateAt(1, [5, 5]), null)
  assert.equal(await geometry.partAt(1, [9, 1]), 'Corsica', 'from the part outline')
  assert.equal(await geometry.partAt(1, [5, 5]), 'Mainland France', 'from the part box')
  assert.equal(await geometry.partAt(1, [5, 1]), null)
  assert.equal(await geometry.partAt(4, [31, 5]), null)
})

test('Node geometry: measuring targets and area outlines', async (t) => {
  const fx = fixtureDir()
  t.after(() => rmSync(fx.dir, { recursive: true, force: true }))
  const geometry = createNodeGeometry({ ...fx, checklists, rules })
  const targets = geometry.checklistTargets()
  assert.deepEqual(targets.map((target) => [target.name, target.of ?? null]),
    [['France', null], ['Russia', null], ['Spain', null], ['Réunion', 'France']])
  const area = geometry.areaPolygons('GZ', 9)
  assert.deepEqual(measureShares(area, targets).shares, [['Russia', 100]])
  assert.deepEqual(measureShares(area, geometry.stateTargets(4)).shares, [['Moscow', 100]])
  assert.equal(geometry.areaPolygons('GA', 777), null)
  assert.deepEqual([...listShapes(fx.shapeDir)].sort(),
    ['Gazetteer/9', 'GeographicArea/1', 'GeographicArea/2', 'GeographicArea/3', 'GeographicArea/4'])
})
