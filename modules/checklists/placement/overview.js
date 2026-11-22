// Overviews for the curator page: the area tree, the unplaced records grouped
// by reason, and the one-line summary of an OTU's distributions.
//
// Purpose: below the lookup, the curator page (CuratorPage.vue) lists every
// area the cache knows (components/AreaTree.vue), every record the cache could
// not place (components/UnplacedList.vue) and the distributions of one OTU
// (components/OtuPlacements.vue), so a curator can find problems to fix in
// TaxonWorks or in the rules file. These functions shape the cache files for
// those lists; the components only render and fetch.
//
// Input:  rows of public/checklists/areas.json ({ key, name, origin, type,
//         tdwg, iso2, parentId, parentName, records, placement }; parent stubs
//         have records 0 and placement null), unplaced.json ({ [reason]:
//         [[kind, id], ...] }) and Placements (engine.js; in areas.json the
//         checklist is { key, name }).
// Output: plain objects and strings, see each function.
// Pure and browser-safe: no network, no file system.
import { normalizeName } from './areas.js'
import { decidingStep, sourceTag } from './format.js'

/** The three roots of the area tree, in this order. */
export const ROOTS = ['Political', 'TDWG', 'Gazetteers']

/**
 * @typedef {Object} AreaRow  one row of areas.json
 * @property {string} key  'GA 32253' or 'GZ 3549'
 * @property {string} name
 * @property {string|null} origin  TaxonWorks data_origin ('tdwg_l3', 'ne_states', 'gadm', ...)
 * @property {number|null} parentId  the parent GA id
 * @property {string[]} [ancestors]  the keys above the area, top first (R44)
 * @property {number} records  records on the area (0 for a parent stub)
 * @property {Object|null} placement  the area's Placement, null for a parent stub
 *
 * @typedef {Object} TreeNode
 * @property {string} key
 * @property {string} name
 * @property {AreaRow|null} row  null for a group node
 * @property {boolean} [group]  a group of gazetteers with one ISO code ('ISO AU')
 * @property {boolean} stub  known only as a parent: used by no record
 * @property {TreeNode[]} children  sorted by name, then key
 * @property {number} problems  problem areas in this subtree, itself included
 * @property {boolean} [open]  set by filterTree on nodes shown open
 *
 * @typedef {{ name: string, nodes: TreeNode[], count: number, problems: number }} TreeRoot
 *   count: the areas of the root used by records (stubs not counted)
 */

const isStub = (row) => !row.placement

/**
 * The root an area belongs to: Gazetteers for a GZ, TDWG when TaxonWorks gives
 * a TDWG origin ('tdwg_l1' to 'tdwg_l4'), else Political (Natural Earth,
 * GADM, ISO country names, and any origin TaxonWorks leaves empty).
 * @param {AreaRow} row  a row with a placement (stubs take their children's root)
 * @returns {'Political'|'TDWG'|'Gazetteers'}
 */
export function areaRoot(row) {
  if (row.key.startsWith('GZ ')) return 'Gazetteers'
  if (String(row.origin ?? '').toLowerCase().startsWith('tdwg')) return 'TDWG'
  return 'Political'
}

/**
 * Is this area a problem for the "problems only" view: not placeable (any
 * reason, also 'not measured yet' and 'no outline'), or placed without a
 * cached outline. Parent stubs are never problems.
 * @param {AreaRow} row
 * @returns {boolean}
 */
export function isProblem(row) {
  const placement = row.placement
  if (!placement) return false
  return !placement.checklist || !placement.shape
}

const byName = (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)

/**
 * The area tree: three roots (ROOTS); within each, areas nested by the
 * position the build compiled from TaxonWorks data (areas.json `ancestors`,
 * cacheFiles.mjs areaPositions, R44): an area sits under the last of its
 * ancestors. The tree only displays that position; rows without `ancestors`
 * (an older areas.json) sit under their parentId. A stub (an area known only
 * as an ancestor) appears in every root that has one of its descendants. An
 * area whose parent is an area of another root starts at the top of its own
 * root. Gazetteers have no ancestors: they are grouped by their ISO code
 * (group nodes 'ISO AU', and 'No ISO code').
 * @param {AreaRow[]} rows  areas.json
 * @returns {TreeRoot[]}
 * @example
 *   buildAreaTree(areas)[0].nodes  // Political: the countries, Alabama (a stub) under GA 237 United States
 */
export function buildAreaTree(rows) {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const parentKeyOf = (row) => (Array.isArray(row.ancestors)
    ? row.ancestors.at(-1) ?? null
    : row.parentId != null ? `GA ${row.parentId}` : null)

  const roots = ROOTS.map((name) => ({ name, nodes: [], count: 0, problems: 0, byKey: new Map() }))
  const rootOf = Object.fromEntries(roots.map((root) => [root.name, root]))

  const nodeIn = (root, row) => {
    let node = root.byKey.get(row.key)
    if (node) return { node, isNew: false }
    node = { key: row.key, name: row.name, row, stub: isStub(row), children: [], problems: 0 }
    root.byKey.set(row.key, node)
    return { node, isNew: true }
  }

  for (const row of rows) {
    if (isStub(row)) continue
    const root = rootOf[areaRoot(row)]
    const { node } = nodeIn(root, row)
    root.count += 1
    // Link it to its parent in this root; stubs are made on the way up.
    let child = node
    let current = row
    const seen = new Set([row.key])
    for (;;) {
      const parentKey = parentKeyOf(current)
      const parent = parentKey ? byKey.get(parentKey) : null
      const sameRoot = parent && (isStub(parent) || areaRoot(parent) === root.name) && !seen.has(parent.key)
      if (!sameRoot) {
        if (!child.top) { child.top = true; root.nodes.push(child) }
        break
      }
      seen.add(parent.key)
      const { node: parentNode, isNew } = nodeIn(root, parent)
      if (!parentNode.children.includes(child)) parentNode.children.push(child)
      if (!isNew) break
      child = parentNode
      current = parent
    }
  }

  // A non-stub area that was first placed at the top because its own row came
  // before its parent's is moved under the parent when linked later.
  for (const root of roots) {
    const linked = new Set()
    for (const node of root.byKey.values()) for (const child of node.children) linked.add(child)
    root.nodes = root.nodes.filter((node) => !linked.has(node))
    if (root.name === 'Gazetteers') root.nodes = groupByIso(root.nodes)
    const visit = (node) => {
      node.children.sort(byName)
      node.problems = (node.row && isProblem(node.row) ? 1 : 0) + node.children.reduce((sum, child) => sum + visit(child), 0)
      delete node.top
      return node.problems
    }
    root.problems = root.nodes.reduce((sum, node) => sum + visit(node), 0)
    root.nodes.sort(byName)
    delete root.byKey
  }
  return roots
}

// Top gazetteer nodes grouped by the ISO code TaxonWorks gives them.
function groupByIso(nodes) {
  const groups = new Map()
  for (const node of nodes) {
    const iso = String(node.row?.iso2 ?? '').toUpperCase()
    const key = iso ? `ISO ${iso}` : 'ISO none'
    if (!groups.has(key)) groups.set(key, { key, name: iso ? `ISO ${iso}` : 'No ISO code', row: null, stub: false, group: true, children: [], problems: 0 })
    groups.get(key).children.push(node)
  }
  return [...groups.values()]
}

/**
 * The tree reduced to what a filter shows: nodes whose name contains the text
 * (accent and case insensitive) and, with problemsOnly, that are problems
 * (isProblem); with their ancestors, which are marked `open` so the matches
 * are visible. Without a filter the tree itself is returned.
 * @param {TreeRoot[]} roots  from buildAreaTree
 * @param {{ text?: string, problemsOnly?: boolean }} filter
 * @returns {TreeRoot[]}  new nodes (the input is not changed)
 */
export function filterTree(roots, { text = '', problemsOnly = false } = {}) {
  const needle = normalizeName(text)
  if (!needle && !problemsOnly) return roots
  const matches = (node) => (!needle || normalizeName(node.name).includes(needle) || node.key.toLowerCase() === text.trim().toLowerCase()) &&
    (!problemsOnly || (node.row && isProblem(node.row)))
  const keep = (node) => {
    const children = node.children.map(keep).filter(Boolean)
    if (!children.length && !matches(node)) return null
    return { ...node, children, open: children.length > 0 }
  }
  return roots.map((root) => ({ ...root, nodes: root.nodes.map(keep).filter(Boolean) }))
}

/**
 * A decision in one line, for the tree and the OTU table: the checklist with
 * part and state ('France, part Corsica'), ', no outline' when placed without a
 * cached outline, or 'not placeable: <reason>'; and the source tag of the
 * deciding step (format.js decidingStep, sourceTag), '' when there are no steps.
 * @param {Object|null} placement  a Placement (areas.json or engine)
 * @returns {{ text: string, tag: string, problem: boolean } | null}  null for no placement
 */
export function decisionOf(placement) {
  if (!placement) return null
  const step = decidingStep(placement)
  const tag = step ? sourceTag(step) : ''
  if (!placement.checklist) return { text: `not placeable: ${placement.reason}`, tag, problem: true }
  const parts = [placement.checklist.name, placement.part && `part ${placement.part}`, placement.state && `state ${placement.state}`]
  if (!placement.shape) parts.push('no outline')
  return { text: parts.filter(Boolean).join(', '), tag, problem: !placement.shape }
}

/**
 * The kind of a reason, to group its variants: the text before ':' ('spans
 * several countries: Indonesia 72%, ...' is 'spans several countries'), the
 * text before '(' ('coordinates in several countries (Russia, Ukraine)'),
 * 'no checklist for a country' for every 'no checklist for <name>'; else the
 * reason itself.
 * @param {string} reason  a reason text of the engine
 * @returns {string}
 */
export function reasonKind(reason) {
  const text = String(reason ?? '')
  if (text.startsWith('no checklist for ')) return 'no checklist for a country'
  const cut = text.search(/[:(]/)
  return (cut > 0 ? text.slice(0, cut) : text).trim()
}

/**
 * The detail of a reason within its kind (reasonKind): the shares of
 * 'spans several countries: Indonesia 51%, Papua New Guinea 49%', the names
 * of 'coordinates in several countries (Russia, Ukraine)', the country of
 * 'no checklist for Kosovo'; '' when the reason is its kind.
 * @param {string} reason
 * @returns {string}
 */
export function reasonDetail(reason) {
  const text = String(reason ?? '')
  if (text.startsWith('no checklist for ')) return text.slice('no checklist for '.length)
  const kind = reasonKind(text)
  return text.slice(kind.length).replace(/^[\s:(]+/, '').replace(/\)\s*$/, '').trim()
}

/** Reason kinds of records with nothing to place them by, shown last and closed (R45). */
export const LOCALITY_REASONS = ['locality text only', 'no locality at all']

/**
 * unplaced.json for the Not placed tab (R53): one section per reason kind
 * (reasonKind), with its record count, and under it one line per area (the
 * area of the asserted distributions) or, for records without an area
 * (specimens and field occurrences), per DwC country text ('no country'
 * without one). A line has its label, the reason detail (reasonDetail: the
 * shares of that area, no date), its record count and its records. Lines by
 * record count, largest first; sections by record count, the locality
 * reasons (LOCALITY_REASONS) last.
 * @param {Object<string, Array<[string, number, (string|null)?, string?]>>} unplaced  unplaced.json:
 *   [kind, id], [kind, id, area key] or [kind, id, null, DwC country]
 * @param {Map<string, string>} [areaNames]  area key to name (areas.json)
 * @returns {{ kind: string, count: number, areas: number, countries: number, locality: boolean,
 *   lines: { key: string, label: string, area: string|null, country: string|null, detail: string,
 *     count: number, records: { kind: string, id: number }[] }[] }[]}
 */
export function unplacedSections(unplaced, areaNames = new Map()) {
  const sections = new Map()
  for (const [reason, ids] of Object.entries(unplaced ?? {})) {
    const kind = reasonKind(reason)
    if (!sections.has(kind)) sections.set(kind, { kind, count: 0, lines: new Map() })
    const section = sections.get(kind)
    for (const [recordKind, id, area, country] of ids) {
      section.count += 1
      const text = String(country ?? '').trim()
      const key = area ? `area:${area}` : recordKind === 'AD' ? 'no area' : `country:${text}`
      if (!section.lines.has(key)) {
        const label = area ? (areaNames.get(area) ?? area) : recordKind === 'AD' ? 'Asserted distributions without area' : (text || 'no country')
        section.lines.set(key, { key, label, area: area ?? null, country: area ? null : (recordKind === 'AD' ? null : text || ''), details: new Set(), count: 0, records: [] })
      }
      const line = section.lines.get(key)
      line.count += 1
      line.details.add(reasonDetail(reason))
      line.records.push({ kind: recordKind, id: Number(id) })
    }
  }
  return [...sections.values()]
    .map((section) => {
      const lines = [...section.lines.values()]
        .map(({ details, ...line }) => ({ ...line, detail: [...details].filter(Boolean).join('; ') }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      return {
        kind: section.kind,
        count: section.count,
        areas: lines.filter((line) => line.area).length,
        countries: lines.filter((line) => line.country !== null && !line.area).length,
        locality: LOCALITY_REASONS.includes(section.kind),
        lines
      }
    })
    .sort((a, b) => Number(a.locality) - Number(b.locality) || b.count - a.count || a.kind.localeCompare(b.kind))
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

/**
 * One line about the records of an OTU, e.g. '153 records (142 AD, 11 CO):
 * 138 placed in 37 checklists, 4 not placed (3 spans several countries, 1 not
 * measured yet), 11 not in checklists (11 locality text only)'. Records the
 * build leaves out of every checklist (an absent distribution, a specimen of
 * rank genus) carry `leftOut` and are counted apart.
 * @param {{ kind: 'AD'|'CO'|'FO', placement: Object, leftOut?: string|null }[]} rows
 * @returns {string}
 */
export function summarizeOtu(rows) {
  if (!rows.length) return 'No records.'
  const byKind = ['AD', 'CO', 'FO'].map((kind) => [kind, rows.filter((row) => row.kind === kind).length]).filter(([, n]) => n)
  const counted = rows.filter((row) => !row.leftOut)
  const placed = counted.filter((row) => row.placement.checklist)
  const checklists = new Set(placed.map((row) => row.placement.checklist.name))
  const tally = (list, keyOf) => {
    const counts = new Map()
    for (const row of list) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => `${n} ${key}`).join(', ')
  }
  const parts = [`${placed.length} placed in ${plural(checklists.size, 'checklist')}`]
  const notPlaced = counted.filter((row) => !row.placement.checklist)
  if (notPlaced.length) parts.push(`${notPlaced.length} not placed (${tally(notPlaced, (row) => reasonKind(row.placement.reason))})`)
  const leftOut = rows.filter((row) => row.leftOut)
  if (leftOut.length) parts.push(`${leftOut.length} not in checklists (${tally(leftOut, (row) => row.leftOut)})`)
  return `${plural(rows.length, 'record')} (${byKind.map(([kind, n]) => `${n} ${kind}`).join(', ')}): ${parts.join(', ')}`
}

const TYPE_OF_KIND = { AD: 'AssertedDistribution', CO: 'CollectionObject', FO: 'FieldOccurrence' }

/**
 * Where the cache has a record: its row in the records of a country file
 * (`{ checklist, part, state }`), else its reason in unplaced.json
 * (`{ reason }`), else null (the cache does not know it).
 * @param {{ kind: string, id: number }} record
 * @param {{ checklistName?: string|null, records?: Object[]|null,
 *   unplaced?: Object<string, Array<[string, number]>> }} cache
 *   records: the expanded records of the country file of checklistName
 * @returns {{ checklist: string, part: string|null, state: string|null } | { reason: string } | null}
 */
export function cachedPlacement({ kind, id }, { checklistName = null, records = null, unplaced = {} }) {
  const type = TYPE_OF_KIND[kind]
  const found = (records ?? []).find((row) => row.dwc_occurrence_object_type === type && Number(row.dwc_occurrence_object_id) === Number(id))
  if (found) return { checklist: checklistName, part: found.part ?? null, state: found.state ?? null }
  for (const [reason, ids] of Object.entries(unplaced ?? {})) {
    if (ids.some(([k, i]) => k === kind && Number(i) === Number(id))) return { reason }
  }
  return null
}

/**
 * Does the live placement differ from the cache? A placed record differs when
 * the cache does not list it in the same checklist with the same part and
 * state; a record not placed differs when the cache lists it (or does not know
 * it at all; the unplaced reason text itself may change with the rules).
 * @param {Object} placement  the live Placement
 * @param {ReturnType<typeof cachedPlacement>} cached
 * @returns {boolean}
 */
export function differsFromCache(placement, cached) {
  if (!cached) return true
  if (!placement.checklist) return !('reason' in cached)
  if (!('checklist' in cached)) return true
  return cached.checklist !== placement.checklist.name ||
    (cached.part ?? null) !== (placement.part ?? null) ||
    (cached.state ?? null) !== (placement.state ?? null)
}

/**
 * The decision order for an area, as README "How a record is placed" gives it,
 * one short line per step; the curator page shows it above the rules.
 */
export const DECISION_ORDER = [
  'A manual rule for the area.',
  'A checklist of its own: the area or its parent is in the entry\'s areas, the area has its ISO code, or a word of its names is in the area\'s or its parent\'s name.',
  'The country TaxonWorks gives the area (its country, the area itself when it is a country, or a parent with a checklist).',
  'The ISO code of a gazetteer.',
  'An overlap rule for the area.',
  'Otherwise not placeable, with the reason.'
]

const matchText = (match) => Object.entries(match ?? {}).map(([key, value]) => {
  if (key === 'tdwg') return `TDWG ${value}`
  if (key === 'gazetteerPrefix') return `gazetteer names starting with ${value}`
  if (key === 'iso2') return `ISO ${value}`
  return String(value)
}).join(', ')

const actionText = (action) => {
  if (action?.subdivisionOf) {
    const { country, part, state } = action.subdivisionOf
    return [`in ${country}`, part && `part ${part}`, state && `state ${state}`].filter(Boolean).join(', ')
  }
  if (action?.notPlaceable) return `not placeable: ${action.notPlaceable}`
  if (action?.synonymousWith) return `same as ${action.synonymousWith}`
  return JSON.stringify(action ?? {})
}

/**
 * The compiled rules (rules.json, rules.js compileRules) as sections of rows
 * to show: each row has its `ref` ('placement.yml:69'), what it matches, what
 * it does, and its `why` or `measured` text. The overlap section is marked
 * `collapsed`.
 * @param {import('./rules.js').CompiledRules} rules
 * @returns {{ name: string, collapsed: boolean, rows: { ref: string|null, match: string, action: string, why: string }[] }[]}
 */
export function ruleSections(rules) {
  const parts = Object.entries(rules.parts ?? {}).flatMap(([country, list]) => list.map((part) => ({
    ref: part.ref,
    match: [part.areas?.length && part.areas.join(', '), part.names?.length && `names ${part.names.join(', ')}`].filter(Boolean).join('; '),
    action: `part ${part.name} of ${country}${part.rest ? ' (every other record below country level)' : ''}`,
    why: ''
  })))
  return [
    {
      name: 'Checklists of their own',
      collapsed: false,
      rows: (rules.checklists ?? []).map((entry) => ({
        ref: entry.ref,
        match: [entry.areas?.length && entry.areas.join(', '), entry.iso2 && `ISO ${entry.iso2}`, entry.names?.length && `names ${entry.names.join(', ')}`]
          .filter(Boolean).join('; '),
        action: `checklist ${entry.name}${entry.of ? ` (TaxonWorks files it under ${entry.of})` : ''}`,
        why: entry.why ?? ''
      }))
    },
    {
      name: 'Synonyms',
      collapsed: false,
      rows: (rules.synonyms ?? []).map((entry) => ({ ref: entry.ref, match: entry.names.slice(1).join(', '), action: `spelling of ${entry.names[0]}`, why: '' }))
    },
    { name: 'Parts', collapsed: false, rows: parts },
    {
      name: 'State countries',
      collapsed: false,
      rows: [{ ref: rules.stateCountries?.ref ?? null, match: (rules.stateCountries?.names ?? []).join(', '), action: 'browsed by state or province', why: '' }]
    },
    {
      name: 'Ignored name words',
      collapsed: false,
      rows: [{ ref: rules.ignoredNameWords?.ref ?? null, match: (rules.ignoredNameWords?.words ?? []).join(', '), action: 'left out when a place name is compared with state names', why: '' }]
    },
    {
      name: 'Manual rules',
      collapsed: false,
      rows: (rules.manual ?? []).map((rule) => ({ ref: rule.ref, match: matchText(rule.match), action: actionText(rule.action), why: rule.why ?? '' }))
    },
    {
      name: 'Overlap rules',
      collapsed: true,
      rows: (rules.overlap ?? []).map((rule) => ({ ref: rule.ref, match: matchText(rule.match), action: actionText(rule.action), why: rule.measured ? `measured ${rule.measured}` : '' }))
    }
  ]
}

/**
 * A text cut at every rules file reference, for links to the line (R46).
 * @param {string} text  e.g. 'x [manual, placement.yml:12]'
 * @returns {{ text: string, line?: number }[]}  'placement.yml:12' parts carry its line
 * @example
 *   splitRefs('a [manual, placement.yml:12]')
 *   // [{ text: 'a [manual, ' }, { text: 'placement.yml:12', line: 12 }, { text: ']' }]
 */
export function splitRefs(text) {
  const parts = []
  const pattern = /placement\.yml:(\d+)/g
  const value = String(text ?? '')
  let last = 0
  for (const found of value.matchAll(pattern)) {
    if (found.index > last) parts.push({ text: value.slice(last, found.index) })
    parts.push({ text: found[0], line: Number(found[1]) })
    last = found.index + found[0].length
  }
  if (last < value.length || !parts.length) parts.push({ text: value.slice(last) })
  return parts
}

/**
 * Every source that contributed to a placement (country, part, state,
 * outline), as source tags in step order, each once (R43): e.g.
 * ['[TaxonWorks]', '[overlap 100% Primorsky Krai, placement.yml:539]'].
 * @param {Object|null} placement  a Placement
 * @returns {string[]}
 */
export function sourceTags(placement) {
  const tags = []
  for (const step of placement?.steps ?? []) {
    if (step.none) continue
    const tag = sourceTag(step)
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/**
 * The steps after the checklist is decided, numbered on from DECISION_ORDER
 * on the Rules tab (R46): the part, the state or province (naming the
 * checklists of state_countries) and the outline.
 * @param {import('./rules.js').CompiledRules} rules
 * @returns {{ text: string, ref: string|null }[]}
 */
export function afterDecisionSteps(rules) {
  const parts = Object.entries(rules?.parts ?? {}).map(([country, list]) => `${country} only: ${list.map((part) => part.name).join(' or ')}`)
  const states = rules?.stateCountries?.names ?? []
  const listed = states.length > 1 ? `${states.slice(0, -1).join(', ')} and ${states.at(-1)}` : states.join('')
  return [
    { text: `The part (${parts.join('; ') || 'no checklist has parts'}).`, ref: null },
    { text: `The state or province, only for the checklists browsed by state: ${listed || 'none'}.`, ref: rules?.stateCountries?.ref ?? null },
    { text: 'The outline: the part\'s outline, else the checklist\'s.', ref: null }
  ]
}

/**
 * The route to line N of the rules file on the curator page's Rules tab: the
 * current query with tab=rules (an older ?line= dropped) and the route hash
 * #L<N>. A route hash, not a query, because the framework's scrollBehavior
 * scrolls to the element of a route hash and to the top on any other
 * navigation (which undid a query-only link). In hash mode the address reads
 * /#/checklists/curator?curator=1&tab=rules#L120.
 * @param {{ query: Object }} route  the current route
 * @returns {(line: number) => { query: Object, hash: string }}
 */
export function lineLink(route) {
  return (line) => ({ query: { ...route.query, tab: 'rules', line: undefined }, hash: `#L${line}` })
}

/**
 * The deciding step of a placement in a few plain words, for the area tree's
 * "because:" (R54): what kind of fact or rule decided, not the full step. The
 * rules file line, when there is one, comes as `ref` (shown as a link).
 *   TaxonWorks  'country area in TaxonWorks' (the area is a country),
 *               'GA hierarchy in TaxonWorks (GA 77)', 'subdivision of
 *               Cayenne's parent ... in TaxonWorks', 'gazetteer ISO code NZ',
 *               'DwC country', 'no country in TaxonWorks and no rule'
 *   manual      'spelling synonym', 'own checklist entry', 'part of the
 *               checklist', 'manual rule', 'same area as GA 78 (manual rule)'
 *   overlap     'measured 100% in Russia', 'measured: spans several
 *               countries', 'coordinates inside the outline', 'coordinates
 *               near the coast'
 * @param {Object|null} placement  a Placement (areas.json or engine)
 * @returns {{ text: string, ref: string|null } | null}  null without steps
 */
export function plainReason(placement) {
  const step = placement ? decidingStep(placement) : null
  if (!step) return null
  const ref = step.ref ?? null
  const text = step.text
  const said = (words) => ({ text: words, ref })
  if (step.source === 'TaxonWorks') {
    if (/\) is a country$/.test(text)) return said('country area in TaxonWorks')
    if (/ is part of /.test(text)) return said('country area under another country in TaxonWorks')
    const inCountry = / is in .*\((GA \d+)\)$/.exec(text)
    if (inCountry) return said(`GA hierarchy in TaxonWorks (${inCountry[1]})`)
    const parent = / is a subdivision of .*\((GA \d+)\)/.exec(text)
    if (parent) return said(`subdivision of ${parent[1]} in TaxonWorks`)
    const iso = / has ISO code ([A-Z]{2})/.exec(text)
    if (iso) return said(`gazetteer ISO code ${iso[1]}`)
    if (/^DwC country is /.test(text)) return said('DwC country')
    if (/has no country in TaxonWorks/.test(text)) return said('no country in TaxonWorks and no rule')
    if (/is a country without a checklist|which has no checklist/.test(text)) return said('TaxonWorks country without a checklist')
    return said('TaxonWorks')
  }
  if (step.source === 'manual') {
    if (/ is a spelling of /.test(text)) return said('spelling synonym')
    if (/belongs to the checklist |of the checklist /.test(text)) return said('own checklist entry')
    const same = / is the same area as (G[AZ] \d+)/.exec(text)
    if (same) return said(`same area as ${same[1]} (manual rule)`)
    if (/ the part /.test(text)) return said('part of the checklist (manual rule)')
    return said('manual rule')
  }
  if (/^coordinates .* within about \d+ km of the coast/.test(text)) return said('coordinates near the coast')
  if (/^coordinates .* lie inside /.test(text)) return said('coordinates inside the outline')
  if (step.pct !== undefined && step.pctOf) return said(`measured ${step.pct}% in ${step.pctOf}`)
  const spans = /(spans several (?:countries|states)|outside every (?:checklist|state) outline)/.exec(text)
  if (spans) return said(`measured: ${spans[1]}`)
  return said('measured overlap')
}

/**
 * @typedef {{ text: string, ref: string|null }} Reason
 */

/**
 * One reason for each decision of a placed area, for the area tree (R54): the
 * checklist, the part (France) and the state, each from the step that decided
 * it (Step.stage, set by the engine). A decision whose step is not known (a
 * cache made before steps had a stage, or a wording not listed here) gets
 * null, never a guess.
 *   checklist  as plainReason
 *   part       'manual entry', 'rest of the country', 'manual rule' (the rule
 *              that placed the area also names the part), 'measured: coordinates
 *              inside the part', 'coordinates inside the part's rough box'
 *   state      'the area is this state in TaxonWorks', 'GA hierarchy in
 *              TaxonWorks (GA 19713)', 'measured 100% in Primorsky Krai',
 *              'manual rule', 'name matches after ignoring words', and for a
 *              specimen 'DwC stateProvince is this state in TaxonWorks',
 *              'coordinates inside the state'
 * @param {Object|null} placement  a Placement (areas.json or engine)
 * @returns {{ checklist: Reason|null, part: Reason|null, state: Reason|null }}
 */
export function plainReasons(placement) {
  const none = { checklist: null, part: null, state: null }
  if (!placement?.checklist) return none
  const steps = placement.steps ?? []
  return {
    checklist: plainReason(placement),
    part: placement.part ? partReason(steps) : null,
    state: placement.state ? stateReason(steps) : null
  }
}

function partReason(steps) {
  const step = steps.find((candidate) => candidate.stage === 'part' && !candidate.none)
  if (!step) {
    const rule = steps.find((candidate) => candidate.stage === 'checklist' && candidate.decidesPart)
    return rule ? { text: 'manual rule', ref: rule.ref ?? null } : null
  }
  const ref = step.ref ?? null
  if (step.source === 'overlap') return { text: 'measured: coordinates inside the part', ref }
  if (/so (?:it goes|they go) to the part /.test(step.text)) return { text: 'rest of the country', ref }
  if (/inside the rough box of the part /.test(step.text)) return { text: 'coordinates inside the part\'s rough box', ref }
  if (step.source === 'manual' && / the (?:name .* of the )?part |belongs to the part /.test(step.text)) return { text: 'manual entry', ref }
  return null
}

function stateReason(steps) {
  const step = steps.find((candidate) => candidate.stage === 'state' && !candidate.none && !candidate.text.startsWith('no state'))
  if (!step) return null
  const ref = step.ref ?? null
  const text = step.text
  if (step.source === 'manual' && /\(ignoring "/.test(text)) return { text: 'name matches after ignoring words', ref }
  if (step.source === 'manual') return / the state /.test(text) ? { text: 'manual rule', ref } : null
  if (step.source === 'overlap') {
    if (step.pct !== undefined && step.pctOf) return { text: `measured ${step.pct}% in ${step.pctOf}`, ref }
    if (/within about \d+ km of the coast/.test(text)) return { text: 'coordinates near the coast of the state', ref }
    if (/ lie inside the state /.test(text)) return { text: 'coordinates inside the state', ref }
    return { text: 'measured overlap', ref }
  }
  const parent = / is a subdivision of .*\((GA \d+)\), the state /.exec(text)
  if (parent) return { text: `GA hierarchy in TaxonWorks (${parent[1]})`, ref }
  if (/^DwC stateProvince .* is the state /.test(text)) return { text: 'DwC stateProvince is this state in TaxonWorks', ref }
  if (/ is the state [^,]*$/.test(text)) return { text: 'the area is this state in TaxonWorks', ref }
  return null
}
