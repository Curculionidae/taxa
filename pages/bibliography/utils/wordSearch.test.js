import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { splitWords, createWordSearch, getAllMatches } from './wordSearch.js'

const SOURCES = [
  {
    id: 1,
    cached:
      'Colonnelli, E. (2011) Four new species, with a key to species of <i>Datonychus</i> Wagner, 1944.'
  },
  { id: 2, cached: 'Colonnelli, E. (2004) Catalogue of <i>Datonychus</i>.' },
  { id: 3, cached: 'Meregalli, M. (2009) <i>Pachycerus</i> &amp; allies.' },
  {
    id: 4,
    cached:
      'Avgın, S.S. & Colonnelli, E. (2011) A new species of <i>Otiorhynchus</i> from Turkey.'
  },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: 10 + i,
    cached: `Smith (${2000 + i}) A key to Datonychus, part ${i}.`
  }))
]

// Like the API: words matched in the typed order, case ignored.
function makeRequest() {
  const calls = []

  return {
    calls,
    getUri({ url, params }) {
      return `https://example.org${url}?${new URLSearchParams(params)}`
    },
    get(url, { params }) {
      calls.push(params)

      const pattern = new RegExp(
        splitWords(params.query_term)
          .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*'),
        'i'
      )
      const all = SOURCES.filter((s) => pattern.test(s.cached))
      const start = (params.page - 1) * params.per

      return Promise.resolve({
        data: all.slice(start, start + params.per),
        headers: {
          'pagination-total': String(all.length),
          'pagination-page': String(params.page)
        },
        request: {
          responseURL: `https://example.org/sources?query_term=${params.query_term}&per=${params.per}&page=${params.page}`
        }
      })
    }
  }
}

const ids = (rows) => rows.map(({ id }) => id)

describe('splitWords', () => {
  it('splits on any whitespace and drops repeats', () => {
    assert.deepEqual(splitWords('  Datonychus\tkey  key '), ['Datonychus', 'key'])
    assert.deepEqual(splitWords(undefined), [])
  })
})

describe('createWordSearch', () => {
  it('finds words in any order', async () => {
    const search = createWordSearch(makeRequest())
    const { data, total } = await search.getPage(
      { query_term: 'Datonychus key Colonnelli' },
      1,
      50
    )

    assert.deepEqual(ids(data), [1])
    assert.equal(total, 1)
  })

  it('sends only the longest word to the server', async () => {
    const request = makeRequest()

    await createWordSearch(request).getPage({ query_term: 'key Datonychus' }, 1, 50)

    assert.ok(request.calls.every((p) => p.query_term === 'Datonychus'))
  })

  it('matches text inside tags and entities, ignoring case', async () => {
    const search = createWordSearch(makeRequest())
    const { data } = await search.getPage(
      { query_term: '& PACHYCERUS meregalli' },
      1,
      50
    )

    assert.deepEqual(ids(data), [3])
  })

  it('finds words inside longer words, but lists them last', async () => {
    const search = createWordSearch(makeRequest())
    const page = async (q) => ids((await search.getPage({ query_term: q }, 1, 50)).data)

    // "key" inside "Turkey" is still found.
    assert.deepEqual(await page('Otiorhynchus key'), [4])

    assert.deepEqual(await page('Otiorh turk'), [4])
    assert.deepEqual(await page('Avgın (2011)'), [4])
  })

  it('ranks whole words before word starts before inner matches', async () => {
    const request = {
      get(url, { params }) {
        const data = [
          { id: 'inside', cached: 'Ein Bestimmungsschlüssel der Rüsselkäfer' },
          { id: 'start', cached: 'Schlüsselarten der Rüsselkäfer' },
          { id: 'whole', cached: 'Ein Schlüssel der Rüsselkäfer' }
        ].filter((s) => s.cached.toLowerCase().includes(params.query_term.toLowerCase()))

        return Promise.resolve({
          data,
          headers: { 'pagination-total': String(data.length) },
          request: { responseURL: 'https://example.org/sources' }
        })
      }
    }
    const { data } = await createWordSearch(request).getPage(
      { query_term: 'schlüssel Rüsselkäfer' },
      1,
      50
    )

    assert.deepEqual(ids(data), ['whole', 'start', 'inside'])
  })

  it('pages the filtered list without fetching it again', async () => {
    const request = makeRequest()
    const search = createWordSearch(request)
    const filters = { query_term: 'key Datonychus' }
    const first = await search.getPage(filters, 1, 5)
    const callsAfterFirst = request.calls.length
    const third = await search.getPage(filters, 3, 5)

    assert.equal(first.total, 13)
    assert.deepEqual(ids(third.data), [19, 20, 21])
    assert.equal(request.calls.length, callsAfterFirst)
  })

  it('reports the server search without its paging', async () => {
    const { url } = await createWordSearch(makeRequest()).getPage(
      { query_term: 'key Datonychus' },
      1,
      5
    )

    assert.equal(url, 'https://example.org/sources?query_term=Datonychus')
  })

  it('treats a repeated word as one word', async () => {
    const request = makeRequest()
    const { data, total } = await createWordSearch(request).getPage(
      { query_term: 'Datonychus  Datonychus' },
      1,
      50
    )

    assert.equal(request.calls[0].query_term, 'Datonychus')
    assert.ok(total > 0)
    assert.equal(data.length, total)
  })

  it('makes no request beyond the search itself', async () => {
    const request = makeRequest()

    await createWordSearch(request).getPage({ query_term: 'key Datonychus' }, 1, 5)

    assert.ok(request.calls.every((params) => params.per !== 1))
  })

  it('leaves a single word to the server paging', async () => {
    const request = makeRequest()
    const { data, total } = await createWordSearch(request).getPage(
      { query_term: 'Datonychus' },
      2,
      5
    )

    assert.equal(total, 14)
    assert.deepEqual(ids(data), [13, 14, 15, 16, 17])
    assert.deepEqual(request.calls, [{ query_term: 'Datonychus', page: 2, per: 5 }])
  })
})

describe('getAllMatches', () => {
  it('returns every source holding all the words', async () => {
    const rows = await getAllMatches(makeRequest(), { query_term: 'Datonychus Colonnelli' })

    assert.deepEqual(ids(rows), [1, 2])
  })
})
