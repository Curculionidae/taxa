import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatEventDate } from './eventDate.js'

test('formatEventDate: eventDate wins when present', () => {
  assert.equal(formatEventDate({ eventDate: '1990-06-12', day: 12, month: 6, year: 1990 }), '1990-06-12')
})

test('formatEventDate: falls back to day.month.year when year is present', () => {
  assert.equal(formatEventDate({ day: 12, month: 6, year: 1990 }), '12.6.1990')
})

test('formatEventDate: year only', () => {
  assert.equal(formatEventDate({ year: 1990 }), '1990')
})

test('formatEventDate: day/month present without year still shows a partial date', () => {
  assert.equal(formatEventDate({ day: 12, month: 6 }), '12.6')
})

test('formatEventDate: nothing at all -> null', () => {
  assert.equal(formatEventDate({}), null)
  assert.equal(formatEventDate(), null)
})
