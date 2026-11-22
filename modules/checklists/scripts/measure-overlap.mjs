#!/usr/bin/env node
// Measure which country (and which state) the outline of an area lies in, and
// write the result as rules into the `overlap:` section of the rules file.
//
// Purpose: TaxonWorks gives no country for TDWG areas and for gazetteers
// without ISO code, and no state for areas whose name is no state name
// (Hawaiian islands, IBRA bioregions, TDWG regions of Russia). The placement
// engine then needs an overlap rule. This script measures, on the cached
// outlines, how each such area is shared among the checklist outlines (or
// among the state outlines of its country) and appends one rule per area.
// It is slow (it tests many points against many outlines), so it only
// measures areas that have no rule yet; the build never measures.
//
// Usage
//   npm run checklists:measure -- [--from <dir>] [--recheck] [--dry-run]
//   --from <dir>  saved TaxonWorks data (default modules/checklists/.cache/data):
//                 <dir>/distributions.json, the asserted distributions as the API
//                 returns them (with asserted_distribution_shape), and optionally
//                 <dir>/dwc_occurrences.csv, whose country text names countries
//                 TaxonWorks uses only through their subdivisions (Spain)
//   --recheck     re-measure the existing overlap rules and print those whose top
//                 share moved by more than 5 points; never edits the file
//   --dry-run     print the rules that would be appended, do not write them
//
// Inputs besides --from: modules/checklists/rules/placement.yml, the cached
// outlines in public/map-shapes/, public/checklists/fallback-shapes.geojson,
// public/checklists/subdivisions.geojson.
//
// What gets measured (only areas some distribution uses, and only when no
// manual or overlap rule decides them yet; the placement engine says which):
//   country  an area the engine leaves "not measured yet": TDWG areas and
//            gazetteers without ISO code that no rule, own checklist or
//            TaxonWorks country places. Measured against every checklist
//            outline (geometry-node.mjs). The top share is >= 90% of the land
//            samples: `subdivision_of: { country }`; else
//            `not_placeable: spans several countries`.
//   state    an area placed in a checklist with states (United States, Canada,
//            Australia, China, Russia, United Kingdom) whose own or parent name
//            is no state name and that is not the whole country (the engine's
//            step "no state: not measured yet"), gazetteers with ISO code
//            included (Hawaiian islands). Measured against the state outlines
//            of that checklist. >= 90%: `subdivision_of: { country, state }`;
//            else `not_placeable: spans several states` (engine.js
//            SEVERAL_STATES), which never decides the country.
// Samples outside every outline (sea, land without outline) do not count, so
// shares are shares of land. An area with no land sample at all gets a rule
// that says so: `not_placeable: outside every checklist outline` (engine.js
// OUTSIDE_CHECKLISTS) for the country, `not_placeable: outside every state
// outline` (OUTSIDE_STATES, which never decides the country) for the state;
// its `measured` text has no share ("no sample in any outline"). Areas
// without a cached outline, or whose outline holds no polygon (a Point
// gazetteer), get no rule and are printed; the engine gives them the reason
// "no outline" or "no usable outline (no polygon)" by itself.
//
// Output: rules appended to the end of the overlap section, never anything
// else changed, so line references to other rules stay valid. Each rule:
//   - match: { tdwg: 14RUC }   # GA 33876 Central European Russia (TDWG Level 3 14RUC), 124 records
//     subdivision_of: { country: "Russia" }
//     measured: "Russia 100% (2026-11-20)"
// `measured` holds the top four shares, rounded, and the local date. A TDWG
// area is matched by its TDWG code, any other by its area key ("GZ 10453").
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { compileRules } from '../placement/rules.js'
import { toArea, normalizeName } from '../placement/areas.js'
import { deriveChecklists } from '../placement/checklists.js'
import { createContext, placeArea, placeRecord, SEVERAL_STATES, OUTSIDE_STATES, OUTSIDE_CHECKLISTS } from '../placement/engine.js'
import { toleranceOf } from '../placement/geometry.js'
import { createNodeGeometry, measureShares, listShapes, unusableOutlines } from './geometry-node.mjs'
import { parseTsv, level0NamesFrom } from './download.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MODULE = join(ROOT, 'modules/checklists/')
const RULES_FILE = join(MODULE, 'rules/placement.yml')
const THRESHOLD = 90
const RECHECK_POINTS = 5

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const fromDir = resolve(option('--from') ?? join(MODULE, '.cache/data'))
const recheck = args.includes('--recheck')
const dryRun = args.includes('--dry-run')

const started = Date.now()
const distributionsFile = join(fromDir, 'distributions.json')
if (!existsSync(distributionsFile)) {
  console.error(`No ${distributionsFile}. Save the TaxonWorks data first (npm run checklists -- --save <dir>) or pass --from <dir>.`)
  process.exit(1)
}
const distributions = JSON.parse(readFileSync(distributionsFile, 'utf8'))

// Every used area, with its number of distributions.
const areas = new Map()
const records = new Map()
for (const ad of distributions) {
  if (!ad.asserted_distribution_shape) continue
  const area = toArea(ad.asserted_distribution_shape_type, ad.asserted_distribution_shape)
  if (!areas.has(area.key)) areas.set(area.key, area)
  records.set(area.key, (records.get(area.key) ?? 0) + 1)
}
const ordered = [...areas.values()].sort((a, b) => records.get(b.key) - records.get(a.key) || a.key.localeCompare(b.key))

const csvFile = join(fromDir, 'dwc_occurrences.csv')
if (!existsSync(csvFile)) console.warn(`no ${csvFile}: countries used only through their subdivisions get no checklist`)
// Names of countries used only through their subdivisions, as the build finds them.
const level0Names = existsSync(csvFile) ? level0NamesFrom(parseTsv(readFileSync(csvFile, 'utf8')), distributions) : new Map()
const shapeDir = join(ROOT, 'public/map-shapes')
const shapes = listShapes(shapeDir)

// Rules, checklists, geometry and engine context for a rules text.
function setUp(text) {
  const rules = compileRules(text)
  const { checklists } = deriveChecklists([...areas.values()], rules, level0Names)
  const geometry = createNodeGeometry({
    shapeDir,
    fallbackFile: join(ROOT, 'public/checklists/fallback-shapes.geojson'),
    subdivisionsFile: join(ROOT, 'public/checklists/subdivisions.geojson'),
    checklists,
    rules
  })
  const unusable = unusableOutlines(areas.values(), shapes, geometry)
  const outlines = new Map(geometry.checklistTargets().map(({ id, outline }) => [id, outline]))
  const near = toleranceOf(rules)
  return { rules, checklists, geometry, near, ctx: createContext({ checklists, rules, geometry, shapes, unusable, outlines }) }
}

const originalText = readFileSync(RULES_FILE, 'utf8')
if (recheck) {
  await runRecheck(setUp(originalText))
} else {
  await runMeasure()
}

async function runMeasure() {
  const date = new Date().toLocaleDateString('sv-SE')
  const noOutline = []
  const outside = []
  const written = new Set()
  const counts = { country: 0, severalCountries: 0, state: 0, severalStates: 0, outside: 0 }
  let measuredCountry = 0
  let measuredState = 0

  // Pass 1: countries.
  let setup = setUp(originalText)
  const countryLines = []
  for (const area of ordered) {
    const placement = placeArea(area, setup.ctx)
    if (placement.checklist) continue
    if (placement.reason === 'no outline' || placement.reason.startsWith('no usable outline')) { noOutline.push(`${describe(area)} (country, ${placement.reason})`); continue }
    if (placement.reason !== 'not measured yet') continue
    const polygons = setup.geometry.areaPolygons(area.kind, area.id)
    if (!polygons) { noOutline.push(`${describe(area)} (country)`); continue }
    measuredCountry += 1
    const { shares } = measureShares(polygons, setup.geometry.checklistTargets(), { near: setup.near })
    const match = matchOf(area)
    if (written.has(`country ${match}`)) continue
    written.add(`country ${match}`)
    if (!shares.length) {
      outside.push(`${describe(area)}: ${OUTSIDE_CHECKLISTS}`)
      counts.outside += 1
      countryLines.push(...ruleLines(area, match, `not_placeable: ${OUTSIDE_CHECKLISTS}`, shares, date))
      continue
    }
    const [top, pct] = shares[0]
    const action = pct >= THRESHOLD
      ? `subdivision_of: { country: ${quote(top)} }`
      : 'not_placeable: spans several countries'
    counts[pct >= THRESHOLD ? 'country' : 'severalCountries'] += 1
    countryLines.push(...ruleLines(area, match, action, shares, date))
  }

  // Pass 2: states, with the country rules of pass 1 in place.
  setup = setUp(appendToOverlap(originalText, countryLines))
  const stateLines = []
  for (const area of ordered) {
    const decision = placeArea(area, setup.ctx)
    const checklist = decision.checklist && setup.ctx.byId.get(decision.checklist.id)
    if (!checklist?.states) continue
    const placement = await placeRecord({ type: 'AssertedDistribution', id: 0 }, setup.ctx, area)
    if (!placement.steps.some((step) => step.text === 'no state: not measured yet')) continue
    const targets = setup.geometry.stateTargets(checklist.id)
    if (!targets.length) continue
    const polygons = setup.geometry.areaPolygons(area.kind, area.id)
    if (!polygons) { noOutline.push(`${describe(area)} (state in ${checklist.name})`); continue }
    measuredState += 1
    const { shares } = measureShares(polygons, targets, { near: setup.near })
    const match = matchOf(area)
    if (written.has(`state ${match}`)) continue
    written.add(`state ${match}`)
    if (!shares.length) {
      outside.push(`${describe(area)}: ${OUTSIDE_STATES} of ${checklist.name}`)
      counts.outside += 1
      stateLines.push(...ruleLines(area, match, `not_placeable: ${OUTSIDE_STATES}`, shares, date))
      continue
    }
    const [top, pct] = shares[0]
    const action = pct >= THRESHOLD
      ? `subdivision_of: { country: ${quote(checklist.name)}, state: ${quote(top)} }`
      : `not_placeable: ${SEVERAL_STATES}`
    counts[pct >= THRESHOLD ? 'state' : 'severalStates'] += 1
    stateLines.push(...ruleLines(area, match, action, shares, date))
  }

  const lines = [...countryLines, ...stateLines]
  const text = appendToOverlap(originalText, lines)
  compileRules(text) // never write a file the engine cannot read
  if (lines.length && !dryRun) writeFileSync(RULES_FILE, text)
  if (dryRun && lines.length) console.log(lines.join('\n'))

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`${areas.size} used areas; measured ${measuredCountry} for their country, ${measuredState} for their state`)
  console.log(`rules ${dryRun ? 'that would be ' : ''}written: ${counts.country} subdivision_of country, ${counts.severalCountries} spans several countries, ` +
    `${counts.state} subdivision_of state, ${counts.severalStates} spans several states, ${counts.outside} outside every outline`)
  if (outside.length) console.log(`outside every outline (${outside.length}):\n  ${outside.join('\n  ')}`)
  if (noOutline.length) console.log(`no rule, no usable cached outline (${noOutline.length}):\n  ${noOutline.join('\n  ')}`)
  console.log(`done in ${seconds} s`)
}

// Re-measure every overlap rule; print the ones whose top share moved.
async function runRecheck({ rules, geometry, ctx, near }) {
  let checked = 0
  const moved = []
  const skipped = []
  for (const rule of rules.overlap) {
    const area = ordered.find((candidate) => matches(rule.match, candidate))
    if (!area) { skipped.push(`${rule.ref}: no used area matches`); continue }
    const polygons = geometry.areaPolygons(area.kind, area.id)
    if (!polygons) { skipped.push(`${rule.ref}: ${describe(area)} has no cached outline`); continue }
    const forState = Boolean(rule.action.subdivisionOf?.state) ||
      normalizeName(rule.action.notPlaceable).startsWith(normalizeName(SEVERAL_STATES)) ||
      normalizeName(rule.action.notPlaceable).startsWith(normalizeName(OUTSIDE_STATES))
    let targets = geometry.checklistTargets()
    if (forState) {
      const country = rule.action.subdivisionOf?.country
      const checklist = country ? ctx.byName.get(normalizeName(country)) : placeArea(area, ctx).checklist
      targets = checklist ? geometry.stateTargets(checklist.id) : []
    }
    if (!targets.length) { skipped.push(`${rule.ref}: no outlines to measure against`); continue }
    checked += 1
    const { shares } = measureShares(polygons, targets, { near })
    const old = /^(.*?)\s+(\d+(?:\.\d+)?)\s*%/.exec(rule.measured ?? '')
    if (!old) { skipped.push(`${rule.ref}: no measured share to compare`); continue }
    const [, oldName, oldPct] = old
    const now = shares.find(([name]) => name === oldName)?.[1] ?? 0
    if (Math.abs(now - Number(oldPct)) > RECHECK_POINTS) {
      moved.push(`${rule.ref} ${describe(area)}: was "${rule.measured}", now "${sharesText(shares)}"`)
    }
  }
  console.log(`${checked} overlap rules re-measured, ${moved.length} moved by more than ${RECHECK_POINTS} points`)
  if (moved.length) console.log(`  ${moved.join('\n  ')}`)
  if (skipped.length) console.log(`not re-measured (${skipped.length}):\n  ${skipped.join('\n  ')}`)
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s; the rules file was not changed`)
}

// The three lines of one rule.
function ruleLines(area, match, action, shares, date) {
  return [
    `  - match: ${match}   # ${describe(area)}, ${records.get(area.key)} ${records.get(area.key) === 1 ? 'record' : 'records'}`,
    `    ${action}`,
    `    measured: ${quote(`${sharesText(shares)} (${date})`)}`
  ]
}

// 'Indonesia 72%, Malaysia 28%, Brunei 1%': the top four shares, rounded;
// 'no sample in any outline' when there is none.
function sharesText(shares) {
  if (!shares.length) return 'no sample in any outline'
  return shares.slice(0, 4).map(([name, pct]) => `${name} ${Math.round(pct)}%`).join(', ')
}

// `{ tdwg: 14RUC }` for a TDWG area, else `{ area: "GZ 10453" }`.
function matchOf(area) {
  return area.tdwg ? `{ tdwg: ${area.tdwg} }` : `{ area: ${quote(area.key)} }`
}

// Does a rule's match fit the area? (as engine.js ruleMatches)
function matches(match, area) {
  if (match.area && match.area !== area.key) return false
  if (match.tdwg && match.tdwg !== area.tdwg) return false
  if (match.iso2 && match.iso2.toUpperCase() !== (area.iso2 ?? '').toUpperCase()) return false
  if (match.gazetteerPrefix &&
    !(area.kind === 'GZ' && normalizeName(area.name).startsWith(normalizeName(match.gazetteerPrefix)))) return false
  return true
}

// 'GA 33876 Central European Russia (TDWG Level 3 14RUC)', 'GZ 10453 Hawai'i: Kaua'i'.
function describe(area) {
  if (!area.tdwg) return `${area.key} ${area.name}`
  const level = /^TDWG /.test(area.type ?? '') ? area.type : 'TDWG'
  return `${area.key} ${area.name} (${level} ${area.tdwg})`
}

function quote(value) {
  return JSON.stringify(String(value))
}

/**
 * The rules text with lines appended at the end of the overlap section (before
 * the next top-level section, if any, and before trailing blank lines).
 * Nothing else changes, so every other line keeps its number.
 * @param {string} text  the rules file
 * @param {string[]} lines
 * @returns {string}
 */
function appendToOverlap(text, lines) {
  if (!lines.length) return text
  const all = text.split('\n')
  const start = all.findIndex((line) => /^overlap:\s*(#.*)?$/.test(line))
  if (start < 0) throw new Error('the rules file has no overlap: section')
  let end = all.findIndex((line, index) => index > start && /^[A-Za-z_]+:/.test(line))
  if (end < 0) end = all.length
  while (end - 1 > start && all[end - 1].trim() === '') end -= 1
  return [...all.slice(0, end), ...lines, ...all.slice(end)].join('\n')
}
