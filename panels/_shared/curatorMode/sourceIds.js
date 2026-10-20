/**
 * Source ids for references that a package panel shows only as text, for the
 * curator-mode pencils of the reference overlays (see readme.md in this folder).
 * A reference is matched by its full citation text (`source.cached`, tags and
 * spacing ignored); a text two different sources share links to neither.
 */

import { htmlToPlainText } from '../plainText.js'

/** Shown HTML reduced to plain text, for matching. */
export const plainKey = htmlToPlainText

/**
 * @param {{ id: number, cached: string }[]} sources
 * @returns {Map<string, number|null>} text -> source id, null when ambiguous
 */
export function indexSources(sources) {
  const index = new Map()

  for (const { id, cached } of sources) {
    const key = plainKey(cached)

    if (!key) continue
    index.set(key, index.has(key) && index.get(key) !== id ? null : id)
  }

  return index
}

/**
 * Text to search for a reference the index did not have: its first words,
 * enough to be rare (author, year, start of the title), short enough to
 * survive differences in how the rest is formatted.
 */
export function searchTermFor(key, words = 6) {
  return key.split(' ').slice(0, words).join(' ')
}

/**
 * The source of one reference text, by a text search on `/sources`. Only an
 * exact match of the whole text counts.
 *
 * @param {object} request axios instance for the TaxonWorks API
 * @param {string} key plainKey of the reference
 * @returns {Promise<number|null>}
 */
export async function searchSourceId(request, key) {
  const { data } = await request.get('/sources', {
    params: { in_project: true, query_term: searchTermFor(key), per: 50 }
  })

  return indexSources(data).get(key) ?? null
}
