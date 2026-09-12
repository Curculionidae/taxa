/**
 * fetchAllPages.js
 *
 * Fetches every page of a paginated TaxonWorks index endpoint, following the
 * `pagination-total-pages` response header instead of assuming everything
 * fits in one `per`-sized page (a single request can silently truncate for a
 * widely-distributed, heavily-synonymized species or a large descendant set).
 *
 * Remaining pages run through a small worker pool (`concurrency`), not one
 * unbounded `Promise.all` burst: a result set spanning dozens of pages would
 * otherwise fire that many simultaneous requests at once, risking 429s or
 * per-origin connection queuing.
 *
 * `cacheKey`, when given, routes every page through `useOtuPageRequest` (the
 * package's "view JSON used to build this page" debug link) under its own
 * key: `cacheKey` for page 1, `${cacheKey}:page2`, `${cacheKey}:page3`, ...
 * for the rest, so the debug listing reflects the full multi-page fetch
 * instead of only page 1.
 *
 * Shared by PanelAssertedDistributions (otus, asserted_distributions,
 * citations, data_attributes) and PanelSpecimenOccurrences/SpeciesBars.vue
 * (taxon_names, otus) since both need the same pagination-following logic.
 */
import { makeAPIRequest } from '@/utils/request'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest.js'
import { mapPool } from './concurrencyPool.js'

const DEFAULT_CONCURRENCY = 4

export async function fetchAllPages(url, params, { per = 500, concurrency = DEFAULT_CONCURRENCY, cacheKey, signal } = {}) {
  const requestPage = (page) => makeAPIRequest.get(url, { params: { ...params, per, page }, signal })
  const trackedRequestPage = (page) => {
    if (!cacheKey) return requestPage(page)
    const key = page === 1 ? cacheKey : `${cacheKey}:page${page}`
    return useOtuPageRequest(key, () => requestPage(page))
  }

  const first = await trackedRequestPage(1)
  const totalPages = Number(first.headers['pagination-total-pages']) || 1
  const pages = [first.data]

  if (totalPages > 1) {
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
    await mapPool(remainingPages, concurrency, async (page) => {
      const { data } = await trackedRequestPage(page)
      pages[page - 1] = data
    })
  }

  return pages.flat()
}
