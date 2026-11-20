// Pure helpers that shape what the checklist build writes to public/checklists/.
//
// Purpose: build.mjs places records and counts taxa; these functions turn its
// results into the JSON written to disk: checklist keys and file names, the
// `checklist` header of every country file (what the checklist is made of and
// how its records got there), index.json entries, the unplaced.json grouping,
// and placements without numeric checklist ids. No file system, no network,
// so each is tested on its own (cacheFiles.test.js).
//
// Every checklist is known by its key, the slug of its name (checklistKey):
// country files are countries/<key>.json, index.json and taxa.json use the
// key, and no numeric id appears anywhere in public/checklists/ except in
// context.json, which holds the engine's own checklists (ids included) for the
// curator page (cacheContext).
import { normalizeName } from '../placement/areas.js'
import { formatStep, decidingStep } from '../placement/format.js'

export { decidingStep }

/** The rules file, as the country file header names it. */
export const RULES_PATH = 'modules/checklists/rules/placement.yml'

/**
 * The key of a checklist: its name normalized (accents removed, lower case,
 * other characters as one space, see normalizeName), spaces as hyphens.
 * @param {string} name
 * @returns {string}  'French Guiana' gives 'french-guiana', 'Réunion' gives 'reunion'
 */
export function checklistKey(name) {
  return normalizeName(name).replace(/ /g, '-')
}

/**
 * The key of every checklist, by checklist id.
 * @param {{ id: number|string, name: string }[]} checklists
 * @returns {Map<number|string, string>}
 * @throws {Error} when two checklists get the same key, naming both
 */
export function assignKeys(checklists) {
  const keys = new Map()
  const owner = new Map()
  for (const checklist of checklists) {
    const key = checklistKey(checklist.name)
    if (owner.has(key)) throw new Error(`checklists "${owner.get(key)}" and "${checklist.name}" both get the key "${key}"`)
    owner.set(key, checklist.name)
    keys.set(checklist.id, key)
  }
  return keys
}

/**
 * unplaced.json: record ids by reason, the most frequent reason first, the ids
 * of a reason sorted by kind, then id.
 * @param {{ reason: string, kind: string, id: number }[]} entries  kind: 'AD', 'CO' or 'FO'
 * @returns {Object<string, Array<[string, number]>>}
 */
export function groupUnplaced(entries) {
  const byReason = new Map()
  for (const { reason, kind, id } of entries) {
    if (!byReason.has(reason)) byReason.set(reason, [])
    byReason.get(reason).push([kind, id])
  }
  const sorted = [...byReason].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'en'))
  return Object.fromEntries(sorted.map(([reason, ids]) => [
    reason, ids.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1])
  ]))
}

/**
 * Bounding box of an outline, rounded to 4 decimals (about 10 m).
 * @param {Array<Array<Array<[number, number]>>> | null} polygons  as geometry-node.mjs polygonsOf
 * @returns {[number, number, number, number] | null}  [west, south, east, north], null without points
 */
export function bboxOf(polygons) {
  const box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const polygon of polygons ?? []) {
    for (const [lng, lat] of polygon?.[0] ?? []) {
      box[0] = Math.min(box[0], lng); box[1] = Math.min(box[1], lat)
      box[2] = Math.max(box[2], lng); box[3] = Math.max(box[3], lat)
    }
  }
  if (!Number.isFinite(box[0])) return null
  return box.map((value) => Math.round(value * 1e4) / 1e4)
}

/**
 * `defined_by` of the country file header: the TaxonWorks areas the checklist
 * is made of, each with why it belongs.
 * @param {import('../placement/checklists.js').Checklist} checklist
 * @param {Object} lookups
 * @param {Map<number, import('../placement/areas.js').Area>} lookups.areasById  every used GA area;
 *   areas known only as a parent may be given as { key, name, stub: true } for their name
 * @param {Map<number, string>} lookups.level0Names  names of countries used only through subdivisions
 * @param {import('../placement/rules.js').CompiledRules} lookups.rules
 * @returns {{ area: string|null, name: string|null, how: string }[]}
 */
export function definedBy(checklist, { areasById, level0Names, rules }) {
  if (checklist.ref) {
    const how = `listed in the checklist entry [manual, ${checklist.ref}]`
    if (!checklist.areaIds.length) {
      const entry = rules.checklists.find((candidate) => candidate.name === checklist.name)
      return [{ area: null, name: checklist.name, how: `checklist entry, by ISO code ${entry?.iso2 ?? '?'} and names [manual, ${checklist.ref}]` }]
    }
    return checklist.areaIds.map((id) => ({ area: `GA ${id}`, name: areasById.get(id)?.name ?? null, how }))
  }
  return checklist.areaIds.map((id) => {
    const area = areasById.get(id)
    if (!area || area.stub) {
      const name = level0Names.get(id) ?? area?.name ?? null
      const how = name ? 'country of its subdivisions, named by their DwC country [TaxonWorks]' : 'country area [TaxonWorks]'
      return { area: `GA ${id}`, name, how }
    }
    let how = 'country area [TaxonWorks]'
    if (normalizeName(area.name) !== normalizeName(checklist.name)) {
      const synonym = rules.synonyms.find(({ names }) =>
        names.some((n) => normalizeName(n) === normalizeName(area.name)) &&
        names.some((n) => normalizeName(n) === normalizeName(checklist.name)))
      if (synonym) how = `country area, a spelling of ${checklist.name} [manual, ${synonym.ref}]`
      else if (area.parentName && normalizeName(area.parentName) !== 'earth') how = `country area under ${area.parentName} [TaxonWorks]`
    }
    return { area: area.key, name: area.name, how }
  })
}

/**
 * `areas_used` of the country file header: every area some record of the file
 * points to, in first-seen order, with its record count and the first step of
 * its decision (text and source tag).
 * @param {{ area: import('../placement/areas.js').Area, placement: import('../placement/engine.js').Placement }[]} entries
 *   one per asserted distribution in the file
 * @returns {{ area: string, name: string, kind: string|null, records: number, how: string }[]}
 */
export function areasUsed(entries) {
  const rows = new Map()
  for (const { area, placement } of entries) {
    if (!rows.has(area.key)) {
      rows.set(area.key, {
        area: area.key,
        name: area.name,
        kind: area.kind === 'GZ' ? 'Gazetteer' : area.type,
        records: 0,
        how: placement.steps[0] ? formatStep(placement.steps[0]) : ''
      })
    }
    rows.get(area.key).records += 1
  }
  return [...rows.values()]
}

const SPECIMEN_WAYS = [
  ['by DwC country', 'TaxonWorks', (step) => step.source === 'TaxonWorks' && step.text.startsWith('DwC country')],
  ['by a name of the checklist entry', 'manual', (step) => step.source === 'manual'],
  ['by coordinates inside the outline', 'overlap', (step) => step.source === 'overlap']
]

/**
 * `specimens` of the country file header: the number of specimens and field
 * occurrences in the file, and how many were placed which way (by the first
 * step of their decision).
 * @param {import('../placement/engine.js').Placement[]} placements
 * @returns {{ records: number, how: string }}
 */
export function specimensSummary(placements) {
  if (!placements.length) return { records: 0, how: 'none' }
  const counts = new Map()
  for (const placement of placements) {
    const step = placement.steps[0]
    const way = SPECIMEN_WAYS.find(([, , test]) => step && test(step))
    const label = way ? `${way[0]} COUNT [${way[1]}]` : 'otherwise COUNT'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const order = [...SPECIMEN_WAYS.map(([name, source]) => `${name} COUNT [${source}]`), 'otherwise COUNT']
  const how = order.filter((label) => counts.has(label)).map((label) => label.replace('COUNT', counts.get(label))).join(', ')
  return { records: placements.length, how }
}

/**
 * The `checklist` header at the start of a country file.
 * @param {Object} input
 * @param {string} input.key
 * @param {string} input.name
 * @param {string} input.iso2
 * @param {string|null} input.outline  'GeographicArea/32253', 'fallback/Spain' or null
 * @param {ReturnType<typeof definedBy>} input.definedBy
 * @param {ReturnType<typeof areasUsed>} input.areasUsed
 * @param {ReturnType<typeof specimensSummary>} input.specimens
 * @param {string} input.built  local build date, YYYY-MM-DD
 * @returns {Object}  keys key, name, iso2, outline, defined_by, areas_used, specimens, built, rules
 */
export function checklistHeader({ key, name, iso2, outline, definedBy, areasUsed, specimens, built }) {
  return { key, name, iso2, outline, defined_by: definedBy, areas_used: areasUsed, specimens, built, rules: RULES_PATH }
}

/**
 * One checklist of index.json. `file` is the name of its file in countries/;
 * `of` (own checklists only) names the country TaxonWorks files it under, so
 * the page can cut its outline out of that country's (French Guiana from France).
 * `fallback` (only when `shape` is null and fallback-shapes.geojson has an
 * outline for it) is the name of that outline's feature, which may be spelled
 * like a synonym of the checklist ("Saint Barthelemy" for Saint Barthélemy).
 * @param {{ key: string, name: string, iso2: string, of?: string, shape: string|null, fallback?: string|null,
 *   bbox: number[]|null, parts?: { name: string, shape: string|null }[], states: boolean, taxa: number,
 *   records: number }} input
 * @returns {Object}
 */
export function indexEntry({ key, name, iso2, of, shape, fallback, bbox, parts, states, taxa, records }) {
  return {
    key, file: `${key}.json`, name, iso2, ...(of ? { of } : {}), shape, ...(fallback ? { fallback } : {}),
    bbox, ...(parts ? { parts } : {}), states, taxa, records
  }
}

/**
 * context.json: everything the placement engine needs besides rules.json, so
 * the curator page (placement/geometry-browser.js, loadCacheContext) decides
 * exactly as the build did: the engine checklists as deriveChecklists made
 * them, the outline standing for each (GeographicArea/<id> or
 * fallback/<feature name>) with its bbox, every cached outline key, and the
 * cached outlines of used areas that hold no polygon.
 * @param {{ built: string, checklists: import('../placement/checklists.js').Checklist[],
 *   targets: { id: number|string, outline: string, polygons: any[] }[], shapes: Set<string>,
 *   unusable?: Set<string>, stateAreas?: Map<number|string, Object[]> }} input
 *   stateAreas: per checklist with states, the areas placed there (engine.js stateAreasOf),
 *   written as { [checklist id]: Area[] }
 *   targets: the Node geometry's checklistTargets(), in checklist order
 * @returns {{ built: string, checklists: Object[], outlines: { id: number|string, outline: string, bbox: number[]|null }[],
 *   shapes: { GeographicArea: number[], Gazetteer: number[] }, unusable: { GeographicArea: number[], Gazetteer: number[] } }}
 */
export function cacheContext({ built, checklists, targets, shapes, unusable = new Set(), stateAreas = new Map() }) {
  return {
    built,
    checklists,
    outlines: targets.map(({ id, outline, polygons }) => ({ id, outline, bbox: bboxOf(polygons) })),
    shapes: byKind(shapes),
    unusable: byKind(unusable),
    stateAreas: Object.fromEntries(stateAreas)
  }
}

// Outline keys as { GeographicArea: [ids], Gazetteer: [ids] }, ids sorted.
function byKind(keys) {
  const out = { GeographicArea: [], Gazetteer: [] }
  for (const key of keys) {
    const [kind, id] = key.split('/')
    out[kind]?.push(Number(id))
  }
  for (const ids of Object.values(out)) ids.sort((a, b) => a - b)
  return out
}

/**
 * A placement as written to areas.json: the checklist by key and name.
 * @param {import('../placement/engine.js').Placement} placement
 * @param {Map<number|string, string>} keys  from assignKeys
 * @returns {Object}
 */
export function publicPlacement(placement, keys) {
  const { checklist } = placement
  return { ...placement, checklist: checklist ? { key: keys.get(checklist.id), name: checklist.name } : null }
}

/**
 * The source that decided the checklist of a placed record, for the build's
 * summary: the source of decidingStep (format.js).
 * @param {import('../placement/engine.js').Placement} placement  a placed one
 * @returns {'TaxonWorks'|'manual'|'overlap'|null}
 */
export function decidingSource(placement) {
  return decidingStep(placement)?.source ?? null
}

/**
 * The outline of every part of a checklist (index.json `parts`): the first of
 * its GA areas with a cached outline, null when none is cached (the build
 * warns about those, as the page skips a part without outline).
 * @param {{ name: string, areas: string[] }[]} parts  rules.parts of one country
 * @param {Set<string>} shapes  cached outline keys, 'GeographicArea/34185'
 * @returns {{ name: string, shape: string|null }[]}
 */
export function partShapes(parts, shapes) {
  return parts.map((part) => {
    const key = part.areas.filter((area) => area.startsWith('GA ')).map((area) => `GeographicArea/${area.slice(3)}`)
      .find((candidate) => shapes.has(candidate))
    return { name: part.name, shape: key ?? null }
  })
}

