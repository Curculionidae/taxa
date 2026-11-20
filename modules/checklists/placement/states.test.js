import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePlace, buildSubdivisionIndex, resolveSubdivision, stateIndex } from './states.js'

const feature = (name, aliases) => ({ properties: { name, ...(aliases ? { aliases } : {}) } })

test('normalizePlace removes accents, case, punctuation and spells out &', () => {
  assert.equal(normalizePlace("Tver' Oblast"), 'tver oblast')
  assert.equal(normalizePlace('Trinidad & Tobago'), 'trinidad and tobago')
  assert.equal(normalizePlace(null), '')
})

test('resolveSubdivision matches exact names, aliases and core names', () => {
  const index = buildSubdivisionIndex([feature('Krasnoyarsk'), feature('Sakha', ['Yakutia']), feature('Moskva')])
  assert.equal(resolveSubdivision(index, 'Krasnoyarsk Krai'), 'Krasnoyarsk')
  assert.equal(resolveSubdivision(index, 'Republic of Sakha'), 'Sakha')
  assert.equal(resolveSubdivision(index, 'Yakutia'), 'Sakha')
  assert.equal(resolveSubdivision(index, '', 'Moskva'), 'Moskva')
  assert.equal(resolveSubdivision(index, 'Evenk'), '')
})

test('stateIndex builds the same index from plain names', () => {
  const index = stateIndex(['Georgia', 'Hawaii'])
  assert.equal(resolveSubdivision(index, 'Georgia'), 'Georgia')
  assert.equal(resolveSubdivision(index, 'State of Hawaii'), 'Hawaii')
})
