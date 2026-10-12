/**
 * Publication dates of sources, for the "Recently published" list.
 *
 * `/sources` cannot sort by publication date, so the list is sorted here.
 * TaxonWorks stores `year`, `month` (BibTeX style, "feb") and `day`, any of
 * the last two may be missing. A source without an exact date is placed by
 * the date it was added, as long as that falls inside the year (or month) it
 * was published in. Otherwise it goes to the end of that year (or month).
 */
const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec'
]

// Zero-based month, or null when there is none.
function monthIndex(month) {
  if (month == null || month === '') return null

  const number = Number(month)

  if (Number.isInteger(number)) {
    return number >= 1 && number <= 12 ? number - 1 : null
  }

  const index = MONTHS.indexOf(String(month).trim().slice(0, 3).toLowerCase())

  return index === -1 ? null : index
}

function dateParts(source) {
  const year = Number(source.year) || null
  const month = year ? monthIndex(source.month) : null
  const day = month !== null ? Number(source.day) || null : null

  return { year, month, day }
}

export function publicationSortTime(source) {
  const { year, month, day } = dateParts(source)

  if (!year) return -Infinity
  if (day) return Date.UTC(year, month, day)

  const start = Date.UTC(year, month ?? 0, 1)
  const end =
    (month === null ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, month + 1, 1)) -
    1
  const added = Date.parse(source.created_at)

  return added >= start && added <= end ? added : end
}

// Newest first. Returns a new list.
export function sortByPublication(sources) {
  return sources
    .map((source) => ({
      source,
      published: publicationSortTime(source),
      added: Date.parse(source.created_at) || 0
    }))
    .sort(
      (a, b) =>
        b.published - a.published ||
        b.added - a.added ||
        b.source.id - a.source.id
    )
    .map(({ source }) => source)
}

// "March 20, 2026", "February 2026" or "2026": never more than is known.
export function formatPublicationDate(source) {
  const { year, month, day } = dateParts(source)

  if (!year) return ''
  if (month === null) return String(year)

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    ...(day ? { day: 'numeric' } : {})
  }).format(Date.UTC(year, month, day || 1))
}

// The date a source was added: "October 9, 2026".
export function formatAddedDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(date))
}

// Shown as the hover text wherever the order "recently published" is offered.
export const PUBLISHED_ORDER_HELP =
  'Newest publication first. Without an exact publication date, a source is placed by the date it was added.'
