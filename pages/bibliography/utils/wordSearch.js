import { getAll } from './sourceRecords.js'
import { htmlToPlainText } from '../../../panels/_shared/plainText.js'

/**
 * Search for sources whose citation contains every typed word, in any order.
 *
 * `/sources?query_term=` matches the words only in the order they are typed
 * ("key Datonychus" finds Colonnelli 2011, "Datonychus key" does not). So
 * with more than one word, only the longest word goes to the server (the
 * rarest one, most likely, so the fewest records to fetch), every match is
 * loaded, and all words are checked here against the citation text.
 * A word may match anywhere, also inside a longer word ("schlüssel" finds
 * "Bestimmungsschlüssel"), but such weak hits are listed last: citations
 * where the words stand as whole words come first, then those where they
 * start a word ("Otiorh"), then the rest ("key" in "Turkey"). Within a rank
 * the server order is kept. The pages are then cut from that list.
 *
 * One word or none goes to the server as the search, paged there. The
 * typed text is cleaned first (spacing, repeated words), so "key key" is
 * the one-word search "key", not the phrase.
 */

export function splitWords(term) {
  return [...new Set(String(term ?? '').trim().split(/\s+/).filter(Boolean))]
}

// The citation as the reader sees it: no tags, no entities, lower case.
function citationText(source) {
  return htmlToPlainText(source.cached).toLowerCase()
}

const NOT_IN_WORD_BEFORE = '(?<![\\p{L}\\p{N}])'
const NOT_IN_WORD_AFTER = '(?![\\p{L}\\p{N}])'

// A typed word as tests on the citation text, from loosest to strictest:
// anywhere, at the start of a word, as a whole word. A side that begins or
// ends with a sign ("(2011)", "&") counts as a word edge already.
function wordMatcher(word) {
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const before = /^[\p{L}\p{N}]/u.test(word) ? NOT_IN_WORD_BEFORE : ''
  const after = /[\p{L}\p{N}]$/u.test(word) ? NOT_IN_WORD_AFTER : ''

  return [
    new RegExp(escaped, 'u'),
    new RegExp(before + escaped, 'u'),
    new RegExp(before + escaped + after, 'u')
  ]
}

// How well a citation matches: per word 0 inside a word, 1 at the start of
// one, 2 as a whole word. -1 when a word is missing.
function matchScore(source, words) {
  const text = citationText(source)
  let score = 0

  for (const [anywhere, start, whole] of words) {
    if (!anywhere.test(text)) return -1
    score += whole.test(text) ? 2 : start.test(text) ? 1 : 0
  }

  return score
}

// The matching sources, best first. Array sort is stable, so equal scores
// keep the server order.
function rankMatches(sources, words) {
  return sources
    .map((source) => ({ source, score: matchScore(source, words) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ source }) => source)
}

// The filters with the typed text cleaned up: "key  key" is "key".
function cleanFilters(filters) {
  if (filters.query_term == null) return filters

  return { ...filters, query_term: splitWords(filters.query_term).join(' ') }
}

// The word sent to the server, and the ones left to check here. Null for a
// one-word search, which the server pages itself.
function planSearch(filters) {
  const words = splitWords(filters.query_term)

  if (words.length < 2) return null

  const serverWord = words.reduce((a, b) => (b.length > a.length ? b : a))

  return {
    params: { ...filters, query_term: serverWord },
    words: words.map(wordMatcher)
  }
}

/**
 * Every source matching the filters, for the download.
 */
export async function getAllMatches(request, filters) {
  const plan = planSearch(filters)

  if (!plan) return getAll(request, '/sources', cleanFilters(filters))

  const sources = await getAll(request, '/sources', plan.params)

  return rankMatches(sources, plan.words)
}

/**
 * Pages of a search. `getPage` answers `{ data, total, page, url }`.
 * The filtered list of the last multi-word search is kept, so paging
 * through it does not fetch it again.
 */
export function createWordSearch(request) {
  let key
  let cached

  async function loadMatches(filters, plan) {
    const nextKey = JSON.stringify(filters)

    if (nextKey !== key) {
      const sources = await getAll(request, '/sources', plan.params)

      key = nextKey
      cached = {
        rows: rankMatches(sources, plan.words),
        // No single request returns the filtered rows. The closest thing to
        // show is the server search they were filtered from, unpaged.
        url: request.getUri?.({ url: '/sources', params: plan.params })
      }
    }

    return cached
  }

  async function getPage(filters, page, per) {
    const plan = planSearch(filters)

    if (!plan) {
      const { data, headers, request: xhr } = await request.get('/sources', {
        params: { ...cleanFilters(filters), page, per }
      })

      return {
        data,
        total: Number(headers['pagination-total']) || 0,
        page: Number(headers['pagination-page']) || page,
        url: xhr?.responseURL
      }
    }

    const { rows, url } = await loadMatches(filters, plan)

    return {
      data: rows.slice((page - 1) * per, page * per),
      total: rows.length,
      page,
      url
    }
  }

  return { getPage }
}
