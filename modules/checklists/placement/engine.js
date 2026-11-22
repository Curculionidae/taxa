// The placement engine: which checklist a record belongs to, and why.
//
// Purpose: one implementation of the placement decisions, used by the cache
// build (Node) and by the curator page (browser). Every decision comes with
// steps that name their source, so a curator can see whether to fix something
// in TaxonWorks or in the rules file. placeArea places an AREA, the place an
// asserted distribution points to, without its state. placeRecord places a
// record: an asserted distribution by its area, a specimen or field occurrence
// by its DwC country, else by its coordinates; and then finds its state.
//
// Input:  an Area (areas.js, toArea) or a RecordInput (see the typedef), and a
//         Context made once by createContext from the checklists
//         (checklists.js, deriveChecklists), the compiled rules file (rules.js,
//         compileRules), a Geometry (point lookups on outlines, see the typedef),
//         the set of cached outline keys ('GeographicArea/32253'), those of
//         them that hold no polygon (`unusable`) and the outline that stands
//         for each checklist (`outlines`, geometry.js checklistOutline).
// Output: a Placement (see the typedef): the checklist or null with a reason,
//         the part (France: Corsica, Mainland France), the state, the outline
//         to show, and the steps of the decision.
// Purity: no network, no file system, no Node-only APIs, no hidden state. The
//         same input always gives the same Placement, in Node and in the browser.
//         Everything that needs outlines goes through the injected Geometry
//         (which may fetch in the browser), so placeRecord is async; placeArea
//         never calls the Geometry and stays synchronous.
//
// Every check that runs adds a step, also when it finds nothing (Step.none:
// 'no manual rule for New Guinea (GZ 3614)'), so an explanation shows each
// check up to the one that decided. Checks after it do not run.
//
// Decision order for an area (the first that applies decides):
//  1. a manual rule for the area (rules file, manual section)
//  2. a checklist of its own (rules file, checklists section): the area, or its
//     parent, is listed in `areas`, the area's ISO code is the checklist's, or
//     a word of `names` is in the area's or its parent's name
//  3. the country TaxonWorks gives the area: its `level0_id`, the area itself
//     when TaxonWorks counts it as a country (isCountryArea), else a parent
//     that belongs to a checklist
//  4. the ISO code of a gazetteer
//  5. an overlap rule for the area (rules file, overlap section)
//  6. otherwise not placeable, with the reason: 'no outline' (none cached),
//     'no usable outline (no polygon)' (the cached outline is a point or a
//     line, context `unusable`), else 'not measured yet'
// Then the part of the checklist (France) and the outline: the part's first
// cached GA outline, else the checklist's (context `outlines`: its first
// cached area, else the Natural Earth fallback outline; a rules entry with
// `outline: natural_earth` takes the fallback first, cited by a step).
//
// Decision order for a specimen or field occurrence (placeRecord):
//  Coordinates are DwC decimalLatitude/decimalLongitude, else a point inside the
//  georeference shape (DwC footprintWKT, footprint.js), with a step saying so.
//  0. without coordinates, the area of its collecting event (RecordInput.eventArea),
//     when a distribution uses that area: placed exactly as an asserted
//     distribution on it (country, part and state), after a step naming the
//     area. When it gives no checklist, or only its key is known, the steps
//     say so and the order goes on with 1.
//  1. a checklist of its own: a word of its `names` is in the DwC country,
//     stateProvince or county (France + stateProvince French Guiana)
//  2. the DwC country (TaxonWorks computes it from the georeference or the
//     collecting event's area), through the synonyms of the rules file; a DwC
//     country without checklist is not placeable ('no checklist for Kosovo')
//  3. no DwC country but coordinates: the checklist outline that contains
//     them (Geometry.checklistsAt), when exactly one does; when none does, the
//     one within the coastal tolerance (rules file coastal_tolerance_degrees),
//     and the step says "within about 5 km of the coast of" and cites that line
//  4. otherwise not placeable: 'locality text only' or 'no locality at all'
//  Step 1 reads stateProvince and county only when the DwC country is empty
//  or is the entry's `of` country (France), so a county abroad is never captured.
// Then the part (France: a part name in stateProvince or county, else the part
// whose outline holds the coordinates, else the part whose rough `box` (rules
// file) holds them (Geometry.partAt), else the rest part when the record has a
// stateProvince or coordinates).
//
// The state, only for checklists with `states` (placeRecord):
//  asserted distribution: the area's own name is a state of the checklist, but
//    only when the area is a state itself (isStateArea in areas.js, the state
//    test of TaxonWorks; TDWG areas and gazetteers, which carry no levels, are
//    always tried by name) [TaxonWorks]; else its parent's name, when the
//    parent is the area's state (its level1, or level1 unknown): a county takes
//    the state it lies in, so Washington County, Utah, is in Utah, never in
//    Washington (R30); else an overlap rule for the area gives `state`. A
//    manual rule for the area that gives `state` comes before all of these,
//    as manual rules do for countries. Else no state, with the reason as a
//    step 'no state: ...' (record is for the whole country; spans several
//    states: <shares> or outside every state outline, both from an overlap
//    rule; no outline to measure; no usable outline (no polygon); not
//    measured yet). Never calls the Geometry for outlines, only for the names.
//  specimen: the DwC stateProvince (TaxonWorks' first-level area name) is a
//    state [TaxonWorks]; else it is the name of exactly one TaxonWorks area of
//    the same checklist in the cache (context `stateAreas`), and that area's
//    own state decision gives the state, with a step naming both ("DwC
//    stateProvince Primor'ye is TaxonWorks area GA 20330, which lies in the
//    state Primorsky Krai" [overlap, that rule's line]); else the state outline
//    that contains the coordinates, else the only one within the coastal
//    tolerance (Geometry.stateAt) [overlap]; else no state, with the reason.
// State names are matched only against the states of the chosen checklist
// (states.js), never against countries, so the US state Georgia never meets
// the country Georgia. A name matches a state's own name [TaxonWorks], or
// that name after leaving out the rules file's ignored_name_words
// ("Krasnoyarsk Krai" for Krasnoyarsk) [manual, the line of that list]; the
// step says which. The other names Natural Earth lists for a state
// (subdivisions.geojson `aliases`) decide nothing (R51): an area known only
// by such a name gets its state from an overlap or manual rule.
import { normalizeName, containsName, isCountryArea, isStateArea } from './areas.js'
import { stateIndex, resolveSubdivision, matchSubdivision } from './states.js'
import { footprintPoint } from './footprint.js'

/**
 * Start of a `not_placeable` text that speaks about states, not countries: a
 * rule with it (written by the measuring script for an area that lies in one
 * country but several of its states) never decides the country, it only gives
 * the reason for no state ('spans several states: Moscow Oblast 18%, ...').
 */
export const SEVERAL_STATES = 'spans several states'

/**
 * The `not_placeable` text the measuring script writes for an area of a
 * checklist with states whose outline lies in none of its state outlines
 * (GZ 10454 Hawai'i: Lana'i, whose Natural Earth state outline misses it).
 * Like SEVERAL_STATES it never decides the country, only the reason for no state.
 */
export const OUTSIDE_STATES = 'outside every state outline'

/**
 * The `not_placeable` text the measuring script writes for an area whose
 * outline lies outside every checklist outline (in the sea, or on land
 * without an outline). It decides like any not_placeable rule.
 */
export const OUTSIDE_CHECKLISTS = 'outside every checklist outline'

/**
 * @typedef {Object} Step  one sentence of an explanation
 * @property {string} text  short plain sentence; the source tag and line are not part of it
 * @property {'TaxonWorks'|'manual'|'overlap'} source  TaxonWorks data, a hand-written
 *   line of the rules file, or a measured overlap line of the rules file
 * @property {string} [ref]  'placement.yml:12', the rules file line, for manual and overlap
 * @property {'checklist'|'part'|'state'|'outline'} [stage]  the decision the step belongs to
 *   (set by the engine, read by overview.js plainReasons; steps of an older cache lack it)
 * @property {boolean} [decidesPart]  on a rule step of the checklist stage that also gives the part
 * @property {number} [pct]  the measured share of an overlap step
 * @property {string} [pctOf]  the name the share refers to (the country of a country
 *   rule, the state of a state rule); set on every step that has `pct`
 * @property {'shape'|'eventArea'} [via]  on the first step of a specimen placed through a
 *   point in its georeference shape or through its collecting event area (cacheFiles.mjs
 *   specimensSummary counts by it)
 * @property {boolean} [pointTest]  on a `none` step: a point tested against outlines lay in
 *   none (tag [overlap]); other `none` steps of the overlap section are rule lookups
 * @property {boolean} [none]  a check that ran and found nothing ('no manual rule for
 *   New Guinea (GZ 3614)'); printed in every explanation, skipped where the step
 *   that decided is wanted (format.js decidingStep, overview.js sourceTags)
 *
 * @typedef {Object} Placement
 * @property {{ id: number|string, name: string } | null} checklist  null when not placeable
 * @property {string|null} part   part of the checklist (France: 'Corsica'), else null
 * @property {string|null} state  state or province (only for checklists with `states`);
 *   always null from placeArea, filled by placeRecord
 * @property {{ key: string, name: string } | null} shape  outline to show, key
 *   'GeographicArea/32253' or 'fallback/Norfolk Island' (a Natural Earth outline of
 *   fallback-shapes.geojson); null when not placeable or when there is no outline
 * @property {string|null} reason  why it is not placeable ('no outline', 'no usable outline
 *   (no polygon)', 'not measured yet', 'no checklist for Kosovo', 'spans several countries:
 *   ...', 'outside every checklist outline', 'coordinates in several countries (Russia,
 *   Ukraine)', 'coordinates outside every outline', 'locality text only', 'no locality at
 *   all'), null when placed
 * @property {Step[]} steps  the decision, in order
 *
 * @typedef {Object} Geometry  lookups on cached outlines, injected so the engine stays
 *   pure (the build reads files, the browser fetches; implemented in Task 7 and 11)
 * @property {(point: [number, number]) => Promise<{ ids: Array<number|string>, near: boolean }>} checklistsAt
 *   ids of the checklists whose outline contains the point [lng, lat]; when none does,
 *   those within the coastal tolerance, with near true (geometry.js checklistsAtPoint)
 * @property {(checklistId: number|string, point: [number, number]) => Promise<{ name: string, near: boolean }|null>} stateAt
 *   the state of that checklist whose outline contains the point, else the only one
 *   within the coastal tolerance (near true); null when none
 * @property {(checklistId: number|string, point: [number, number]) => Promise<{ name: string, by: 'outline'|'box' }|null>} partAt
 *   the part of that checklist (France: Corsica) whose outline holds the point (by
 *   'outline'), else whose `box` from the rules file holds it (by 'box'); null when none (R19)
 * @property {(checklistId: number|string) => { name: string }[]} stateNames
 *   the states of a checklist with `states` (subdivisions.geojson `properties.name`);
 *   [] for any other checklist
 *
 * @typedef {Object} RecordInput  one record as placeRecord sees it (DwC fields as
 *   TaxonWorks exports them; empty text counts as missing)
 * @property {'AssertedDistribution'|'CollectionObject'|'FieldOccurrence'} type
 * @property {number} id
 * @property {string} [country]        DwC country
 * @property {string} [stateProvince]  DwC stateProvince
 * @property {string} [county]         DwC county
 * @property {string} [locality]       DwC verbatimLocality, only to tell 'locality
 *   text only' from 'no locality at all'
 * @property {number|string} [lat]     DwC decimalLatitude
 * @property {number|string} [lng]     DwC decimalLongitude
 * @property {string} [footprint]     DwC footprintWKT: a georeference drawn as a shape,
 *   used (as a point inside it, footprint.js) only when lat and lng are empty
 * @property {import('./areas.js').Area|{ key: string }} [eventArea]  the area of the
 *   specimen's collecting event: a full Area when a distribution uses it (its
 *   levels and parent are known), else only its key. Used only without coordinates.
 *
 * @typedef {Object} Context  lookups made once, shared by every placement
 * @property {import('./checklists.js').Checklist[]} checklists
 * @property {import('./rules.js').CompiledRules} rules
 * @property {Geometry|null} geometry
 * @property {Set<string>} shapes  cached outline keys, 'GeographicArea/32253' or 'Gazetteer/3529'
 * @property {Set<string>} unusable  cached outline keys of areas whose outline holds no
 *   polygon (a Point gazetteer), as the build found them (geometry-node.mjs unusableOutlines)
 * @property {Map<number|string, string>|null} outlines  the outline that stands for each
 *   checklist, by checklist id ('GeographicArea/237', 'fallback/Norfolk Island'); null:
 *   the first cached area of the checklist
 * @property {Map<number, import('./checklists.js').Checklist>} byAreaId  GA id to checklist
 * @property {Map<string, import('./checklists.js').Checklist>} byIso  upper case ISO code to checklist
 * @property {Map<string, import('./checklists.js').Checklist>} byName  normalized name or synonym to checklist
 * @property {Map<number|string, import('./checklists.js').Checklist>} byId  checklist id to checklist
 * @property {Map<number|string, Map<string, import('./areas.js').Area|null>>} stateAreas  per
 *   checklist with states, the TaxonWorks areas in the cache that the engine places
 *   there, by normalizeName(name); null for a name two areas share
 * @property {Map<number|string, import('./states.js').SubdivisionIndex>} stateIndexes  state name
 *   index per checklist id, filled on first use from Geometry.stateNames and the rules
 *   file's ignored_name_words
 */

/**
 * Make the lookup context once for many placements.
 * @param {Object} input
 * @param {import('./checklists.js').Checklist[]} input.checklists  from deriveChecklists
 * @param {import('./rules.js').CompiledRules} input.rules  from compileRules
 * @param {Geometry|null} [input.geometry]  outline lookups, used by placeRecord
 * @param {Set<string>} [input.shapes]  keys of cached outlines, 'GeographicArea/32253'
 * @param {Set<string>} [input.unusable]  those of them that hold no polygon
 * @param {Map<number|string, string>|null} [input.outlines]  outline key by checklist id
 * @param {Map<number|string, import('./areas.js').Area[]>} [input.stateAreas]  per checklist
 *   with states, the areas of the cache placed there (stateAreasOf)
 * @returns {Context}
 */
export function createContext({ checklists, rules, geometry = null, shapes = new Set(), unusable = new Set(), outlines = null, stateAreas = new Map() }) {
  const byAreaId = new Map()
  const byIso = new Map()
  const byName = new Map()
  const byId = new Map()
  for (const checklist of checklists) {
    if (!byId.has(checklist.id)) byId.set(checklist.id, checklist)
    for (const id of checklist.areaIds) if (!byAreaId.has(id)) byAreaId.set(id, checklist)
    if (checklist.iso2 && !byIso.has(checklist.iso2.toUpperCase())) byIso.set(checklist.iso2.toUpperCase(), checklist)
    byName.set(normalizeName(checklist.name), checklist)
  }
  // Every spelling of a synonym list finds the checklist of its first name.
  for (const { names } of rules.synonyms) {
    const checklist = byName.get(normalizeName(names[0]))
    if (!checklist) continue
    for (const name of names) if (!byName.has(normalizeName(name))) byName.set(normalizeName(name), checklist)
  }
  const areaNames = new Map()
  for (const [id, list] of stateAreas) {
    const names = new Map()
    for (const area of list) {
      const key = normalizeName(area.name)
      if (!key) continue
      names.set(key, names.has(key) && names.get(key)?.key !== area.key ? null : area)
    }
    areaNames.set(id, names)
  }
  return { checklists, rules, geometry, shapes, unusable, outlines, byAreaId, byIso, byName, byId, stateAreas: areaNames, stateIndexes: new Map() }
}

/**
 * The areas of the cache placed in each checklist with states, for the
 * context's `stateAreas` (R51): a specimen's DwC stateProvince that is no
 * state name is looked up among them.
 * @param {Iterable<import('./areas.js').Area>} areas  every used area
 * @param {Context} ctx  a context of the same checklists and rules
 * @returns {Map<number|string, import('./areas.js').Area[]>}
 */
export function stateAreasOf(areas, ctx) {
  const out = new Map()
  for (const area of areas) {
    const placement = placeArea(area, ctx)
    const checklist = placement.checklist && ctx.byId.get(placement.checklist.id)
    if (!checklist?.states) continue
    if (!out.has(checklist.id)) out.set(checklist.id, [])
    out.get(checklist.id).push(area)
  }
  return out
}

/**
 * The Placement of an asserted distribution without an area (or one the
 * download lacks): not placeable, no steps. Used by the build and the curator page.
 * @param {string} [reason]  'distribution has no area' or 'distribution not downloaded'
 * @returns {Placement}
 */
export function placementWithoutArea(reason = 'distribution has no area') {
  return { checklist: null, part: null, state: null, shape: null, reason, steps: [] }
}

/**
 * Place an area (the place an asserted distribution points to), without its
 * state. Synchronous; never calls the Geometry.
 * @param {import('./areas.js').Area} area
 * @param {Context} ctx
 * @returns {Placement}  state is always null
 */
export function placeArea(area, ctx) {
  return finish(decideArea(area, ctx), null, ctx)
}

/**
 * Place a record: its checklist, part and state, with the steps of the decision.
 * An asserted distribution is placed by its area (as placeArea) and then gets
 * its state from the area's name or a rule. A specimen or field occurrence is
 * placed by its DwC fields, else by its coordinates (Geometry.checklistsAt), and
 * gets its state from DwC stateProvince, else from its coordinates
 * (Geometry.stateAt). See the decision orders at the top of this file.
 * @param {RecordInput} record
 * @param {Context} ctx
 * @param {import('./areas.js').Area} [area]  the area of an asserted distribution (required for one)
 * @returns {Promise<Placement>}
 * @throws {Error} for an asserted distribution without its area
 * @example
 *   await placeRecord({ type: 'CollectionObject', id: 5, country: 'United Republic of Tanzania' }, ctx)
 *   // checklist Tanzania; steps: 'DwC country is United Republic of Tanzania' [TaxonWorks],
 *   // 'United Republic of Tanzania is a spelling of Tanzania' [manual, placement.yml:110]
 */
export async function placeRecord(record, ctx, area) {
  if (record.type === 'AssertedDistribution') {
    if (!area) throw new Error(`placeRecord: asserted distribution ${record.id} needs its area`)
    const decision = decideArea(area, ctx)
    const before = decision.steps.length
    const state = decision.checklist ? areaState(area, decision.checklist, ctx, decision.steps) : null
    stamp(decision.steps, before, 'state')
    return finish(decision, state, ctx)
  }
  // Coordinates, else a point inside the georeference shape (footprintWKT).
  let point = pointOf(record)
  const shapePoint = point ? null : footprintPoint(record.footprint)
  if (shapePoint) point = shapePoint
  // Without either, the collecting event's area decides as for an asserted
  // distribution on it (the DwC names are derived from that area).
  const lead = shapePoint
    ? [{ text: `the georeference is a shape; the point ${shapePoint.lat}, ${shapePoint.lng} inside it is used`, source: 'TaxonWorks', via: 'shape' }]
    : point ? [] : [noPointStep(record), ...eventAreaSteps(record)]
  if (!point && record.eventArea?.name != null && record.type !== 'FieldOccurrence') {
    const byArea = decideArea(record.eventArea, ctx)
    if (byArea.checklist) {
      const before = byArea.steps.length
      const state = areaState(record.eventArea, byArea.checklist, ctx, byArea.steps)
      stamp(byArea.steps, before, 'state')
      byArea.steps.unshift(...stamped(lead, 'checklist'))
      return finish(byArea, state, ctx)
    }
    // A reason from TaxonWorks data or a rule stands, as for a distribution on
    // the area; only an area that cannot be measured yet hands over.
    if (!UNMEASURED.has(byArea.reason)) {
      byArea.steps.unshift(...stamped(lead, 'checklist'))
      return finish(byArea, null, ctx)
    }
    for (const step of lead) delete step.via // the area did not decide
    lead.push(...byArea.steps, none('the area cannot be placed by its outline yet, so the DwC fields are read', 'TaxonWorks'))
  }
  const decision = await decideRecord(record, point, ctx)
  decision.steps.unshift(...lead)
  stamp(decision.steps, 0, 'checklist')
  if (!decision.checklist) return finish(decision, null, ctx)
  let before = decision.steps.length
  decision.part = decision.part ?? await recordPart(record, point, decision.checklist, ctx, decision.steps)
  stamp(decision.steps, before, 'part')
  before = decision.steps.length
  const state = await recordState(record, point, decision.checklist, ctx, decision.steps)
  stamp(decision.steps, before, 'state')
  return finish(decision, state, ctx)
}

// The checklist and part of an area, with steps.
function decideArea(area, ctx) {
  const decision = decide(area, ctx)
  stamp(decision.steps, 0, 'checklist')
  if (decision.checklist) {
    const before = decision.steps.length
    decision.part = decision.part ?? choosePart(area, decision.checklist, ctx, decision.steps)
    stamp(decision.steps, before, 'part')
  }
  return decision
}

// The first steps for a specimen's collecting event area (RecordInput.eventArea):
// the area, or, for an area no distribution uses (only its key is known), a
// step saying so. None without an event area.
function eventAreaSteps(record) {
  const eventArea = record.eventArea
  if (record.type === 'FieldOccurrence') return [none('the collecting event area of a field occurrence is not available from TaxonWorks', 'TaxonWorks')]
  if (!eventArea) return [none('the collecting event has no area', 'TaxonWorks')]
  if (eventArea.name == null) {
    return [none(`the collecting event's area ${eventArea.key} is used by no distribution, so its country and levels are not known; the DwC fields are read`, 'TaxonWorks')]
  }
  return [{ text: `the collecting event's area is ${label(eventArea)}`, source: 'TaxonWorks', via: 'eventArea' }]
}

// The first step of a specimen without coordinates: no shape either, or a
// shape that gives no point (footprint.js).
function noPointStep(record) {
  return none(String(record.footprint ?? '').trim()
    ? 'no coordinates, and the georeference shape gives no point'
    : 'no coordinates and no georeference shape', 'TaxonWorks')
}

// The steps with a stage, for steps made before a decision stamps them.
function stamped(steps, stage) {
  for (const step of steps) step.stage ??= stage
  return steps
}

// Marks the steps added since `from` with the decision they belong to (Step.stage).
function stamp(steps, from, stage) {
  for (let i = from; i < steps.length; i++) steps[i].stage ??= stage
}

// A decision turned into a Placement: the outline, and its step when none is cached.
function finish(decision, state, ctx) {
  const steps = decision.steps
  if (!decision.checklist) {
    return { checklist: null, part: null, state: null, shape: null, reason: decision.reason, steps }
  }
  const { checklist, part } = decision
  const shape = chooseShape(checklist, part, ctx)
  if (!shape) steps.push({ text: `no outline cached for ${checklist.name}`, source: 'TaxonWorks', stage: 'outline' })
  else if (shape.key.startsWith('fallback/')) {
    const entry = ctx.rules.checklists.find((candidate) => normalizeName(candidate.name) === normalizeName(checklist.name))
    if (entry?.outline === 'natural_earth') {
      steps.push({ text: `outline of ${checklist.name} from Natural Earth`, source: 'manual', ref: entry.outlineRef ?? entry.ref, stage: 'outline' })
    }
  }
  return {
    checklist: { id: checklist.id, name: checklist.name },
    part,
    state: state || null,
    shape,
    reason: null,
    steps
  }
}

// The decision itself: { checklist, part?, steps } or { checklist: null, reason, steps }.
// Every check that runs adds a step, also when it finds nothing (Step.none),
// so the explanation shows each check of the order up to the one that decided.
function decide(area, ctx) {
  const checked = []
  const decided = (decision) => ({ ...decision, steps: [...checked, ...decision.steps] })
  const manual = findRule(ctx.rules.manual, area)
  const overlap = findRule(ctx.rules.overlap, area)
  if (manual) {
    const measured = overlap?.measured ? ` ${overlap.measured}` : ''
    const override = overlap ? `; overrides the overlap measurement${measured} (${overlap.ref})` : ''
    return applyRule(manual, 'manual', area, ctx, override)
  }
  checked.push(none(`no manual rule for ${label(area)}`, 'manual'))

  const own = ownChecklist(area, ctx)
  if (own) return decided(own)
  checked.push(none(`${label(area)} matches no checklist of its own (by area, parent, ISO code or name)`, 'manual'))

  const political = byTaxonWorksCountry(area, ctx)
  if (political) return decided(political)
  checked.push(none(noCountryText(area, ctx), 'TaxonWorks'))

  if (area.kind === 'GZ' && area.iso2) {
    const iso = area.iso2.toUpperCase()
    const checklist = ctx.byIso.get(iso)
    if (checklist) {
      return decided(placed(checklist, [{ text: `${area.name} has ISO code ${iso}, ${checklist.name}`, source: 'TaxonWorks' }]))
    }
    return decided(notPlaced(`no checklist for ${iso}`, [
      { text: `${area.name} has ISO code ${iso}, which has no checklist`, source: 'TaxonWorks' }
    ]))
  }
  checked.push(none(area.kind === 'GZ'
    ? `${label(area)} has no ISO code in TaxonWorks`
    : `${label(area)} is no gazetteer; only a gazetteer is placed by its ISO code`, 'TaxonWorks'))

  if (overlap) return decided(applyRule(overlap, 'overlap', area, ctx, ''))
  checked.push(none(`no overlap rule for ${label(area)}`, 'overlap'))

  const key = shapeKey(area.kind, area.id)
  if (!ctx.shapes.has(key)) {
    return decided(notPlaced('no outline', [{ text: `${label(area)} has no country in TaxonWorks, no rule and no cached outline to measure`, source: 'TaxonWorks' }]))
  }
  if (ctx.unusable?.has(key)) {
    return decided(notPlaced(NO_POLYGON, [{ text: `${label(area)} has no country in TaxonWorks and no rule; its cached outline holds no polygon to measure`, source: 'TaxonWorks' }]))
  }
  return decided(notPlaced('not measured yet', [{
    text: `${label(area)} has no country in TaxonWorks and no rule; the next measuring run measures it`,
    source: 'TaxonWorks'
  }]))
}

// A check that ran and found nothing (Step.none). `pointTest` marks a point
// tested against outlines that lay in none (format.js tags it [overlap], not
// [overlap, never measured]).
function none(text, source, { pointTest = false } = {}) {
  return pointTest ? { text, source, none: true, pointTest: true } : { text, source, none: true }
}

/**
 * Does the record have a point the engine tests: coordinates, or a point in its
 * georeference shape? Used by the curator page to skip fetching the
 * collecting event area, which the engine would not use.
 * @param {RecordInput} record
 * @returns {boolean}
 */
export function hasPoint(record) {
  return pointOf(record) !== null || footprintPoint(record.footprint) !== null
}

// Why step 3 found no country: a gazetteer has none in TaxonWorks; an area
// without level0 has no parent, or a parent without checklist.
function noCountryText(area, ctx) {
  if (area.kind === 'GZ') return `${label(area)} is a gazetteer, which has no country in TaxonWorks`
  if (area.parentId == null) return `${label(area)} has no country and no parent in TaxonWorks`
  const parent = area.parentName ? `${area.parentName} (GA ${area.parentId})` : `GA ${area.parentId}`
  return `${label(area)} has no country in TaxonWorks, and its parent ${parent} has no checklist`
}

/** The reason for an area whose cached outline is a point or a line. */
const NO_POLYGON = 'no usable outline (no polygon)'

/** Reasons of an area that no rule decides and no outline could place (yet). */
const UNMEASURED = new Set(['no outline', NO_POLYGON, 'not measured yet'])

// First rule of a section that decides the country of the area (rules that
// only say "spans several states" never do).
function findRule(rules, area) {
  return rules.find((rule) => !isStateRule(rule) && ruleMatches(rule, area)) ?? null
}

/**
 * Does every match field of the rule fit the area?
 * @param {import('./rules.js').Rule} rule
 * @param {import('./areas.js').Area} area
 * @returns {boolean}
 */
export function ruleMatches({ match }, area) {
  if (match.area && match.area !== area.key) return false
  if (match.tdwg && match.tdwg !== area.tdwg) return false
  if (match.iso2 && match.iso2.toUpperCase() !== (area.iso2 ?? '').toUpperCase()) return false
  if (match.gazetteerPrefix &&
    !(area.kind === 'GZ' && normalizeName(area.name).startsWith(normalizeName(match.gazetteerPrefix)))) return false
  return true
}

// A rule that only gives the reason for no state (SEVERAL_STATES, OUTSIDE_STATES).
function isStateRule(rule) {
  const text = normalizeName(rule.action.notPlaceable)
  return text.startsWith(SEVERAL_STATES) || text.startsWith(OUTSIDE_STATES)
}

// A step citing a rule: its line, and for an overlap rule its measured share.
// The share is only attached when `pctOf` names the target it belongs to (the
// country or state the area was placed in). Steps that list several shares
// (not placeable, spans several states) pass none and carry no pct.
function ruleStep(rule, source, text, pctOf) {
  if (source !== 'overlap' || rule.pct === undefined || !pctOf) return { text, source, ref: rule.ref }
  return { text, source, ref: rule.ref, pct: rule.pct, pctOf }
}

// 'Indonesia 72%, Malaysia 28%': the measured shares without the date; ''
// for a measurement without shares ('no sample in any outline (2026-11-20)').
function sharesOf(rule) {
  if (!rule.measured || !rule.measured.includes('%')) return ''
  return rule.measured.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '')
}

// A manual or overlap rule turned into a decision. `suffix` ends the step text.
function applyRule(rule, source, area, ctx, suffix) {
  const step = (text, pctOf) => ruleStep(rule, source, text + suffix, pctOf)
  const why = rule.why ? ` (${rule.why})` : ''
  const { action } = rule

  if (action.notPlaceable) {
    const shares = sharesOf(rule)
    const reason = shares ? `${action.notPlaceable}: ${shares}` : action.notPlaceable
    return notPlaced(reason, [step(`${area.name} ${reason}${why}`)])
  }

  if (action.subdivisionOf) {
    const { country, part } = action.subdivisionOf
    const checklist = ctx.byName.get(normalizeName(country))
    const partText = part ? `, part ${part}` : ''
    const lead = `${label(area)} ${source === 'overlap' ? 'lies in' : 'counts as'}`
    if (!checklist) {
      return notPlaced(`no checklist for ${country}`, [step(`${lead} ${country}${partText}, which has no checklist${why}`)])
    }
    const decided = step(`${lead} ${checklist.name}${partText}${why}`, checklist.name)
    if (part) decided.decidesPart = true
    return placed(checklist, [decided], part ?? null)
  }

  // synonymousWith: the area is the same as another area, given by its key.
  const target = action.synonymousWith
  const [kind, idText] = target.split(' ')
  const entry = ctx.rules.checklists.find((e) => e.areas.includes(target))
  const checklist = entry ? ctx.byName.get(normalizeName(entry.name)) : kind === 'GA' ? ctx.byAreaId.get(Number(idText)) : null
  const first = step(`${label(area)} is the same area as ${target}${why}`, checklist?.name)
  if (!checklist) return notPlaced(`no checklist for ${target}`, [first])
  return placed(checklist, [first, entry
    ? { text: `${target} belongs to the checklist ${checklist.name}`, source: 'manual', ref: entry.ref }
    : { text: `${target} is in ${checklist.name}`, source: 'TaxonWorks' }])
}

// Step 2 of the order: a checklist of its own from the rules file.
function ownChecklist(area, ctx) {
  const parentKey = area.parentId != null ? `GA ${area.parentId}` : null
  const parentLabel = parentKey ? `${area.parentName} (${parentKey})` : null
  for (const entry of ctx.rules.checklists) {
    const checklist = ctx.byName.get(normalizeName(entry.name))
    if (!checklist) continue
    const own = (text) => ({ text, source: 'manual', ref: entry.ref })
    if (entry.areas.includes(area.key)) {
      return placed(checklist, [own(`${area.key} ${area.name} belongs to the checklist ${checklist.name}`)])
    }
    if (parentKey && entry.areas.includes(parentKey)) {
      return placed(checklist, [
        { text: `${area.name} is a subdivision of ${parentLabel}`, source: 'TaxonWorks' },
        own(`${parentLabel} belongs to the checklist ${checklist.name}`)
      ])
    }
    if (area.iso2 && area.iso2.toUpperCase() === entry.iso2.toUpperCase()) {
      return placed(checklist, [
        { text: `${area.name} has ISO code ${entry.iso2}`, source: 'TaxonWorks' },
        own(`ISO code ${entry.iso2} belongs to the checklist ${checklist.name}`)
      ])
    }
    const inName = entry.names.find((name) => containsName(area.name, name))
    if (inName) {
      return placed(checklist, [own(`${label(area)} contains the name ${inName} of the checklist ${checklist.name}`)])
    }
    const inParent = parentLabel && entry.names.find((name) => containsName(area.parentName, name))
    if (inParent) {
      return placed(checklist, [
        { text: `${area.name} is a subdivision of ${parentLabel}`, source: 'TaxonWorks' },
        own(`${parentLabel} contains the name ${inParent} of the checklist ${checklist.name}`)
      ])
    }
  }
  return null
}

// Step 3 of the order: the country TaxonWorks gives the area.
function byTaxonWorksCountry(area, ctx) {
  if (area.kind !== 'GA') return null
  // A country area without level0 is its own country, as TaxonWorks sees it
  // (GA 33412 United States of America: type Country, level0 empty; R17).
  const level0 = area.level0 ?? (isCountryArea(area) ? area.id : null)
  if (level0 != null) {
    const checklist = ctx.byAreaId.get(level0)
    const countryName = area.id === level0 ? area.name
      : area.parentId === level0 && area.parentName ? area.parentName : `GA ${level0}`
    if (!checklist) {
      return notPlaced(`no checklist for ${countryName}`, [{
        text: area.id === level0
          ? `${area.name} (GA ${area.id}) is a country without a checklist`
          : `${area.name} is in ${countryName} (GA ${level0}), which has no checklist`,
        source: 'TaxonWorks'
      }])
    }
    if (area.id !== level0) {
      return placed(checklist, [{ text: `${area.name} is in ${checklist.name} (GA ${level0})`, source: 'TaxonWorks' }])
    }
    const country = { text: `${area.name} (GA ${area.id}) is a country`, source: 'TaxonWorks' }
    if (normalizeName(area.name) === normalizeName(checklist.name)) return placed(checklist, [country])
    const synonym = synonymLine(ctx, area.name, checklist.name)
    if (synonym) {
      return placed(checklist, [country,
        { text: `${area.name} is a spelling of ${checklist.name}`, source: 'manual', ref: synonym.ref }])
    }
    // A country area under another country (England under United Kingdom, R10).
    return placed(checklist, [{ text: `${area.name} (GA ${area.id}) is part of ${checklist.name}`, source: 'TaxonWorks' }])
  }
  // No level0: a parent that belongs to a checklist still names the country.
  const checklist = area.parentId != null ? ctx.byAreaId.get(area.parentId) : null
  if (!checklist) return null
  const which = normalizeName(area.parentName) === normalizeName(checklist.name) ? '' : `, which is in ${checklist.name}`
  return placed(checklist, [{
    text: `${area.name} is a subdivision of ${area.parentName} (GA ${area.parentId})${which}`,
    source: 'TaxonWorks'
  }])
}

// The synonym line of the rules file that lists both names, or null.
function synonymLine(ctx, name, checklistName) {
  return ctx.rules.synonyms.find(({ names }) =>
    names.some((n) => normalizeName(n) === normalizeName(name)) &&
    names.some((n) => normalizeName(n) === normalizeName(checklistName))) ?? null
}

// The decision for a specimen or field occurrence (order at the top of the file).
async function decideRecord(record, point, ctx) {
  // 1. A checklist of its own, by a name in the DwC country, or in the
  // stateProvince or county when the DwC country is empty or is the country the
  // entry is filed under (`of`), so a county abroad is never captured.
  const country = text(record.country)
  const checked = []
  const decided = (decision) => ({ ...decision, steps: [...checked, ...decision.steps] })
  const read = new Map() // the DwC fields read with a value, for the step when none matches
  for (const entry of ctx.rules.checklists) {
    const checklist = ctx.byName.get(normalizeName(entry.name))
    if (!checklist) continue
    const loose = !country || (entry.of && ctx.byName.get(normalizeName(entry.of)) === ctx.byName.get(normalizeName(country)))
    const fields = [['country', country]]
    if (loose) fields.push(['stateProvince', text(record.stateProvince)], ['county', text(record.county)])
    for (const [field, value] of fields) {
      if (value) read.set(field, value)
      const name = value && entry.names.find((n) => containsName(value, n))
      if (name) {
        return placed(checklist, [{
          text: `DwC ${field} ${value} contains the name ${name} of the checklist ${checklist.name}`,
          source: 'manual',
          ref: entry.ref
        }])
      }
    }
  }
  checked.push(none(read.size
    ? `${[...read].map(([field, value]) => `DwC ${field} ${value}`).join(', ')} ${read.size > 1 ? 'carry' : 'carries'} no name of a checklist of its own`
    : 'no DwC country, stateProvince or county to name a checklist of its own', 'manual'))

  // 2. The DwC country, matched against checklist names and synonyms only.
  if (country) {
    const checklist = ctx.byName.get(normalizeName(country))
    if (!checklist) {
      return decided(notPlaced(`no checklist for ${country}`, [{ text: `DwC country is ${country}, which has no checklist`, source: 'TaxonWorks' }]))
    }
    const steps = [{ text: `DwC country is ${country}`, source: 'TaxonWorks' }]
    if (normalizeName(country) !== normalizeName(checklist.name)) {
      const synonym = synonymLine(ctx, country, checklist.name)
      steps.push({ text: `${country} is a spelling of ${checklist.name}`, source: 'manual', ...(synonym ? { ref: synonym.ref } : {}) })
    }
    return decided(placed(checklist, steps))
  }
  checked.push(none('no DwC country', 'TaxonWorks'))

  // 3. The coordinates, inside exactly one checklist outline.
  if (point) {
    const where = `coordinates ${point.lat}, ${point.lng}`
    if (!ctx.geometry) {
      return decided(notPlaced('coordinates not checked', [{ text: `${where} were not checked: no outlines given`, source: 'TaxonWorks' }]))
    }
    const { ids, near } = await ctx.geometry.checklistsAt([point.lng, point.lat])
    const hits = [...new Set(ids.map((id) => ctx.byId.get(id)).filter(Boolean))]
    const coast = coastStep(ctx)
    if (hits.length === 1) {
      return decided(placed(hits[0], [near
        ? coast(`${where} lie ${coast.within} of the coast of ${hits[0].name}`)
        : { text: `${where} lie inside ${hits[0].name}`, source: 'overlap' }]))
    }
    if (hits.length > 1) {
      const names = hits.map((checklist) => checklist.name).sort((a, b) => a.localeCompare(b, 'en')).join(', ')
      return decided(notPlaced(`coordinates in several countries (${names})`, [near
        ? coast(`${where} lie ${coast.within} of the coasts of ${names}`)
        : { text: `${where} lie inside ${names}`, source: 'overlap' }]))
    }
    return decided(notPlaced('coordinates outside every outline', [{ text: `${where} lie outside every checklist outline`, source: 'overlap' }]))
  }
  // (No coordinates: placeRecord already said so in its first step.)

  // 4. Nothing to place it by.
  if (text(record.locality)) {
    return decided(notPlaced('locality text only', [{ text: 'no DwC country and no coordinates, only locality text', source: 'TaxonWorks' }]))
  }
  return decided(notPlaced('no locality at all', [{ text: 'no DwC country, no coordinates and no locality', source: 'TaxonWorks' }]))
}

// The part of a record's checklist (France): a part name in its DwC
// stateProvince or county; else the part whose outline (or box) holds its
// coordinates (Geometry.partAt); else the rest part when it has a
// stateProvince or coordinates (below country level). As the old build did.
async function recordPart(record, point, checklist, ctx, steps) {
  const parts = ctx.rules.parts[checklist.name]
  if (!parts) return null
  const fields = [['stateProvince', text(record.stateProvince)], ['county', text(record.county)]]
  for (const part of parts) {
    for (const [field, value] of fields) {
      const name = value && part.names.find((n) => containsName(value, n))
      if (name) {
        steps.push({ text: `DwC ${field} ${value} carries the name ${name} of the part ${part.name}`, source: 'manual', ref: part.ref })
        return part.name
      }
    }
  }
  const withValue = fields.filter(([, value]) => value)
  steps.push(none(withValue.length
    ? `${withValue.map(([field, value]) => `DwC ${field} ${value}`).join(', ')} ${withValue.length > 1 ? 'carry' : 'carries'} no part name of ${checklist.name}`
    : 'no DwC stateProvince or county', withValue.length ? 'manual' : 'TaxonWorks'))
  const where = point ? `coordinates ${point.lat}, ${point.lng}` : ''
  if (point && ctx.geometry?.partAt) {
    const hit = await ctx.geometry.partAt(checklist.id, [point.lng, point.lat])
    const part = hit && parts.find((candidate) => candidate.name === hit.name)
    if (part) {
      steps.push(hit.by === 'box'
        ? { text: `${where} lie inside the rough box of the part ${part.name}`, source: 'manual', ref: part.ref }
        : { text: `${where} lie inside ${part.name}`, source: 'overlap' })
      return part.name
    }
    steps.push(none(`${where} lie in no part of ${checklist.name}`, 'overlap', { pointTest: true }))
  } else if (!point) {
    steps.push(none('no coordinates', 'TaxonWorks'))
  }
  const rest = parts.find((part) => part.rest)
  if (!rest) {
    steps.push(none(`no part of ${checklist.name} takes the rest of the country`, 'manual'))
    return null
  }
  const province = text(record.stateProvince)
  if (province) {
    steps.push({ text: `DwC stateProvince ${province} is below country level, so it goes to the part ${rest.name}`, source: 'manual', ref: rest.ref })
    return rest.name
  }
  if (point) {
    steps.push({ text: `${where} lie below country level, so they go to the part ${rest.name}`, source: 'manual', ref: rest.ref })
    return rest.name
  }
  steps.push({ text: 'no part: nothing below country level', source: 'TaxonWorks' })
  return null
}

// The state of an asserted distribution's area, adding its step; null when none.
function areaState(area, checklist, ctx, steps) {
  if (!checklist.states) return null
  const index = statesOf(checklist, ctx)
  // A manual state rule wins over names, as manual rules do for countries.
  const ruled = stateByRule(area, checklist, ctx, index, [[ctx.rules.manual, 'manual']], steps)
  if (ruled) return ruled
  steps.push(none(`no manual rule gives ${label(area)} a state`, 'manual'))
  const noLevels = area.kind === 'GZ' || String(area.origin ?? '').includes('tdwg')
  const parentIsCountry = area.parentId != null && checklist.areaIds.includes(area.parentId)
  if (noLevels || isStateArea(area, parentIsCountry)) {
    const own = matchSubdivision(index, area.name)
    if (own) {
      steps.push(stateStep(own, ctx, {
        exact: `${label(area)} is the state ${own.state}`,
        words: `${label(area)} matches`
      }))
      return own.state
    }
    steps.push(none(`${area.name} is no state name of ${checklist.name}`, 'TaxonWorks'))
  } else {
    steps.push(none(`${label(area)} is not a state-level area in TaxonWorks, so its name is not read as a state`, 'TaxonWorks'))
  }
  const parentIsState = area.parentName && (area.level1 == null || area.parentId === area.level1)
  const fromParent = parentIsState ? matchSubdivision(index, area.parentName) : null
  const parentKey = area.parentId != null ? ` (GA ${area.parentId})` : ''
  if (fromParent) {
    const subdivision = `${area.name} is a subdivision of ${area.parentName}${parentKey}`
    steps.push(stateStep(fromParent, ctx, {
      exact: `${subdivision}, the state ${fromParent.state}`,
      words: `${subdivision}, which matches`
    }))
    return fromParent.state
  }
  steps.push(none(!area.parentName
    ? `${area.name} has no parent in TaxonWorks`
    : parentIsState
      ? `the parent ${area.parentName}${parentKey} is no state name of ${checklist.name}`
      : `the parent ${area.parentName}${parentKey} is not the state-level area of ${area.name} in TaxonWorks`, 'TaxonWorks'))
  const measured = stateByRule(area, checklist, ctx, index, [[ctx.rules.overlap, 'overlap']], steps)
  if (measured) return measured
  steps.push(none(`no overlap rule gives ${label(area)} a state`, 'overlap'))
  const sections = [[ctx.rules.manual, 'manual'], [ctx.rules.overlap, 'overlap']]
  if (area.kind === 'GA' && checklist.areaIds.includes(area.id)) {
    steps.push({ text: 'no state: record is for the whole country', source: 'TaxonWorks' })
    return null
  }
  steps.push(none(`${label(area)} is not the whole of ${checklist.name}`, 'TaxonWorks'))
  for (const [rules, source] of sections) {
    const spans = rules.find((rule) => isStateRule(rule) && ruleMatches(rule, area))
    if (spans) {
      const shares = sharesOf(spans)
      steps.push(ruleStep(spans, source, `no state: ${spans.action.notPlaceable}${shares ? `: ${shares}` : ''}`))
      return null
    }
    steps.push(none(`no ${source} rule says ${label(area)} spans several states or lies outside them`, source))
  }
  const key = shapeKey(area.kind, area.id)
  if (!ctx.shapes.has(key)) steps.push({ text: 'no state: no outline to measure', source: 'TaxonWorks' })
  else if (ctx.unusable?.has(key)) steps.push({ text: `no state: ${NO_POLYGON}`, source: 'TaxonWorks' })
  else steps.push({ text: 'no state: not measured yet', source: 'TaxonWorks' })
  return null
}

// The state a manual or overlap rule of `sections` gives the area, adding its step; null when none.
function stateByRule(area, checklist, ctx, index, sections, steps) {
  for (const [rules, source] of sections) {
    for (const rule of rules) {
      const sub = rule.action.subdivisionOf
      if (!sub?.state || !ruleMatches(rule, area) || ctx.byName.get(normalizeName(sub.country)) !== checklist) continue
      const state = resolveSubdivision(index, sub.state) || sub.state
      const why = rule.why ? ` (${rule.why})` : ''
      steps.push(ruleStep(rule, source, `${label(area)} ${source === 'overlap' ? 'lies in' : 'counts as'} the state ${state}${why}`, state))
      return state
    }
  }
  return null
}

// The state of a specimen or field occurrence, adding its step; null when none.
async function recordState(record, point, checklist, ctx, steps) {
  if (!checklist.states) return null
  const province = text(record.stateProvince)
  const named = province ? matchSubdivision(statesOf(checklist, ctx), province) : null
  if (named) {
    steps.push(stateStep(named, ctx, {
      exact: `DwC stateProvince ${province} is the state ${named.state}`,
      prefix: 'DwC stateProvince'
    }))
    return named.state
  }
  steps.push(none(province ? `DwC stateProvince ${province} is no state name of ${checklist.name}` : 'no DwC stateProvince', 'TaxonWorks'))
  // stateProvince is the name of a TaxonWorks area of this checklist: its state decision.
  const area = province ? ctx.stateAreas.get(checklist.id)?.get(normalizeName(province)) : null
  if (area) {
    const own = []
    const state = areaState(area, checklist, ctx, own)
    const decided = own.at(-1)
    if (state && decided) {
      const verb = decided.source === 'manual' ? 'counts as' : decided.source === 'overlap' ? 'lies in' : 'is in'
      steps.push({ ...decided, text: `DwC stateProvince ${province} is TaxonWorks area ${area.key}, which ${verb} the state ${state}` })
      return state
    }
  }
  if (province) {
    steps.push(none(area
      ? `DwC stateProvince ${province} is TaxonWorks area ${area.key}, which has no state`
      : `DwC stateProvince ${province} is no TaxonWorks area of ${checklist.name} in the cache`, 'TaxonWorks'))
  }
  if (point && ctx.geometry) {
    const where = `coordinates ${point.lat}, ${point.lng}`
    const hit = await ctx.geometry.stateAt(checklist.id, [point.lng, point.lat])
    if (hit) {
      const coast = coastStep(ctx)
      steps.push(hit.near
        ? coast(`${where} lie ${coast.within} of the coast of the state ${hit.name}`)
        : { text: `${where} lie inside the state ${hit.name}`, source: 'overlap' })
      return hit.name
    }
    steps.push({ text: `no state: ${where} lie in no state outline of ${checklist.name}`, source: 'overlap' })
    return null
  }
  steps.push(none(point ? 'coordinates not checked: no outlines given' : 'no coordinates', 'TaxonWorks'))
  steps.push({
    text: province ? `no state: ${province} is not a state of ${checklist.name}` : 'no state: no DwC stateProvince and no coordinates',
    source: 'TaxonWorks'
  })
  return null
}

// The step for a state found by name (states.js matchSubdivision). `texts.exact`
// is the text when the state's own name matched [TaxonWorks]. Else the text
// says which words of the rules file's ignored_name_words were left out
// [manual, that line]: `${prefix} "Pskov Oblast" matches the state Pskov
// (ignoring "oblast")`. A caller may give its own `words` start instead of `prefix`.
function stateStep(match, ctx, texts) {
  const { state, candidate, ignored } = match
  if (!ignored.length) return { text: texts.exact, source: 'TaxonWorks' }
  const start = texts.words ?? `${texts.prefix} "${candidate}" matches`
  const target = `the state ${state}`
  const words = ignored.map((word) => `"${word}"`).join(', ')
  return { text: `${start} ${target} (ignoring ${words})`, source: 'manual', ref: ctx.rules.ignoredNameWords?.ref }
}

// The state name index of a checklist, built once per context.
function statesOf(checklist, ctx) {
  if (!ctx.stateIndexes.has(checklist.id)) {
    const words = ctx.rules.ignoredNameWords?.words ?? []
    ctx.stateIndexes.set(checklist.id, stateIndex(ctx.geometry?.stateNames(checklist.id) ?? [], words))
  }
  return ctx.stateIndexes.get(checklist.id)
}

// { lat, lng } as numbers when the record has both, else null.
function pointOf(record) {
  const lat = text(record.lat)
  const lng = text(record.lng)
  if (!lat || !lng) return null
  const point = { lat: Number(lat), lng: Number(lng) }
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : null
}

// Trimmed text, '' for null and undefined.
function text(value) {
  return value == null ? '' : String(value).trim()
}

// The part of a checklist with parts (France), adding its step; null when none fits.
function choosePart(area, checklist, ctx, steps) {
  const parts = ctx.rules.parts[checklist.name]
  if (!parts) return null
  const parentKey = area.parentId != null ? `GA ${area.parentId}` : null
  for (const part of parts) {
    const step = (text) => ({ text, source: 'manual', ref: part.ref })
    if (part.areas.includes(area.key)) {
      steps.push(step(`${label(area)} belongs to the part ${part.name}`))
      return part.name
    }
    if (parentKey && part.areas.includes(parentKey)) {
      steps.push(step(`${area.parentName} (${parentKey}) belongs to the part ${part.name}`))
      return part.name
    }
    const inName = part.names.find((name) => containsName(area.name, name) || containsName(area.parentName, name))
    if (inName) {
      steps.push(step(`${label(area)} carries the name ${inName} of the part ${part.name}`))
      return part.name
    }
  }
  steps.push(none(`no part of ${checklist.name} lists ${label(area)} or its parent, and neither name contains a part name`, 'manual'))
  const belowCountry = !(area.kind === 'GA' && checklist.areaIds.includes(area.id))
  const rest = parts.find((part) => part.rest)
  if (belowCountry && rest) {
    steps.push({ text: `${label(area)} is below country level, so it goes to the part ${rest.name}`, source: 'manual', ref: rest.ref })
    return rest.name
  }
  steps.push(belowCountry
    ? { text: `no part: no part of ${checklist.name} takes the rest of the country`, source: 'manual' }
    : { text: `no part: ${label(area)} is the whole of ${checklist.name}`, source: 'TaxonWorks' })
  return null
}

// The outline to show: the part's first cached GA area, else the checklist's
// (context `outlines`, else its first cached area).
function chooseShape(checklist, part, ctx) {
  const partEntry = part ? (ctx.rules.parts[checklist.name] ?? []).find((p) => p.name === part) : null
  const partIds = (partEntry?.areas ?? []).filter((key) => key.startsWith('GA ')).map((key) => Number(key.slice(3)))
  const partId = partIds.find((id) => ctx.shapes.has(shapeKey('GA', id)))
  if (partId != null) return { key: shapeKey('GA', partId), name: part }
  if (ctx.outlines) {
    const key = ctx.outlines.get(checklist.id)
    return key ? { key, name: checklist.name } : null
  }
  const id = checklist.areaIds.find((areaId) => ctx.shapes.has(shapeKey('GA', areaId)))
  return id != null ? { key: shapeKey('GA', id), name: checklist.name } : null
}

// A step for a point that lies outside every outline but within the coastal
// tolerance of one: the rules file line of coastal_tolerance_degrees.
// `within` is 'within about 5 km' (degrees times 111, rounded down).
function coastStep(ctx) {
  const { degrees = 0, ref = null } = ctx.rules.coastalTolerance ?? {}
  const step = (text) => ({ text, source: 'overlap', ...(ref ? { ref } : {}) })
  step.within = `within about ${Math.max(1, Math.floor(degrees * 111))} km`
  return step
}

function shapeKey(kind, id) {
  return `${kind === 'GZ' ? 'Gazetteer' : 'GeographicArea'}/${id}`
}

// 'France (TDWG 12FRA)' for TDWG areas, else 'Corse (GA 32254)'.
function label(area) {
  return area.tdwg ? `${area.name} (TDWG ${area.tdwg})` : `${area.name} (${area.key})`
}

function placed(checklist, steps, part = null) {
  return { checklist, part, steps }
}

function notPlaced(reason, steps) {
  return { checklist: null, reason, steps }
}
