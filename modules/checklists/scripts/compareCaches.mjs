// Pure helpers of compare.mjs: how one record of the old cache and the same
// record of the new cache are told apart, and how the old page found a state.
//
// Purpose: compare.mjs compares the cache of the old hard-coded build with the
// cache of the placement engine, record by record. Everything here is pure (no
// files, no network) so it can be tested on small fixtures
// (compareCaches.test.js).
//
// Input:  entries, one per record and checklist file it appears in:
//         { key, otu, checklist, part, state } where `key` is
//         "<dwc_occurrence_object_type>:<dwc_occurrence_object_id>" and, for an
//         old entry, `checklist` is already the name its old checklist has in
//         the new cache (oldToNewNames).
// Output: pairs of entries and their classification; the reproduced old state.
//
// How the old state is reproduced: the old page (ChecklistsPage.vue at commit
// a369535, recordRegion) did not store a state. For the United States, Canada,
// Australia, China, Russia and the United Kingdom it took the Natural Earth
// subdivisions of that country (subdivisions.geojson, features whose
// `country` has the same country key) and matched, in this order, the
// record's DwC stateProvince, the place name of its asserted distribution
// (`place`) and its DwC county with resolveSubdivision (placement/states.js),
// leaving out the old page's generic words (OLD_IGNORED_WORDS, the list that
// is now the rules file's ignored_name_words). A country with parts (France)
// had no states. oldState does exactly that.

import { buildSubdivisionIndex, resolveSubdivision } from '../placement/states.js'
import { normalizeName } from '../placement/areas.js'

// The old page's country key: lower case, spaces collapsed, then its alias
// table. Only the aliases that touch the six state countries are needed here.
const OLD_ALIASES = {
  'united states of america': 'united states',
  usa: 'united states',
  'russian federation': 'russia'
}
const OLD_STATE_COUNTRIES = new Set(['united states', 'canada', 'australia', 'china', 'russia', 'united kingdom'])
// The old page's generic words (GENERIC_WORDS of placement/states.js at a369535),
// kept here as they were so the old state stays reproducible when the rules
// file's ignored_name_words change.
const OLD_IGNORED_WORDS = [
  'province', 'oblast', 'krai', 'kray', 'republic', 'of', 'autonomous', 'region', 'okrug',
  'state', 'municipality', 'city', 'district', 'territory', 'sheng', 'shi', 'the', 'and', 'county'
]

/**
 * The old page's country key of a checklist or subdivision country name.
 * @param {string} name
 * @returns {string}
 */
export function oldCountryKey(name) {
  const normalized = String(name || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  return OLD_ALIASES[normalized] || normalized
}

/**
 * The old page's subdivision index of each state country, from the features
 * of subdivisions.geojson.
 * @param {{ properties: { name: string, country: string, aliases?: string[] } }[]} features
 * @returns {Map<string, import('../placement/states.js').SubdivisionIndex>}  by old country key
 */
export function oldStateIndexes(features) {
  const byCountry = new Map()
  for (const feature of features) {
    const key = oldCountryKey(feature.properties.country)
    if (!OLD_STATE_COUNTRIES.has(key)) continue
    if (!byCountry.has(key)) byCountry.set(key, [])
    byCountry.get(key).push(feature)
  }
  return new Map([...byCountry].map(([key, list]) => [key, buildSubdivisionIndex(list, OLD_IGNORED_WORDS)]))
}

/**
 * The state the old page showed a record under, '' for none.
 * @param {{ stateProvince?: string, county?: string, place?: string, dwc_occurrence_object_type: string }} record
 * @param {string} checklistName  the record's old checklist name
 * @param {Map<string, import('../placement/states.js').SubdivisionIndex>} indexes  oldStateIndexes
 * @param {boolean} hasParts  the old checklist had parts (France): no states
 * @returns {string}
 */
export function oldState(record, checklistName, indexes, hasParts = false) {
  if (hasParts) return ''
  const index = indexes.get(oldCountryKey(checklistName))
  if (!index) return ''
  // The old page kept `place` only for asserted distributions.
  const place = record.dwc_occurrence_object_type === 'AssertedDistribution' ? record.place : undefined
  return resolveSubdivision(index, record.stateProvince, place, record.county)
}

/**
 * The record key the comparison uses.
 * @param {{ dwc_occurrence_object_type: string, dwc_occurrence_object_id: string|number }} record
 * @returns {string}  'AssertedDistribution:556796'
 */
export function recordKey(record) {
  return `${record.dwc_occurrence_object_type}:${record.dwc_occurrence_object_id}`
}

/**
 * Pair the old and new entries of one record key. A distribution asserted for
 * a biological association is one record per beetle side, so one key can have
 * several entries: they are paired by OTU first, then in file order.
 * @param {Array<{ otu?: string }>} olds
 * @param {Array<{ otu?: string }>} news
 * @returns {Array<[Object|null, Object|null]>}
 */
export function pairEntries(olds, news) {
  const pairs = []
  const restNew = [...news]
  const restOld = []
  for (const old of olds) {
    const index = restNew.findIndex((entry) => entry.otu === old.otu)
    if (index >= 0) pairs.push([old, restNew.splice(index, 1)[0]])
    else restOld.push(old)
  }
  while (restOld.length && restNew.length) pairs.push([restOld.shift(), restNew.shift()])
  for (const old of restOld) pairs.push([old, null])
  for (const entry of restNew) pairs.push([null, entry])
  return pairs
}

/**
 * What happened to one record between the caches.
 * @param {{ checklist: string, part?: string, state?: string }|null} old  checklist as named in the new cache
 * @param {{ checklist: string, part?: string, state?: string }|null} now
 * @returns {{ status: 'same'|'moved'|'newly placed'|'no longer placed', partChanged: boolean, stateChanged: boolean }}
 *   partChanged and stateChanged only for records that stay in their checklist
 */
export function classifyPair(old, now) {
  if (!old && !now) throw new Error('classifyPair needs an old or a new entry')
  if (!old) return { status: 'newly placed', partChanged: false, stateChanged: false }
  if (!now) return { status: 'no longer placed', partChanged: false, stateChanged: false }
  if (old.checklist !== now.checklist) return { status: 'moved', partChanged: false, stateChanged: false }
  return {
    status: 'same',
    partChanged: (old.part || '') !== (now.part || ''),
    stateChanged: (old.state || '') !== (now.state || '')
  }
}

/**
 * The name each old checklist has in the new cache: the new checklist with
 * the same id (the engine keeps the old ids), else one that owns one of its
 * areas, else one with the same name after normalizing (accents, case).
 * @param {{ id: number, name: string, areas?: number[] }[]} oldChecklists  old index.json `countries`
 * @param {{ id: number|string, name: string, areaIds: number[] }[]} newChecklists  deriveChecklists
 * @returns {Map<string, string|null>}  old name to new name, null when none
 */
export function oldToNewNames(oldChecklists, newChecklists) {
  const result = new Map()
  for (const old of oldChecklists) {
    const found = newChecklists.find((checklist) => String(checklist.id) === String(old.id)) ||
      newChecklists.find((checklist) => (old.areas || [old.id]).some((id) => checklist.areaIds.includes(id))) ||
      newChecklists.find((checklist) => normalizeName(checklist.name) === normalizeName(old.name))
    result.set(old.name, found ? found.name : null)
  }
  return result
}

/**
 * Whether TaxonWorks changed a record after the old download: created (the
 * record did not exist then) or updated (it existed but was edited).
 * @param {{ created?: string, updated?: string[] }} dates  ISO or 'YYYY-MM-DD hh:mm:ss UTC' strings
 * @param {Date} cutoff  when the old data was downloaded
 * @returns {{ created: boolean, updated: boolean, date: string }}  date: YYYY-MM-DD of the latest change
 */
export function changedInTaxonWorks(dates, cutoff) {
  const parse = (text) => (text ? new Date(String(text).replace(' UTC', 'Z').replace(' ', 'T')) : null)
  const created = parse(dates.created)
  const updates = (dates.updated || []).map(parse).filter((date) => date && !Number.isNaN(date.getTime()))
  const latest = [created, ...updates].filter(Boolean).sort((a, b) => b - a)[0]
  return {
    created: Boolean(created && created >= cutoff),
    updated: updates.some((date) => date >= cutoff),
    date: latest ? latest.toISOString().slice(0, 10) : ''
  }
}

/**
 * Group items by a label, largest group first, then by label.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} labelOf
 * @returns {Array<[string, T[]]>}
 */
export function groupBy(items, labelOf) {
  const groups = new Map()
  for (const item of items) {
    const label = labelOf(item)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(item)
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'en'))
}
