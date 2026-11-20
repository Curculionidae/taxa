#!/usr/bin/env node
// Compares two checklist caches record by record and writes a report for the
// curator, who approves every visible change before a new cache is committed.
//
// Usage
//   node modules/checklists/scripts/compare.mjs [<old dir>] [<new dir>] [--from <data dir>]
//   <old dir>   the cache to compare against (default modules/checklists/.cache/old,
//               the cache of the old hard-coded build, committed 2026-11-19)
//   <new dir>   the cache of the placement engine (default public/checklists)
//   --from      the saved TaxonWorks data the new cache was built from
//               (default modules/checklists/.cache/data)
//   --out <f>   the report file (default modules/checklists/.cache/compare.md);
//               the full list goes beside it as <f without .md>-full.md
//   A folder is read relative to the working directory, else to modules/checklists/.
//   Either cache may be in the old format (country files <id>.json, no states)
//   or the engine's (index.json `file`, records with `state`):
//   compareCaches.mjs cacheEntries reads both.
//
// Inputs: both caches (index.json and countries/*.json; the old one also
// subdivisions.geojson, the new one unplaced.json), the saved TaxonWorks data
// and the current rules file. The new cache must have been built from that
// data with that rules file (npm run checklists -- --from), so the
// explanations here are the ones that put the records where they are.
//
// Outputs: modules/checklists/.cache/compare.md (or --out; counts, every group
// of changes, at most 20 records per group with their placement text) and
// compare-full.md beside it (every changed record, every file rename).
//
// How records are compared: by "<dwc_occurrence_object_type>:<id>". A
// distribution asserted for a biological association is one record per beetle
// side, so a key can occur several times; its entries are paired by OTU
// (compareCaches.mjs pairEntries). Old checklist names are first translated to
// the names they have now (oldToNewNames: same id, a shared area or the same
// name), so a renamed checklist does not count as a move.
//
// How explanations are made: with the build's own code. buildContext.mjs
// loads the data and creates the engine context exactly as build.mjs does;
// placementOf places the record and formatPlacement (placement/format.js)
// prints the steps. A record no longer placed shows the reason from
// unplaced.json, or why the build leaves it out (screenRow).
//
// How old states are reproduced: the old build's cache stored no state; its
// page worked one out while showing a country (oldState in compareCaches.mjs:
// the record's stateProvince, the place of its distribution, then its county,
// matched against the old subdivisions.geojson). An engine cache as the old
// side stores `state`, which is used as is. Either is compared with the
// `state` the new cache stores.
//
// How TaxonWorks edits are told apart from rule changes: the old data was
// downloaded on the old index's `updated` day. A record created after the
// start of that day is new in TaxonWorks; one updated after it was edited
// (dates of the DwC row and of the asserted distribution). A key that is in
// the old cache but nowhere in the new data is gone from TaxonWorks.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandChecklist } from '../data/compact.js'
import { buildSubdivisionIndex, stateIndex, matchSubdivision } from '../placement/states.js'
import { formatPlacement } from '../placement/format.js'
import { loadBuildContext, KIND } from './buildContext.mjs'
import { decidingStep } from './cacheFiles.mjs'
import {
  oldStateIndexes, oldState, pairEntries, classifyPair, oldToNewNames, changedInTaxonWorks, groupBy, cacheEntries
} from './compareCaches.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MODULE = join(ROOT, 'modules/checklists/')
const outIndex = process.argv.indexOf('--out')
const OUT = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : join(MODULE, '.cache/compare.md')
const OUT_FULL = OUT.replace(/\.md$/, '') + '-full.md'
const CAP = 20
const TYPE = Object.fromEntries(Object.entries(KIND).map(([type, kind]) => [kind, type]))

const args = process.argv.slice(2)
const fromIndex = args.indexOf('--from')
const dataArg = fromIndex >= 0 ? args[fromIndex + 1] : '.cache/data'
const valueIndexes = new Set([fromIndex, args.indexOf('--out')].filter((index) => index >= 0).map((index) => index + 1))
const positional = args.filter((arg, index) => !arg.startsWith('--') && !valueIndexes.has(index))
const folder = (path) => (existsSync(resolve(path)) ? resolve(path) : join(MODULE, path))
const oldDir = folder(positional[0] ?? '.cache/old')
const newDir = positional[1] ? folder(positional[1]) : join(ROOT, 'public/checklists')
const dataDir = folder(dataArg)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

// The old cache.
const oldIndex = readJson(join(oldDir, 'index.json'))
// Needed only for an old-format cache (no stored states).
const oldSubdivisions = join(oldDir, 'subdivisions.geojson')
const stateIndexes = oldStateIndexes(existsSync(oldSubdivisions) ? readJson(oldSubdivisions).features : [])
const oldDownload = new Date(`${oldIndex.updated}T00:00:00`) // local start of the old download day

// The new cache and the build context it came from.
const newIndex = readJson(join(newDir, 'index.json'))
const unplacedReason = new Map()
for (const [reason, ids] of Object.entries(readJson(join(newDir, 'unplaced.json')))) {
  for (const [kind, id] of ids) unplacedReason.set(`${TYPE[kind]}:${id}`, reason)
}
const context = await loadBuildContext(dataDir, { root: ROOT, log: () => {}, warn: () => {} })
const { distributions, rowsOf, screenRow, placementOf } = context
const dataDate = statSync(join(dataDir, 'dwc_occurrences.csv')).mtime.toLocaleDateString('sv-SE')
const nameMap = oldToNewNames(oldIndex.countries, context.checklists)

const byKey = new Map() // record key -> { olds: [], news: [] }
const slot = (key) => {
  if (!byKey.has(key)) byKey.set(key, { olds: [], news: [] })
  return byKey.get(key)
}
// Either cache format (compareCaches.mjs cacheEntries): the old build's files
// are <id>.json without states, the engine's are named in `file` and store `state`.
const recordsIn = (dir) => (file) => expandChecklist(readJson(join(dir, 'countries', file)))
for (const entry of cacheEntries(oldIndex, recordsIn(oldDir), {
  checklistOf: (name) => nameMap.get(name) ?? `${name} (no longer a checklist)`,
  oldStateOf: (record, country) => oldState(record, country.name, stateIndexes, Boolean(country.parts))
})) slot(entry.key).olds.push(entry)
for (const entry of cacheEntries(newIndex, recordsIn(newDir))) slot(entry.key).news.push(entry)

// Classify every pair.
const counts = { same: 0, moved: 0, 'newly placed': 0, 'no longer placed': 0, gone: 0, partChanged: 0, stateChanged: 0, newInTw: 0 }
const moved = []
const newlyPlaced = []
const noLonger = []
const gone = []
const partChanges = []
const stateChanges = []
const severalChecklists = []
for (const [key, { olds, news }] of byKey) {
  const oldSet = new Set(olds.map((entry) => entry.checklist))
  const newSet = new Set(news.map((entry) => entry.checklist))
  if (newSet.size > 1) severalChecklists.push({ key, old: [...oldSet], now: [...newSet] })
  for (const [old, now] of pairEntries(olds, news)) {
    const { status, partChanged, stateChanged } = classifyPair(old, now)
    const item = { key, old, now }
    if (status === 'same') {
      counts.same++
      if (partChanged) { counts.partChanged++; partChanges.push(item) }
      if (stateChanged) { counts.stateChanged++; stateChanges.push(item) }
    } else if (status === 'moved') {
      counts.moved++
      moved.push(item)
    } else if (status === 'newly placed') {
      counts['newly placed']++
      newlyPlaced.push(item)
    } else if (rowsOf(...kindId(key)).length) {
      counts['no longer placed']++
      noLonger.push(item)
    } else {
      counts.gone++
      gone.push(item)
    }
  }
}

function kindId(key) {
  const [type, id] = key.split(':')
  return [KIND[type] ?? type, Number(id)]
}

// TaxonWorks dates of a record: its DwC row, its asserted distribution.
function twChange(key, otu) {
  const [kind, id] = kindId(key)
  const rows = rowsOf(kind, id)
  const row = rows.find((candidate) => candidate.otu_id === otu) ?? rows[0]
  const ad = kind === 'AD' ? distributions.get(String(id)) : null
  return changedInTaxonWorks({
    created: ad?.created_at ?? row?.created_at,
    updated: [ad?.updated_at, row?.updated_at].filter(Boolean)
  }, oldDownload)
}

// Placement text, with the build's code.
async function explain(key, otu) {
  const [kind, id] = kindId(key)
  const row = rowsOf(kind, id).find((candidate) => candidate.otu_id === otu)
  const { missing, subject, placement } = await placementOf({ kind, id }, row)
  if (missing) return { text: missing, placement: null }
  return { text: formatPlacement(subject, placement), placement }
}

for (const item of [...moved, ...newlyPlaced, ...noLonger, ...partChanges, ...stateChanges]) {
  const entry = item.now ?? item.old
  item.tw = twChange(item.key, entry.otu)
  const { text, placement } = await explain(item.key, entry.otu)
  item.text = text
  item.placement = placement
}
for (const item of newlyPlaced) if (item.tw.created) counts.newInTw++
for (const item of noLonger) {
  const [kind, id] = kindId(item.key)
  const reason = unplacedReason.get(item.key)
  if (reason) item.reason = reason
  else {
    const row = rowsOf(kind, id).find((candidate) => candidate.otu_id === item.old.otu) ?? rowsOf(kind, id)[0]
    const { left } = screenRow(row)
    item.reason = left ? `left out by the build: ${left}` : 'not in the new cache (no reason found)'
  }
}

// Checklists: names, files, added and removed.
const newByName = new Map(newIndex.countries.map((country) => [country.name, country]))
const mappedNew = new Set([...nameMap.values()].filter(Boolean))
const renames = oldIndex.countries
  .filter((country) => nameMap.get(country.name) && nameMap.get(country.name) !== country.name)
  .map((country) => ({ from: country.name, to: nameMap.get(country.name) }))
const removed = oldIndex.countries.filter((country) => !nameMap.get(country.name) || !newByName.has(nameMap.get(country.name)))
const added = newIndex.countries.filter((country) => !mappedNew.has(country.name))
const fileRenames = oldIndex.countries
  .filter((country) => newByName.has(nameMap.get(country.name)))
  .map((country) => ({ name: nameMap.get(country.name), from: country.file ?? `${country.id}.json`, to: newByName.get(nameMap.get(country.name)).file }))

// Writing.
const md = []
const full = []
const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`
const twNote = (item) => (item.tw?.created ? ` (new in TaxonWorks ${item.tw.date})` : item.tw?.updated ? ` (edited in TaxonWorks ${item.tw.date})` : '')
const twShare = (items) => {
  const created = items.filter((item) => item.tw?.created).length
  const updated = items.filter((item) => !item.tw?.created && item.tw?.updated).length
  const parts = [created && `${created} new in TaxonWorks`, updated && `${updated} edited in TaxonWorks`].filter(Boolean)
  return parts.length ? ` (${parts.join(', ')} since the old download)` : ''
}
const nameOf = (item) => (item.now ?? item.old).record.scientificName || ''
function recordBlock(lines, item) {
  const [kind, id] = kindId(item.key)
  lines.push(`**${kind} ${id}** ${nameOf(item)}${twNote(item)}`, '', '```', item.text ?? item.reason ?? '', '```', '')
}
// One section: an optional intro, then per group its heading, an optional
// note, and its records (at most CAP in compare.md, all in compare-full.md).
// compact: compare.md lists only the record ids, compare-full.md the texts.
function section(title, groups, { intro = '', note = null, compact = false } = {}) {
  for (const lines of [md, full]) {
    lines.push(`## ${title}`, '')
    if (intro) lines.push(intro, '')
    if (!groups.length) lines.push('None.', '')
  }
  for (const [label, items] of groups) {
    const head = `### ${label}: ${plural(items.length, 'record')}${compact ? '' : twShare(items)}`
    for (const lines of [md, full]) {
      lines.push(head, '')
      const text = note?.(items)
      if (text) lines.push(text, '')
    }
    if (compact) md.push(items.map((item) => kindId(item.key).join(' ')).join(', '), '')
    items.forEach((item, index) => {
      if (!compact && index < CAP) recordBlock(md, item)
      recordBlock(full, item)
    })
    if (!compact && items.length > CAP) md.push(`And ${items.length - CAP} more, listed in compare-full.md.`, '')
  }
}

// What the old build had to go on for a record it did not place: it placed
// an asserted distribution by its area's TaxonWorks country (level0), a
// gazetteer by the country before the colon in its name or by its ISO code,
// else by the DwC country text; a specimen by the DwC country text (git
// b5330ff, scripts/build-checklists.mjs countryOf).
function oldInput(item) {
  const [kind, id] = kindId(item.key)
  const row = rowsOf(kind, id).find((candidate) => candidate.otu_id === item.now.otu) ?? rowsOf(kind, id)[0]
  if (row?.association) return 'a distribution asserted for a biological association (no DwC record, so no DwC country)'
  const country = row?.country ? `DwC country ${row.country}` : 'no DwC country'
  if (kind !== 'AD') return country
  const shape = distributions.get(String(id))?.asserted_distribution_shape
  if (shape?.type === 'Gazetteer') return `a gazetteer with ${shape.iso_3166_a2 ? `ISO code ${shape.iso_3166_a2}` : 'no ISO code'}, ${country}`
  return `${shape?.level0_id ? `an area in TaxonWorks country GA ${shape.level0_id}` : 'an area without a TaxonWorks country'}, ${country}`
}
const oldInputNote = (items) => {
  const groups = groupBy(items, oldInput)
  return `What the old build had to go on: ${groups.map(([label, list]) => `${label} (${list.length})`).join('; ')}.`
}

const total = (status) => counts[status]
md.push('# Country checklists: old cache and new cache compared', '')
const oldIsEngine = oldIndex.countries.some((country) => country.file)
md.push(
  oldIsEngine
    ? `This report compares, record by record, two caches of the placement engine: the old one (built on ${oldIndex.updated}) and the new one (from TaxonWorks data downloaded on ${dataDate}, with the rules in modules/checklists/rules/placement.yml as they are now). Both store their states, so states are compared as stored. Changes of the explanation text alone do not count; only the checklist, part and state of a record do.`
    : `This report compares, record by record, the country checklists as they are online now (the old cache, built by the old hard-coded build from TaxonWorks data downloaded on ${oldIndex.updated} and committed on 2026-11-19) with the checklists the new placement engine builds (from TaxonWorks data downloaded on ${dataDate}, with the rules in modules/checklists/rules/placement.yml).`,
  '',
  oldIsEngine
    ? 'A record is one asserted distribution, specimen or field occurrence. For each one the report says whether it stays in the same checklist, moves to another, is newly placed, or is no longer placed; for France whether its part changed; for the checklists with states whether its state changed.'
    : 'A record is one asserted distribution, specimen or field occurrence. For each one the report says whether it stays in the same checklist, moves to another, is newly placed, or is no longer placed; for France whether its part (Corsica, Mainland France) changed; for the six countries with states whether its state changed. The old page worked states out while showing a country; that old result is reproduced here and compared with the state the new cache stores.',
  '',
  `Not every difference comes from the new rules: TaxonWorks itself changed between ${oldIndex.updated} and ${dataDate}. A record created in TaxonWorks after the old download is marked "new in TaxonWorks", one edited after it "edited in TaxonWorks" (by the dates TaxonWorks gives for the DwC record and the asserted distribution). A record of the old cache that is nowhere in the new data was deleted in TaxonWorks (or lost its DwC record). Every other change comes from the rules, and every changed record is shown with the steps that placed it now.`,
  ''
)
md.push('## Counts', '')
md.push('| | records |', '|---|---:|')
md.push(`| same checklist | ${total('same')} |`)
md.push(`| moved to another checklist | ${total('moved')} |`)
md.push(`| newly placed (not in the old cache) | ${total('newly placed')} |`)
md.push(`| of these, new in TaxonWorks since ${oldIndex.updated} | ${counts.newInTw} |`)
md.push(`| no longer placed (still in TaxonWorks) | ${total('no longer placed')} |`)
md.push(`| gone from TaxonWorks (in the old cache, not in the new data) | ${counts.gone} |`)
md.push(`| part changed (France, same checklist) | ${counts.partChanged} |`)
md.push(`| state changed (same checklist) | ${counts.stateChanged} |`)
md.push('')
md.push(`Old cache: ${plural([...byKey.values()].reduce((n, slotOf) => n + slotOf.olds.length, 0), 'record')} in ${oldIndex.countries.length} checklists. New cache: ${plural([...byKey.values()].reduce((n, slotOf) => n + slotOf.news.length, 0), 'record')} in ${newIndex.countries.length} checklists, ${plural(newIndex.unplaced.records, 'record')} not placed (old: ${oldIndex.unplaced.records}).`, '')
for (const lines of [full]) lines.push('# Country checklists compared: every changed record', '', 'The full lists behind compare.md, same order.', '')

section('Moved', groupBy(moved, (item) => `${item.old.oldName} to ${item.now.checklist}`), {
  intro: 'Records that are in a different checklist now. The text under each record is how the new build placed it.'
})
const decidedBy = (item) => {
  const step = item.placement && decidingStep(item.placement)
  return step ? `${step.source}: ${step.text} (${item.now.checklist})` : `${item.now.checklist}`
}
section('Newly placed, by the step that decided the checklist', groupBy(newlyPlaced.filter((item) => !item.tw.created), decidedBy), {
  intro: 'Records that were in TaxonWorks before but in no checklist of the old cache. The old build placed an asserted distribution by the country TaxonWorks gives its area, a gazetteer by the country in its name or its ISO code, and otherwise (and every specimen) by the DwC country text, matched to the name of a TaxonWorks country area only. The note under each heading says what the old build had to go on for these records, which is why it could not place them. The text under each record is how the new build placed it.',
  note: oldInputNote
})
section(`Newly placed, new in TaxonWorks since ${oldIndex.updated}`, groupBy(newlyPlaced.filter((item) => item.tw.created), (item) => item.now.checklist), {
  intro: 'Records created in TaxonWorks after the old download, so the old cache could not have them. Here only their ids, by checklist; their placement texts are in compare-full.md.',
  compact: true
})
section('No longer placed, by reason', groupBy(noLonger, (item) => `${item.reason} (was in ${item.old.oldName})`), {
  intro: 'Records still in TaxonWorks that the new build leaves out of every checklist.'
})
section('Part changed (France)', groupBy(partChanges, (item) => `${item.old.part || 'no part'} to ${item.now.part || 'no part'}`))
// A checklist no longer browsed by state (index.json `states` false, R50):
// all its records lose their state, listed as one group.
const statesNow = new Map(newIndex.countries.map((country) => [country.name, country.states]))
// R51: Natural Earth names no longer decide a state. An old engine cache says
// so in areas.json (a step with source "Natural Earth"); for a specimen, its
// old state was the one its stateProvince names only as a Natural Earth alias.
const oldAreasFile = join(oldDir, 'areas.json')
const aliasAreas = new Set(existsSync(oldAreasFile)
  ? readJson(oldAreasFile).filter((row) => row.placement?.steps?.some((step) => step.source === 'Natural Earth')).map((row) => row.key)
  : [])
const subdivisionFeatures = existsSync(oldSubdivisions) ? readJson(oldSubdivisions).features : []
const ignoredWords = context.rules.ignoredNameWords?.words ?? []
const aliasIndexes = new Map()
function byAliasOnly(record, checklist, state) {
  if (!aliasIndexes.has(checklist)) {
    const features = subdivisionFeatures.filter((feature) => feature.properties.country === checklist)
    aliasIndexes.set(checklist, {
      withAliases: buildSubdivisionIndex(features, ignoredWords),
      names: stateIndex(features.map((feature) => ({ name: feature.properties.name })), ignoredWords)
    })
  }
  const { withAliases, names } = aliasIndexes.get(checklist)
  const province = record.stateProvince
  return Boolean(province) && matchSubdivision(withAliases, province)?.state === state && !matchSubdivision(names, province)
}
function r51(item) {
  if (!oldIsEngine || !item.old.state) return null
  const [kind, id] = kindId(item.key)
  if (kind === 'AD') {
    const ad = distributions.get(String(id))
    const key = ad?.asserted_distribution_shape ? `${ad.asserted_distribution_shape_type === 'Gazetteer' ? 'GZ' : 'GA'} ${ad.asserted_distribution_shape.id}` : null
    return key && aliasAreas.has(key) ? 'asserted distributions' : null
  }
  return byAliasOnly(item.old.record, item.now.checklist, item.old.state) ? 'specimens and field occurrences' : null
}
const stateLabel = (item) => {
  if (statesNow.get(item.now.checklist) === false && !item.now.state) {
    return `${item.now.checklist}: no states any more (no longer in state_countries, R50), every state dropped`
  }
  const cause = r51(item)
  if (cause) return `R51, Natural Earth names no longer decide the state: ${cause}`
  return `${item.now.checklist}: ${item.old.state || 'no state'} to ${item.now.state || 'no state'}`
}
section('State changed', groupBy(stateChanges, stateLabel), {
  intro: 'Records that stay in their checklist but are shown under another state (or under a state for the first time). The old state is what the old page worked out from stateProvince, the place name of the distribution and the county.'
})

md.push('## Gone from TaxonWorks', '')
full.push('## Gone from TaxonWorks', '')
if (!gone.length) md.push('None.', '')
for (const [label, items] of groupBy(gone, (item) => item.old.oldName)) {
  const line = `- ${label}: ${items.map((item) => kindId(item.key).join(' ')).join(', ')}`
  md.push(line)
  full.push(line)
}
md.push('')

md.push('## Records in several checklists', '')
if (!severalChecklists.length) md.push('None: every record is in one checklist only.', '')
for (const { key, old, now } of severalChecklists) {
  md.push(`- ${kindId(key).join(' ')}: now in ${now.join(', ')}; before in ${old.join(', ') || 'none'}${old.length > 1 ? '' : ' (NEW: was in one checklist only)'}`)
}
md.push('')

md.push('## Checklists', '')
md.push(`### Names changed: ${renames.length}`, '')
for (const { from, to } of renames) md.push(`- ${from} is now called ${to}`)
md.push('', `### Checklists added: ${added.length}`, '')
for (const country of added) md.push(`- ${country.name} (${plural(country.records, 'record')}, file ${country.file})`)
md.push('', `### Checklists removed: ${removed.length}`, '')
for (const country of removed) md.push(`- ${country.name} (${plural(country.records, 'record')}, old file ${country.id}.json)`)
md.push('', '### Files', '')
md.push(oldIsEngine
  ? `Both caches name their files by checklist (countries/france.json); ${plural(fileRenames.filter(({ from, to }) => from !== to).length, 'file')} renamed.`
  : `Every country file is renamed: the old files are named by a TaxonWorks area id (countries/77.json), the new ones by the checklist name (countries/france.json). ${plural(fileRenames.length, 'file')} map one to one; the full list is in compare-full.md.`, '')
full.push('## File renames', '', '| checklist | old file | new file |', '|---|---|---|')
for (const { name, from, to } of fileRenames) full.push(`| ${name} | ${from} | ${to} |`)
full.push('')

// Hand-written questions for the curator, kept beside the report (they belong
// to the comparison with the old hard-coded build).
const questions = join(MODULE, '.cache/compare-questions.md')
if (!oldIsEngine && existsSync(questions)) md.push(readFileSync(questions, 'utf8').trim(), '')

writeFileSync(OUT, md.join('\n'))
writeFileSync(OUT_FULL, full.join('\n'))
console.log(`same ${counts.same}, moved ${counts.moved}, newly placed ${counts['newly placed']} (new in TaxonWorks ${counts.newInTw}), no longer placed ${counts['no longer placed']}, gone ${counts.gone}, part changed ${counts.partChanged}, state changed ${counts.stateChanged}`)
console.log(`written ${OUT} and ${OUT_FULL}`)
