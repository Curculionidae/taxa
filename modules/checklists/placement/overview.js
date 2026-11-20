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
 * @property {number} records  records on the area (0 for a parent stub)
 * @property {Object|null} placement  the area's Placement, null for a parent stub
 *
 * @typedef {Object} TreeNode
 * @property {string} key
 * @property {string} name
 * @property {AreaRow} row
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
 * The area tree: three roots (ROOTS); within each, areas nested by parentId.
 * A parent stub appears in every root that has one of its descendants (GA 78
 * French Guiana under Political as the parent of Cayenne; GA 33722 French
 * Guiana under TDWG as the parent of the TDWG L4 French Guiana). An area whose
 * parent is an area of another root starts at the top of its own root.
 * @param {AreaRow[]} rows  areas.json
 * @returns {TreeRoot[]}
 * @example
 *   buildAreaTree(areas)[1].nodes  // TDWG: the stubs and TDWG areas without parent in TDWG
 */
export function buildAreaTree(rows) {
  const gaRows = new Map()
  for (const row of rows) if (row.key.startsWith('GA ')) gaRows.set(Number(row.key.slice(3)), row)

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
    for (;;) {
      const parent = current.parentId != null ? gaRows.get(Number(current.parentId)) : null
      const sameRoot = parent && (isStub(parent) || areaRoot(parent) === root.name) && parent.key !== current.key
      if (!sameRoot) {
        if (!child.top) { child.top = true; root.nodes.push(child) }
        break
      }
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
    const visit = (node) => {
      node.children.sort(byName)
      node.problems = (isProblem(node.row) ? 1 : 0) + node.children.reduce((sum, child) => sum + visit(child), 0)
      delete node.top
      return node.problems
    }
    root.problems = root.nodes.reduce((sum, node) => sum + visit(node), 0)
    root.nodes.sort(byName)
    delete root.byKey
  }
  return roots
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
    (!problemsOnly || isProblem(node.row))
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
 * unplaced.json as sections, one per reason kind (reasonKind), largest first:
 * the variants (exact reason texts) with their counts, largest first, and all
 * records of the section in that order.
 * @param {Object<string, Array<[string, number]>>} unplaced  unplaced.json
 * @returns {{ kind: string, count: number, variants: { reason: string, count: number }[],
 *   records: { kind: string, id: number, reason: string }[] }[]}
 */
export function groupUnplaced(unplaced) {
  const sections = new Map()
  for (const [reason, ids] of Object.entries(unplaced ?? {})) {
    const kind = reasonKind(reason)
    if (!sections.has(kind)) sections.set(kind, { kind, count: 0, variants: [] })
    const section = sections.get(kind)
    section.count += ids.length
    section.variants.push({ reason, count: ids.length, ids })
  }
  return [...sections.values()]
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    .map((section) => {
      const variants = section.variants.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
      return {
        kind: section.kind,
        count: section.count,
        variants: variants.map(({ reason, count }) => ({ reason, count })),
        records: variants.flatMap(({ reason, ids }) => ids.map(([kind, id]) => ({ kind, id: Number(id), reason })))
      }
    })
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
