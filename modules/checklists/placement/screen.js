// Which records the checklists count: species and subspecies of Curculionoidea,
// present, with an OTU. One implementation for the cache build
// (scripts/buildContext.mjs screenRow) and the curator page (placement/live.js
// cacheStatus, recordLeftOut, otuLeftOut).
//
// Input:  a DwC row (completed by typeStatus.js typeRow for an undetermined
//         type), the classification of its OTU from the OTU's parents when the
//         row has no superfamily (classificationFromParents; null when that
//         lookup failed or is not known), and whether its distribution is absent.
// Output: { left: reason } for a record the checklists leave out, else
//         { classification, lookupFailed }.
// Purity: no network, no file system.

export const SUPERFAMILY = 'Curculionoidea'
export const RANKS = new Set(['species', 'subspecies'])

// A parent's rank from its name ending.
const RANK_ENDINGS = [
  ['superfamily', /oidea$/], ['family', /idae$/], ['subfamily', /inae$/],
  ['tribe', /ini$/], ['subtribe', /ina$/]
]

const normalize = (text) => String(text || '').trim().toLocaleLowerCase()

/**
 * The classification of an OTU from the names of its parents
 * (GET /otus/:id?extend[]=parents, the keys of `parents`), by name endings.
 * @param {string[]} parentNames
 * @returns {{ superfamily?: string, family?: string, subfamily?: string, tribe?: string, subtribe?: string }}
 */
export function classificationFromParents(parentNames) {
  const classification = {}
  for (const name of parentNames ?? []) {
    for (const [rank, ending] of RANK_ENDINGS) if (ending.test(name)) classification[rank] = name
  }
  return classification
}

/**
 * Does the checklists count this record, and with which classification?
 * @param {Object} row  DwC fields: taxonRank, otu_id, occurrenceStatus, superfamily, …, scientificName
 * @param {Object} [options]
 * @param {Object|null} [options.parentClassification]  the OTU's classification from its
 *   parents, used when the row has no superfamily; null: the lookup failed (the
 *   record is then not left out for its superfamily; the build lists it as
 *   'classification lookup failed')
 * @param {boolean} [options.distributionAbsent]  the asserted distribution is marked absent
 * @returns {{ left: string } | { classification: Object, lookupFailed: boolean }}
 *   left: 'rank genus', 'rank none', 'no OTU', 'recorded as absent',
 *   'not in Curculionoidea (Chrysomeloidea)', 'distribution is absent'
 */
export function screenRecord(row, { parentClassification, distributionAbsent = false } = {}) {
  if (!RANKS.has(row.taxonRank)) return { left: `rank ${row.taxonRank || 'none'}` }
  if (!row.otu_id) return { left: 'no OTU' }
  if (normalize(row.occurrenceStatus) === 'absent') return { left: 'recorded as absent' }
  const lookupFailed = !row.superfamily && parentClassification === null
  const classification = row.superfamily ? { ...row } : { ...row, ...(parentClassification ?? {}) }
  if (!classification.genus) classification.genus = String(row.scientificName || '').split(' ')[0]
  if (classification.superfamily !== SUPERFAMILY && !lookupFailed) {
    return { left: `not in ${SUPERFAMILY} (${classification.superfamily || 'no superfamily'})` }
  }
  if (distributionAbsent) return { left: 'distribution is absent' }
  return { classification, lookupFailed }
}
