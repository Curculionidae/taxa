import { test } from 'node:test'
import assert from 'node:assert/strict'
import { typeLabelStyle } from './typeStatus.js'

const paper = (cell) => typeLabelStyle(cell).backgroundColor

test('typeLabelStyle: name-bearing types get the red label', () => {
  assert.equal(paper('holotype of Aus bus Author, 1900'), 'var(--pp-type-label)')
  assert.equal(paper('lectotype of Aus bus Author, 1900'), 'var(--pp-type-label)')
})

test('typeLabelStyle: paratype and paralectotype get the yellow label', () => {
  assert.equal(paper('paratype of Aus bus Author, 1900'), 'var(--pp-type-label-other)')
  assert.equal(paper('paralectotype of Aus bus Author, 1900'), 'var(--pp-type-label-other)')
})

test('typeLabelStyle: a name-bearing type wins in a mixed cell', () => {
  assert.equal(paper('paratype of Aus bus | holotype of Aus cus'), 'var(--pp-type-label)')
})

test('typeLabelStyle: black print on both', () => {
  assert.equal(typeLabelStyle('paratype').color, 'var(--pp-type-label-ink)')
  assert.equal(typeLabelStyle('holotype').color, 'var(--pp-type-label-ink)')
})
