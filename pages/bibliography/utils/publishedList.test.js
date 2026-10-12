import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPublishedList } from './publishedList.js'

// One source per year from 1990 to 2020, added in its own year.
const SOURCES = Array.from({ length: 31 }, (_, i) => ({
  id: i + 1,
  year: 1990 + i,
  month: null,
  day: null,
  author: i % 2 ? 'Smith' : 'Jones',
  created_at: `${1990 + i}-06-01T00:00:00Z`
}))

function makeRequest() {
  const calls = []

  return {
    calls,
    get(url, { params }) {
      calls.push(params)

      const all = SOURCES.filter(
        (s) =>
          s.year >= params.year_start &&
          s.year <= params.year_end &&
          (!params.author || s.author === params.author)
      )
      const start = (params.page - 1) * params.per

      return Promise.resolve({
        data: all.slice(start, start + params.per),
        headers: { 'pagination-total': String(all.length) },
        request: { responseURL: 'https://example.org/sources' }
      })
    }
  }
}

const FILTERS = { year_start: 1990, year_end: 2020 }
const years = (rows) => rows.map(({ year }) => year)

describe('createPublishedList', () => {
  it('returns the newest page without loading every year', async () => {
    const request = makeRequest()
    const list = createPublishedList(request)

    const { rows, total } = await list.getPage(FILTERS, 1, 5)

    assert.equal(total, 31)
    assert.deepEqual(years(rows), [2020, 2019, 2018, 2017, 2016])
    // The first call only counts the matches, the others load years.
    assert.ok(
      Math.min(
        ...request.calls.filter((p) => p.per > 1).map((p) => p.year_start)
      ) > 1990
    )
  })

  it('goes further back for a later page and keeps what it has', async () => {
    const request = makeRequest()
    const list = createPublishedList(request)

    await list.getPage(FILTERS, 1, 5)

    const before = request.calls.length
    const { rows } = await list.getPage(FILTERS, 2, 5)

    assert.deepEqual(years(rows), [2015, 2014, 2013, 2012, 2011])

    await list.getPage(FILTERS, 1, 5)
    await list.getPage(FILTERS, 2, 5)
    assert.ok(request.calls.length > before)
    assert.equal(
      request.calls.filter((p) => p.year_end === 2020 && p.per > 1).length,
      1
    )
  })

  it('reaches the last page', async () => {
    const list = createPublishedList(makeRequest())
    const { rows } = await list.getPage(FILTERS, 7, 5)

    assert.deepEqual(years(rows), [1990])
  })

  it('starts over when the filters change', async () => {
    const list = createPublishedList(makeRequest())

    await list.getPage(FILTERS, 1, 5)

    const { rows, total } = await list.getPage(
      { ...FILTERS, author: 'Smith' },
      1,
      3
    )

    assert.equal(total, 15)
    assert.deepEqual(years(rows), [2019, 2017, 2015])
  })

  it('gives each of two overlapping calls its own, unrepeated rows', async () => {
    const list = createPublishedList(makeRequest())
    const other = { ...FILTERS, author: 'Smith' }

    const [first, same, different, again] = await Promise.all([
      list.getPage(FILTERS, 1, 5),
      list.getPage(FILTERS, 1, 5),
      list.getPage(other, 1, 3),
      list.getPage(FILTERS, 2, 5)
    ])

    assert.deepEqual(years(first.rows), [2020, 2019, 2018, 2017, 2016])
    assert.deepEqual(years(same.rows), [2020, 2019, 2018, 2017, 2016])
    assert.deepEqual(years(different.rows), [2019, 2017, 2015])
    assert.deepEqual(years(again.rows), [2015, 2014, 2013, 2012, 2011])
  })

  it('keeps working after a failed request', async () => {
    const request = makeRequest()
    const get = request.get
    let fail = true

    request.get = (...args) =>
      fail ? Promise.reject(new Error('offline')) : get(...args)

    const list = createPublishedList(request)

    await assert.rejects(list.getPage(FILTERS, 1, 5))

    fail = false
    assert.deepEqual(
      years((await list.getPage(FILTERS, 1, 5)).rows),
      [2020, 2019, 2018, 2017, 2016]
    )
  })

  it('reports the search request without the paging of the count', async () => {
    const request = makeRequest()
    const get = request.get

    request.get = (url, options) =>
      get(url, options).then((response) => ({
        ...response,
        request: {
          responseURL:
            'https://example.org/api/v1/sources?in_project=true&year_start=1990&per=1&page=1&year_end=2020'
        }
      }))

    const { url } = await createPublishedList(request).getPage(FILTERS, 1, 5)

    assert.equal(
      url,
      'https://example.org/api/v1/sources?in_project=true&year_start=1990&year_end=2020'
    )
  })

  it('is empty when nothing matches', async () => {
    const list = createPublishedList(makeRequest())
    const { rows, total } = await list.getPage(
      { ...FILTERS, author: 'Nobody' },
      1,
      5
    )

    assert.equal(total, 0)
    assert.deepEqual(rows, [])
  })
})
