/**
 * eventDate.js
 *
 * Formats a DwC collecting-event date for display: the verbatim eventDate
 * when present, else day.month.year built from the separate day/month/year
 * fields (the "specimen label" convention DwcTable.vue's identity block
 * uses) — only when year itself is present, so a record with just a day/
 * month never shows a bare ".6." fragment.
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
  if (!year) return null
  return [day, month, year].filter(Boolean).join('.')
}
