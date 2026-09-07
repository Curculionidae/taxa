import { test } from 'node:test'
import assert from 'node:assert/strict'
import { territoryStatus, leadGeoStatus } from './geoMatch.js'

const EFF = new Set(['DE', 'FR'])

test('territoryStatus: no filter -> in', () => {
  assert.equal(territoryStatus(new Set(['XX']), new Set()), 'in')
  assert.equal(territoryStatus(null, new Set()), 'in')
})

test('territoryStatus: empty / missing set -> unknown', () => {
  assert.equal(territoryStatus(null, EFF), 'unknown')
  assert.equal(territoryStatus(new Set(), EFF), 'unknown')
})

test('territoryStatus: intersects -> in, disjoint -> out', () => {
  assert.equal(territoryStatus(new Set(['DE', 'PL']), EFF), 'in')
  assert.equal(territoryStatus(new Set(['MG']), EFF), 'out')
})

test('leadGeoStatus: any reachable terminal in area -> in', () => {
  const terr = new Map([
    [1, new Set(['MG'])],
    [2, new Set(['DE'])]
  ])
  assert.equal(leadGeoStatus([1, 2], terr, EFF), 'in')
})

test('leadGeoStatus: all reachable resolved and disjoint -> out', () => {
  const terr = new Map([
    [1, new Set(['MG'])],
    [2, new Set(['US'])]
  ])
  assert.equal(leadGeoStatus([1, 2], terr, EFF), 'out')
})

test('leadGeoStatus: some reachable unknown, none in area -> unknown', () => {
  const terr = new Map([
    [1, new Set(['MG'])],
    [2, new Set()] // unknown
  ])
  assert.equal(leadGeoStatus([1, 2], terr, EFF), 'unknown')
})

test('leadGeoStatus: no reachable terminals -> unknown', () => {
  assert.equal(leadGeoStatus([], new Map(), EFF), 'unknown')
})

test('leadGeoStatus: no filter -> in', () => {
  assert.equal(leadGeoStatus([1], new Map(), new Set()), 'in')
})

test('leadGeoStatus: tolerates string vs number otu ids', () => {
  const terr = new Map([[1, new Set(['DE'])]])
  assert.equal(leadGeoStatus(['1'], terr, EFF), 'in')
})

test('territoryStatus: empty set + hasDataAnywhere=false -> unknown', () => {
  assert.equal(territoryStatus(new Set(), new Set(['DE']), false), 'unknown')
})

test('territoryStatus: empty set + hasDataAnywhere=true -> out', () => {
  assert.equal(territoryStatus(new Set(), new Set(['DE']), true), 'out')
})

test('territoryStatus: default hasDataAnywhere is false -> empty set stays unknown', () => {
  assert.equal(territoryStatus(new Set(), new Set(['DE'])), 'unknown')
})

test('territoryStatus: a selected-country hit still wins over hasDataAnywhere -> in', () => {
  assert.equal(territoryStatus(new Set(['DE']), new Set(['DE', 'FR']), false), 'in')
})

test('territoryStatus: non-empty disjoint set -> out regardless of hasDataAnywhere', () => {
  assert.equal(territoryStatus(new Set(['MG']), new Set(['DE', 'FR']), false), 'out')
})

test('leadGeoStatus: all reachable terminals lack data anywhere -> unknown', () => {
  const terr = new Map()
  const has = new Map([[1, false], [2, false]])
  assert.equal(leadGeoStatus([1, 2], terr, new Set(['DE']), has), 'unknown')
})

test('leadGeoStatus: a reachable terminal has data but not in area -> out', () => {
  const terr = new Map()
  const has = new Map([[1, true]])
  assert.equal(leadGeoStatus([1], terr, new Set(['DE']), has), 'out')
})

test('leadGeoStatus: a reachable terminal is in area -> in', () => {
  const terr = new Map([[1, new Set(['DE'])]])
  const has = new Map([[1, true]])
  assert.equal(leadGeoStatus([1], terr, new Set(['DE']), has), 'in')
})

test('leadGeoStatus: no hasDataByOtu map -> empty set is unknown (today behaviour)', () => {
  const terr = new Map([[1, new Set()]])
  assert.equal(leadGeoStatus([1], terr, new Set(['DE'])), 'unknown')
})
