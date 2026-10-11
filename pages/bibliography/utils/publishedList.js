import { getAll } from './sourceRecords.js'
import { sortByPublication } from './publicationDate.js'

/**
 * A search result in order of publication, newest first.
 *
 * `/sources` cannot sort by publication date, so the sorting happens here.
 * To show the first pages without fetching every match, the years are
 * loaded from the newest backwards, in spans that double each time, only as
 * far as the requested page needs. A source always sorts inside its own
 * year (see publicationDate.js), so an older span never has to be merged
 * into the rows that are already there.
 *
 * The filters must carry `year_start` and `year_end`.
 *
 * Calls are answered one after the other, so two that overlap cannot load
 * the same years twice or reset the list under each other.
 */
// No single request returns the rows in this order. The closest thing to
// show for them is the search itself: the count request without its paging.
function withoutPaging(url) {
  if (!url) return url

  const [base, query = ''] = url.split('?')
  const kept = query
    .split('&')
    .filter((part) => part && !/^(per|page)=/.test(part))

  return kept.length ? `${base}?${kept.join('&')}` : base
}

export function createPublishedList(request) {
  let key
  let rows
  let total
  let url
  let nextYear // the newest year not loaded yet
  let span

  async function start(filters) {
    const response = await request.get('/sources', {
      params: { in_project: true, ...filters, per: 1, page: 1 }
    })

    key = JSON.stringify(filters)
    rows = []
    total = Number(response.headers['pagination-total']) || 0
    url = withoutPaging(response.request?.responseURL)
    nextYear = filters.year_end
    span = 2
  }

  async function loadPage(filters, page, per) {
    if (JSON.stringify(filters) !== key) await start(filters)

    const needed = Math.min(page * per, total)

    while (rows.length < needed && nextYear >= filters.year_start) {
      const from = Math.max(filters.year_start, nextYear - span + 1)
      const sources = await getAll(request, '/sources', {
        in_project: true,
        ...filters,
        year_start: from,
        year_end: nextYear
      })

      rows.push(...sortByPublication(sources))
      nextYear = from - 1
      span *= 2
    }

    return { rows: rows.slice((page - 1) * per, page * per), total, url }
  }

  let queue = Promise.resolve()

  function getPage(filters, page, per) {
    const answer = queue.then(() => loadPage(filters, page, per))

    queue = answer.catch(() => {})

    return answer
  }

  return { getPage }
}
