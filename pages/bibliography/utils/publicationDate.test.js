import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  publicationSortTime,
  sortByPublication,
  formatPublicationDate
} from './publicationDate.js'

const source = (id, year, month, day, created_at) => ({
  id,
  year,
  month,
  day,
  created_at
})

const ids = (sources) => sortByPublication(sources).map(({ id }) => id)

describe('publicationSortTime', () => {
  it('uses the full date when year, month and day are known', () => {
    assert.equal(
      publicationSortTime(source(1, 2026, 'mar', 20, '2026-10-01T08:00:00Z')),
      Date.UTC(2026, 2, 20)
    )
  })

  it('reads numeric months too', () => {
    assert.equal(
      publicationSortTime(source(1, 2026, '3', 20, '2026-10-01T08:00:00Z')),
      Date.UTC(2026, 2, 20)
    )
  })

  it('places a year-only source by date added when added in that year', () => {
    assert.equal(
      publicationSortTime(source(1, 2026, null, null, '2026-10-09T08:00:00Z')),
      Date.parse('2026-10-09T08:00:00Z')
    )
  })

  it('places a year-only source added in another year at the end of its year', () => {
    assert.equal(
      publicationSortTime(source(1, 2025, null, null, '2026-02-01T08:00:00Z')),
      Date.UTC(2026, 0, 1) - 1
    )
  })

  it('places a month-only source by date added when added in that month', () => {
    assert.equal(
      publicationSortTime(source(1, 2026, 'feb', null, '2026-02-10T08:00:00Z')),
      Date.parse('2026-02-10T08:00:00Z')
    )
  })

  it('places a month-only source added later at the end of its month', () => {
    assert.equal(
      publicationSortTime(source(1, 2026, 'feb', null, '2026-07-10T08:00:00Z')),
      Date.UTC(2026, 2, 1) - 1
    )
  })

  it('ignores a day without a month', () => {
    assert.equal(
      publicationSortTime(source(1, 2026, null, 5, '2026-10-09T08:00:00Z')),
      Date.parse('2026-10-09T08:00:00Z')
    )
  })
})

describe('sortByPublication', () => {
  it('interleaves undated sources with dated ones, newest first', () => {
    assert.deepEqual(
      ids([
        source(1, 2026, 'mar', 20, '2026-03-21T08:00:00Z'),
        source(2, 2026, null, null, '2026-10-09T08:00:00Z'),
        source(3, 2026, 'oct', 1, '2026-10-06T08:00:00Z'),
        source(4, 2026, null, null, '2026-01-16T08:00:00Z'),
        source(5, 2025, 'dec', 30, '2026-01-02T08:00:00Z')
      ]),
      [2, 3, 1, 4, 5]
    )
  })

  it('breaks ties by date added, then id', () => {
    assert.deepEqual(
      ids([
        source(1, 2025, null, null, '2026-02-01T08:00:00Z'),
        source(2, 2025, null, null, '2026-05-01T08:00:00Z'),
        source(3, 2025, null, null, '2026-05-01T08:00:00Z')
      ]),
      [3, 2, 1]
    )
  })

  it('does not change the list it is given', () => {
    const sources = [
      source(1, 2025, null, null, '2025-02-01T08:00:00Z'),
      source(2, 2026, null, null, '2026-02-01T08:00:00Z')
    ]

    sortByPublication(sources)
    assert.deepEqual(
      sources.map(({ id }) => id),
      [1, 2]
    )
  })
})

describe('formatPublicationDate', () => {
  it('shows only what is known', () => {
    assert.equal(
      formatPublicationDate(source(1, 2026, 'mar', 20)),
      'March 20, 2026'
    )
    assert.equal(
      formatPublicationDate(source(1, 2026, 'feb', null)),
      'February 2026'
    )
    assert.equal(formatPublicationDate(source(1, 2026, null, null)), '2026')
    assert.equal(formatPublicationDate(source(1, null, null, null)), '')
  })
})
