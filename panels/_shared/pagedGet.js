/**
 * pagedGet.js
 *
 * Every page of a paginated TaxonWorks index, through a `get` the caller
 * passes in (axios-like: `get(url, { params, signal })`), following the
 * `pagination-total-pages` header. Pages are read one after the other; for
 * the few-page lookups that use it that is enough.
 *
 * Unlike ./fetchAllPages.js this imports nothing through the `@/` alias, so
 * modules that unit-test with an injected `get` can use it. Rejects when a
 * page fails.
 *
 * Depended on by:
 *   - ./typeNameOtu.js (taxon names by epithet)
 *   - ./typeMaterialSpecimen.js (type specimens of a name)
 */

/**
 * @param {Function} get
 * @param {string} url
 * @param {object} params
 * @param {{ per?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<object[]>}
 */
export async function getAllPages(get, url, params, { per = 500, signal } = {}) {
  const rows = []
  for (let page = 1; ; page++) {
    const { data, headers } = await get(url, { params: { ...params, per, page }, signal })
    rows.push(...(Array.isArray(data) ? data : []))
    const totalPages = Number(headers?.['pagination-total-pages']) || 1
    if (page >= totalPages) return rows
  }
}
