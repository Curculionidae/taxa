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
//         compileRules), a Geometry (point lookups on outlines, see the typedef)
//         and the set of cached outline keys ('GeographicArea/32253').
// Output: a Placement (see the typedef): the checklist or null with a reason,
//         the part (France: Corsica, Mainland France), the state, the outline
//         to show, and the steps of the decision.
// Purity: no network, no file system, no Node-only APIs, no hidden state. The
//         same input always gives the same Placement, in Node and in the browser.
//         Everything that needs outlines goes through the injected Geometry
//         (which may fetch in the browser), so placeRecord is async; placeArea
//         never calls the Geometry and stays synchronous.
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
//  6. otherwise not placeable, with the reason
// Then the part of the checklist (France) and the outline.
//
// Decision order for a specimen or field occurrence (placeRecord):
//  1. a checklist of its own: a word of its `names` is in the DwC country,
//     stateProvince or county (France + stateProvince French Guiana)
//  2. the DwC country (TaxonWorks computes it from the georeference or the
//     collecting event's area), through the synonyms of the rules file; a DwC
//     country without checklist is not placeable ('no checklist for Kosovo')
//  3. no DwC country but coordinates: the checklist outline that contains
//     them (Geometry.checklistsAt), when exactly one does
//  4. otherwise not placeable: 'locality text only' or 'no locality at all'
//  Step 1 reads stateProvince and county only when the DwC country is empty
//  or is the entry's `of` country (France), so a county abroad is never captured.
// Then the part (France: a part name in stateProvince or county, else the part
// holding the coordinates (Geometry.partAt), else the rest part when the record
// has a stateProvince or coordinates).
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
//    step 'no state: ...' (record is for the whole country, spans several
//    states: <shares>, not measured yet). Never calls the Geometry for
//    outlines, only for the names.
//  specimen: the DwC stateProvince is a state [TaxonWorks]; else the state
//    outline that contains the coordinates (Geometry.stateAt) [overlap]; else
//    no state, with the reason.
// State names are matched only against the states of the chosen checklist
// (states.js), never against countries, so the US state Georgia never meets
// the country Georgia. A name matches a state's own name [TaxonWorks], one of
// its Natural Earth aliases (Moskva for Moscow) [Natural Earth], or either
// after leaving out the rules file's ignored_name_words ("Krasnoyarsk Krai"
// for Krasnoyarsk) [manual, the line of that list]; the step says which.
import { normalizeName, containsName, isCountryArea, isStateArea } from './areas.js'
import { stateIndex, resolveSubdivision, matchSubdivision } from './states.js'

/**
 * Start of a `not_placeable` text that speaks about states, not countries: a
 * rule with it (written by the measuring script for an area that lies in one
 * country but several of its states) never decides the country, it only gives
 * the reason for no state ('spans several states: Moscow Oblast 18%, ...').
 */
export const SEVERAL_STATES = 'spans several states'

/**
 * @typedef {Object} Step  one sentence of an explanation
 * @property {string} text  short plain sentence; the source tag and line are not part of it
 * @property {'TaxonWorks'|'Natural Earth'|'manual'|'overlap'} source  TaxonWorks data,
 *   a Natural Earth alias of a state (subdivisions.geojson `aliases`), a hand-written
 *   line of the rules file, or a measured overlap line of the rules file
 * @property {string} [ref]  'placement.yml:12', the rules file line, for manual and overlap
 * @property {number} [pct]  the measured share of an overlap step
 * @property {string} [pctOf]  the name the share refers to (the country of a country
 *   rule, the state of a state rule); set on every step that has `pct`
 *
 * @typedef {Object} Placement
 * @property {{ id: number|string, name: string } | null} checklist  null when not placeable
 * @property {string|null} part   part of the checklist (France: 'Corsica'), else null
 * @property {string|null} state  state or province (only for checklists with `states`);
 *   always null from placeArea, filled by placeRecord
 * @property {{ key: string, name: string } | null} shape  cached outline to show,
 *   key 'GeographicArea/32253'; null when not placeable or when no outline is cached
 * @property {string|null} reason  why it is not placeable ('no outline', 'not measured
 *   yet', 'no checklist for Kosovo', 'spans several countries: ...', 'coordinates in
 *   several countries (Russia, Ukraine)', 'coordinates outside every outline', 'locality
 *   text only', 'no locality at all'), null when placed
 * @property {Step[]} steps  the decision, in order
 *
 * @typedef {Object} Geometry  lookups on cached outlines, injected so the engine stays
 *   pure (the build reads files, the browser fetches; implemented in Task 7 and 11)
 * @property {(point: [number, number]) => Promise<Array<number|string>>} checklistsAt
 *   ids of the checklists whose outline contains the point [lng, lat]
 * @property {(checklistId: number|string, point: [number, number]) => Promise<string|null>} stateAt
 *   the state of that checklist whose outline contains the point, null when none
 * @property {(checklistId: number|string, point: [number, number]) => Promise<string|null>} partAt
 *   the part of that checklist (France: Corsica) whose outline holds the point, else
 *   whose `box` from the rules file holds it; null when none (R19)
 * @property {(checklistId: number|string) => { name: string, aliases: string[] }[]} stateNames
 *   the states of a checklist with `states`, each with its Natural Earth aliases
 *   (subdivisions.geojson `properties.aliases`, [] when none); [] for any other checklist
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
 *
 * @typedef {Object} Context  lookups made once, shared by every placement
 * @property {import('./checklists.js').Checklist[]} checklists
 * @property {import('./rules.js').CompiledRules} rules
 * @property {Geometry|null} geometry
 * @property {Set<string>} shapes  cached outline keys, 'GeographicArea/32253' or 'Gazetteer/3529'
 * @property {Map<number, import('./checklists.js').Checklist>} byAreaId  GA id to checklist
 * @property {Map<string, import('./checklists.js').Checklist>} byIso  upper case ISO code to checklist
 * @property {Map<string, import('./checklists.js').Checklist>} byName  normalized name or synonym to checklist
 * @property {Map<number|string, import('./checklists.js').Checklist>} byId  checklist id to checklist
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
 * @returns {Context}
 */
export function createContext({ checklists, rules, geometry = null, shapes = new Set() }) {
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
  return { checklists, rules, geometry, shapes, byAreaId, byIso, byName, byId, stateIndexes: new Map() }
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
    const state = decision.checklist ? areaState(area, decision.checklist, ctx, decision.steps) : null
    return finish(decision, state, ctx)
  }
  const point = pointOf(record)
  const decision = await decideRecord(record, point, ctx)
  if (!decision.checklist) return finish(decision, null, ctx)
  decision.part = decision.part ?? await recordPart(record, point, decision.checklist, ctx, decision.steps)
  const state = await recordState(record, point, decision.checklist, ctx, decision.steps)
  return finish(decision, state, ctx)
}

// The checklist and part of an area, with steps.
function decideArea(area, ctx) {
  const decision = decide(area, ctx)
  if (decision.checklist) decision.part = decision.part ?? choosePart(area, decision.checklist, ctx, decision.steps)
  return decision
}

// A decision turned into a Placement: the outline, and its step when none is cached.
function finish(decision, state, ctx) {
  const steps = decision.steps
  if (!decision.checklist) {
    return { checklist: null, part: null, state: null, shape: null, reason: decision.reason, steps }
  }
  const { checklist, part } = decision
  const shape = chooseShape(checklist, part, ctx)
  if (!shape) steps.push({ text: `no outline cached for ${checklist.name}`, source: 'TaxonWorks' })
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
function decide(area, ctx) {
  const manual = findRule(ctx.rules.manual, area)
  const overlap = findRule(ctx.rules.overlap, area)
  if (manual) {
    const measured = overlap?.measured ? ` ${overlap.measured}` : ''
    const override = overlap ? `; overrides the overlap measurement${measured} (${overlap.ref})` : ''
    return applyRule(manual, 'manual', area, ctx, override)
  }

  const own = ownChecklist(area, ctx)
  if (own) return own

  const political = byTaxonWorksCountry(area, ctx)
  if (political) return political

  if (area.kind === 'GZ' && area.iso2) {
    const iso = area.iso2.toUpperCase()
    const checklist = ctx.byIso.get(iso)
    if (checklist) {
      return placed(checklist, [{ text: `${area.name} has ISO code ${iso}, ${checklist.name}`, source: 'TaxonWorks' }])
    }
    return notPlaced(`no checklist for ${iso}`, [
      { text: `${area.name} has ISO code ${iso}, which has no checklist`, source: 'TaxonWorks' }
    ])
  }

  if (overlap) return applyRule(overlap, 'overlap', area, ctx, '')

  const cached = ctx.shapes.has(shapeKey(area.kind, area.id))
  return notPlaced(cached ? 'not measured yet' : 'no outline', [{
    text: cached
      ? `${label(area)} has no country in TaxonWorks and no rule; the next measuring run measures it`
      : `${label(area)} has no country in TaxonWorks, no rule and no cached outline to measure`,
    source: 'TaxonWorks'
  }])
}

// First rule of a section that decides the country of the area (rules that
// only say "spans several states" never do).
function findRule(rules, area) {
  return rules.find((rule) => !isStateRule(rule) && ruleMatches(rule, area)) ?? null
}

// Does every match field of the rule fit the area?
function ruleMatches({ match }, area) {
  if (match.area && match.area !== area.key) return false
  if (match.tdwg && match.tdwg !== area.tdwg) return false
  if (match.iso2 && match.iso2.toUpperCase() !== (area.iso2 ?? '').toUpperCase()) return false
  if (match.gazetteerPrefix &&
    !(area.kind === 'GZ' && normalizeName(area.name).startsWith(normalizeName(match.gazetteerPrefix)))) return false
  return true
}

function isStateRule(rule) {
  return normalizeName(rule.action.notPlaceable).startsWith(SEVERAL_STATES)
}

// A step citing a rule: its line, and for an overlap rule its measured share.
// The share is only attached when `pctOf` names the target it belongs to (the
// country or state the area was placed in). Steps that list several shares
// (not placeable, spans several states) pass none and carry no pct.
function ruleStep(rule, source, text, pctOf) {
  if (source !== 'overlap' || rule.pct === undefined || !pctOf) return { text, source, ref: rule.ref }
  return { text, source, ref: rule.ref, pct: rule.pct, pctOf }
}

// 'Indonesia 72%, Malaysia 28%': the measured shares without the date.
function sharesOf(rule) {
  return rule.measured ? rule.measured.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '') : ''
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
    return placed(checklist, [step(`${lead} ${checklist.name}${partText}${why}`, checklist.name)], part ?? null)
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
  for (const entry of ctx.rules.checklists) {
    const checklist = ctx.byName.get(normalizeName(entry.name))
    if (!checklist) continue
    const loose = !country || (entry.of && ctx.byName.get(normalizeName(entry.of)) === ctx.byName.get(normalizeName(country)))
    const fields = [['country', country]]
    if (loose) fields.push(['stateProvince', text(record.stateProvince)], ['county', text(record.county)])
    for (const [field, value] of fields) {
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

  // 2. The DwC country, matched against checklist names and synonyms only.
  if (country) {
    const checklist = ctx.byName.get(normalizeName(country))
    if (!checklist) {
      return notPlaced(`no checklist for ${country}`, [{ text: `DwC country is ${country}, which has no checklist`, source: 'TaxonWorks' }])
    }
    const steps = [{ text: `DwC country is ${country}`, source: 'TaxonWorks' }]
    if (normalizeName(country) !== normalizeName(checklist.name)) {
      const synonym = synonymLine(ctx, country, checklist.name)
      steps.push({ text: `${country} is a spelling of ${checklist.name}`, source: 'manual', ...(synonym ? { ref: synonym.ref } : {}) })
    }
    return placed(checklist, steps)
  }

  // 3. The coordinates, inside exactly one checklist outline.
  if (point) {
    const where = `coordinates ${point.lat}, ${point.lng}`
    if (!ctx.geometry) {
      return notPlaced('coordinates not checked', [{ text: `${where} were not checked: no outlines given`, source: 'TaxonWorks' }])
    }
    const ids = await ctx.geometry.checklistsAt([point.lng, point.lat])
    const hits = [...new Set(ids.map((id) => ctx.byId.get(id)).filter(Boolean))]
    if (hits.length === 1) return placed(hits[0], [{ text: `${where} lie inside ${hits[0].name}`, source: 'overlap' }])
    if (hits.length > 1) {
      const names = hits.map((checklist) => checklist.name).sort((a, b) => a.localeCompare(b, 'en')).join(', ')
      return notPlaced(`coordinates in several countries (${names})`, [{ text: `${where} lie inside ${names}`, source: 'overlap' }])
    }
    return notPlaced('coordinates outside every outline', [{ text: `${where} lie outside every checklist outline`, source: 'overlap' }])
  }

  // 4. Nothing to place it by.
  if (text(record.locality)) {
    return notPlaced('locality text only', [{ text: 'no DwC country and no coordinates, only locality text', source: 'TaxonWorks' }])
  }
  return notPlaced('no locality at all', [{ text: 'no DwC country, no coordinates and no locality', source: 'TaxonWorks' }])
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
  const where = point ? `coordinates ${point.lat}, ${point.lng}` : ''
  if (point && ctx.geometry?.partAt) {
    const name = await ctx.geometry.partAt(checklist.id, [point.lng, point.lat])
    if (name && parts.some((part) => part.name === name)) {
      steps.push({ text: `${where} lie inside ${name}`, source: 'overlap' })
      return name
    }
  }
  const rest = parts.find((part) => part.rest)
  if (!rest) return null
  const province = text(record.stateProvince)
  if (province) {
    steps.push({ text: `DwC stateProvince ${province} is below country level, so it goes to the part ${rest.name}`, source: 'manual', ref: rest.ref })
    return rest.name
  }
  if (point) {
    steps.push({ text: `${where} lie below country level, so they go to the part ${rest.name}`, source: 'manual', ref: rest.ref })
    return rest.name
  }
  return null
}

// The state of an asserted distribution's area, adding its step; null when none.
function areaState(area, checklist, ctx, steps) {
  if (!checklist.states) return null
  const index = statesOf(checklist, ctx)
  // A manual state rule wins over names, as manual rules do for countries
  // (Chukot, which Natural Earth lists as a name of Sakha).
  const ruled = stateByRule(area, checklist, ctx, index, [[ctx.rules.manual, 'manual']], steps)
  if (ruled) return ruled
  const noLevels = area.kind === 'GZ' || String(area.origin ?? '').includes('tdwg')
  const parentIsCountry = area.parentId != null && checklist.areaIds.includes(area.parentId)
  if (noLevels || isStateArea(area, parentIsCountry)) {
    const own = matchSubdivision(index, area.name)
    if (own) {
      steps.push(stateStep(own, ctx, {
        exact: `${label(area)} is the state ${own.state}`,
        alias: `${label(area)} is a Natural Earth name of the state ${own.state}`,
        words: `${label(area)} matches`
      }))
      return own.state
    }
  }
  const parentIsState = area.parentName && (area.level1 == null || area.parentId === area.level1)
  const fromParent = parentIsState ? matchSubdivision(index, area.parentName) : null
  if (fromParent) {
    const parentKey = area.parentId != null ? ` (GA ${area.parentId})` : ''
    const subdivision = `${area.name} is a subdivision of ${area.parentName}${parentKey}`
    steps.push(stateStep(fromParent, ctx, {
      exact: `${subdivision}, the state ${fromParent.state}`,
      alias: `${subdivision}, a Natural Earth name of the state ${fromParent.state}`,
      words: `${subdivision}, which matches`
    }))
    return fromParent.state
  }
  const measured = stateByRule(area, checklist, ctx, index, [[ctx.rules.overlap, 'overlap']], steps)
  if (measured) return measured
  const sections = [[ctx.rules.manual, 'manual'], [ctx.rules.overlap, 'overlap']]
  if (area.kind === 'GA' && checklist.areaIds.includes(area.id)) {
    steps.push({ text: 'no state: record is for the whole country', source: 'TaxonWorks' })
    return null
  }
  for (const [rules, source] of sections) {
    const spans = rules.find((rule) => isStateRule(rule) && ruleMatches(rule, area))
    if (spans) {
      const shares = sharesOf(spans)
      steps.push(ruleStep(spans, source, `no state: ${SEVERAL_STATES}${shares ? `: ${shares}` : ''}`))
      return null
    }
  }
  steps.push({ text: 'no state: not measured yet', source: 'TaxonWorks' })
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
  if (point && ctx.geometry) {
    const where = `coordinates ${point.lat}, ${point.lng}`
    const state = await ctx.geometry.stateAt(checklist.id, [point.lng, point.lat])
    if (state) {
      steps.push({ text: `${where} lie inside the state ${state}`, source: 'overlap' })
      return state
    }
    steps.push({ text: `no state: ${where} lie in no state outline of ${checklist.name}`, source: 'overlap' })
    return null
  }
  steps.push({
    text: province ? `no state: ${province} is not a state of ${checklist.name}` : 'no state: no DwC stateProvince and no coordinates',
    source: 'TaxonWorks'
  })
  return null
}

// The step for a state found by name (states.js matchSubdivision). `texts.exact`
// is the text when the state's own name matched [TaxonWorks]. Else the text
// says which Natural Earth alias matched [Natural Earth], or which words of the
// rules file's ignored_name_words were left out [manual, that line]:
// `${prefix} "Pskov Oblast" matches the state Pskov (ignoring "oblast")`. A
// caller may give its own `alias` text and `words` start instead of `prefix`.
function stateStep(match, ctx, texts) {
  const { state, candidate, alias, ignored } = match
  if (!alias && !ignored.length) return { text: texts.exact, source: 'TaxonWorks' }
  if (!ignored.length) {
    return { text: texts.alias ?? `${texts.prefix} ${candidate} is a Natural Earth name of the state ${state}`, source: 'Natural Earth' }
  }
  const start = texts.words ?? `${texts.prefix} "${candidate}" matches`
  const target = alias ? `${alias}, a Natural Earth name of the state ${state}` : `the state ${state}`
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
  const belowCountry = !(area.kind === 'GA' && checklist.areaIds.includes(area.id))
  const rest = parts.find((part) => part.rest)
  if (belowCountry && rest) {
    steps.push({ text: `${label(area)} is below country level, so it goes to the part ${rest.name}`, source: 'manual', ref: rest.ref })
    return rest.name
  }
  return null
}

// The outline to show: the part's first cached GA area, else the checklist's.
function chooseShape(checklist, part, ctx) {
  const partEntry = part ? (ctx.rules.parts[checklist.name] ?? []).find((p) => p.name === part) : null
  const partIds = (partEntry?.areas ?? []).filter((key) => key.startsWith('GA ')).map((key) => Number(key.slice(3)))
  const partId = partIds.find((id) => ctx.shapes.has(shapeKey('GA', id)))
  if (partId != null) return { key: shapeKey('GA', partId), name: part }
  const id = checklist.areaIds.find((areaId) => ctx.shapes.has(shapeKey('GA', areaId)))
  return id != null ? { key: shapeKey('GA', id), name: checklist.name } : null
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
