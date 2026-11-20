// The placement engine: which checklist a record belongs to, and why.
//
// Purpose: one implementation of the placement decisions, used by the cache
// build (Node) and by the curator page (browser). Every decision comes with
// steps that name their source, so a curator can see whether to fix something
// in TaxonWorks or in the rules file. This file places an AREA, the place an
// asserted distribution points to (placeArea). Specimens, field occurrences
// and states are added by placeRecord (Task 5).
//
// Input:  an Area (areas.js, toArea) and a Context made once by createContext
//         from the checklists (checklists.js, deriveChecklists), the compiled
//         rules file (rules.js, compileRules), a Geometry (used for records
//         with coordinates, not by placeArea) and the set of cached outline
//         keys ('GeographicArea/32253').
// Output: a Placement (see the typedef): the checklist or null with a reason,
//         the part (France: Corsica, Mainland France), the outline to show,
//         and the steps of the decision.
// Purity: no network, no file system, no Node-only APIs, no hidden state. The
//         same input always gives the same Placement, in Node and in the browser.
//
// Decision order for an area (the first that applies decides):
//  1. a manual rule for the area (rules file, manual section)
//  2. a checklist of its own (rules file, checklists section): the area, or its
//     parent, is listed in `areas`, the area's ISO code is the checklist's, or
//     a word of `names` is in the area's or its parent's name
//  3. the country TaxonWorks gives the area (`level0_id`); without one, the
//     checklist that owns the area itself or its parent
//  4. the ISO code of a gazetteer
//  5. an overlap rule for the area (rules file, overlap section)
//  6. otherwise not placeable, with the reason
// Then the part of the checklist (France) and the outline.
import { normalizeName, containsName } from './areas.js'

/**
 * @typedef {Object} Step  one sentence of an explanation
 * @property {string} text  short plain sentence; the source tag and line are not part of it
 * @property {'TaxonWorks'|'manual'|'overlap'} source  TaxonWorks data, a hand-written
 *   line of the rules file, or a measured overlap line of the rules file
 * @property {string} [ref]  'placement.yml:12', the rules file line, for manual and overlap
 * @property {number} [pct]  the measured share of an overlap step
 *
 * @typedef {Object} Placement
 * @property {{ id: number|string, name: string } | null} checklist  null when not placeable
 * @property {string|null} part   part of the checklist (France: 'Corsica'), else null
 * @property {string|null} state  state or province; always null from placeArea (Task 5)
 * @property {{ key: string, name: string } | null} shape  cached outline to show,
 *   key 'GeographicArea/32253'; null when not placeable or when no outline is cached
 * @property {string|null} reason  why it is not placeable ('no outline', 'not measured
 *   yet', 'no checklist for Kosovo', 'spans several countries: ...'), null when placed
 * @property {Step[]} steps  the decision, in order
 *
 * @typedef {Object} Geometry  point lookups on outlines (implemented in Task 7 and 11)
 *
 * @typedef {Object} Context  lookups made once, shared by every placement
 * @property {import('./checklists.js').Checklist[]} checklists
 * @property {import('./rules.js').CompiledRules} rules
 * @property {Geometry|null} geometry
 * @property {Set<string>} shapes  cached outline keys, 'GeographicArea/32253' or 'Gazetteer/3529'
 * @property {Map<number, import('./checklists.js').Checklist>} byAreaId  GA id to checklist
 * @property {Map<string, import('./checklists.js').Checklist>} byIso  upper case ISO code to checklist
 * @property {Map<string, import('./checklists.js').Checklist>} byName  normalized name or synonym to checklist
 */

/**
 * Make the lookup context once for many placements.
 * @param {Object} input
 * @param {import('./checklists.js').Checklist[]} input.checklists  from deriveChecklists
 * @param {import('./rules.js').CompiledRules} input.rules  from compileRules
 * @param {Geometry|null} [input.geometry]  point lookups, used for records (Task 5)
 * @param {Set<string>} [input.shapes]  keys of cached outlines, 'GeographicArea/32253'
 * @returns {Context}
 */
export function createContext({ checklists, rules, geometry = null, shapes = new Set() }) {
  const byAreaId = new Map()
  const byIso = new Map()
  const byName = new Map()
  for (const checklist of checklists) {
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
  return { checklists, rules, geometry, shapes, byAreaId, byIso, byName }
}

/**
 * Place an area (the place an asserted distribution points to).
 * @param {import('./areas.js').Area} area
 * @param {Context} ctx
 * @returns {Placement}
 */
export function placeArea(area, ctx) {
  const decision = decide(area, ctx)
  const steps = decision.steps
  if (!decision.checklist) {
    return { checklist: null, part: null, state: null, shape: null, reason: decision.reason, steps }
  }
  const checklist = decision.checklist
  const part = decision.part ?? choosePart(area, checklist, ctx, steps)
  const shape = chooseShape(checklist, part, ctx)
  if (!shape) steps.push({ text: `no outline cached for ${checklist.name}`, source: 'TaxonWorks' })
  return {
    checklist: { id: checklist.id, name: checklist.name },
    part,
    state: null,
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

// First rule of a section whose every match field fits the area.
function findRule(rules, area) {
  return rules.find(({ match }) => {
    if (match.area && match.area !== area.key) return false
    if (match.tdwg && match.tdwg !== area.tdwg) return false
    if (match.iso2 && match.iso2.toUpperCase() !== (area.iso2 ?? '').toUpperCase()) return false
    if (match.gazetteerPrefix &&
      !(area.kind === 'GZ' && normalizeName(area.name).startsWith(normalizeName(match.gazetteerPrefix)))) return false
    return true
  }) ?? null
}

// A manual or overlap rule turned into a decision. `suffix` ends the step text.
function applyRule(rule, source, area, ctx, suffix) {
  const step = (text) => ({
    text: text + suffix,
    source,
    ref: rule.ref,
    ...(source === 'overlap' && rule.pct !== undefined ? { pct: rule.pct } : {})
  })
  const why = rule.why ? ` (${rule.why})` : ''
  const { action } = rule

  if (action.notPlaceable) {
    const shares = rule.measured ? rule.measured.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '') : ''
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
    return placed(checklist, [step(`${lead} ${checklist.name}${partText}${why}`)], part ?? null)
  }

  // synonymousWith: the area is the same as another area, given by its key.
  const target = action.synonymousWith
  const [kind, idText] = target.split(' ')
  const first = step(`${label(area)} is the same area as ${target}${why}`)
  const entry = ctx.rules.checklists.find((e) => e.areas.includes(target))
  const checklist = entry ? ctx.byName.get(normalizeName(entry.name)) : kind === 'GA' ? ctx.byAreaId.get(Number(idText)) : null
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
  // An area without level0 that a checklist owns itself is its own country
  // (GA 33412 United States of America, R17).
  const level0 = area.level0 ?? (ctx.byAreaId.has(area.id) ? area.id : null)
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
    if (normalizeName(area.name) === normalizeName(checklist.name)) {
      return placed(checklist, [{ text: `${area.name} (GA ${area.id}) is a country`, source: 'TaxonWorks' }])
    }
    const synonym = ctx.rules.synonyms.find(({ names }) =>
      names.some((n) => normalizeName(n) === normalizeName(area.name)) &&
      names.some((n) => normalizeName(n) === normalizeName(checklist.name)))
    if (synonym) {
      return placed(checklist, [{ text: `${area.name} (GA ${area.id}) is a spelling of ${checklist.name}`, source: 'manual', ref: synonym.ref }])
    }
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
