/**
 * eventDate.js
 *
 * Formats a DwC collecting-event date for display: the verbatim eventDate
 * when present, else whatever of day/month/year is populated, joined
 * "day.month.year" (the "specimen label" convention DwcTable.vue's identity
 * block uses). Never requires all three: a record with only a month and
 * day, or only a year, still shows that partial date rather than nothing.
 *
 * Depended on by:
 *   - ./DwcTable.vue
 *   - ../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue
 *
 * If you change this file, sanity-check both call sites.
 *
 * @param {{eventDate?: string, day?: string|number, month?: string|number, year?: string|number}} record
 * @returns {string|null}
 */
export function formatEventDate({ eventDate, day, month, year } = {}) {
  if (eventDate) return eventDate
  const parts = [day, month, year].filter(Boolean)
  return parts.length ? parts.join('.') : null
}
