/**
 * standardEvidence.js
 *
 * Grades a /biological_associations/basic row for the Field Assistant.
 *
 * The Field Assistant answers "where is it worth looking for this beetle?", so
 * it grades rather than filters: every associated taxon is listed, and each one
 * carries the single best mark its records earn -- green, orange or red. Hiding
 * the weaker ones behind a switch made an absent taxon and a poorly evidenced
 * one look the same; one dot per taxon says which it is at a glance.
 *
 * WHICH record earns WHICH colour is not decided here but in the table in
 * evidenceRules.js (Subject stage x relationship -> colour), so the grading can
 * be changed by editing data. This module only reads the record's stage and
 * relationship, looks them up there and builds the legend from the same table.
 *
 * Pure module: no Vue, no HTTP. The classification reads the SUBJECT side,
 * which biological-association data models as the animal on either page
 * direction (a plant page still has the beetle as subject).
 */

import { anatomicalPartName } from './makeBiologicalAssociation.js'
import {
  EVIDENCE_LABELS,
  EVIDENCE_RULES,
  NO_STAGE_COUNTS_AS,
  STAGE_ALIASES
} from './evidenceRules.js'

const ANY = '*'

/**
 * The three colours in priority order -- a row paints the first one it has
 * any record in -- with the theme token each one renders in.
 */
const COLOURS = Object.freeze([
  Object.freeze({ key: 'green', class: 'text-success' }),
  Object.freeze({ key: 'orange', class: 'text-warning' }),
  Object.freeze({ key: 'red', class: 'text-danger' })
])
const COLOUR_KEYS = COLOURS.map(colour => colour.key)
/** For a record no rule reaches, i.e. a table without its '*', '*' line. */
const FALLBACK_COLOUR = 'red'

const normalise = value => String(value ?? '').trim().toLocaleLowerCase('en')
const ALIASES = new Map(Object.entries(STAGE_ALIASES)
  .map(([recorded, stage]) => [normalise(recorded), normalise(stage)]))
const tableTerm = stage => ALIASES.get(normalise(stage)) ?? normalise(stage)
const ruleKey = (stage, relationship) => `${stage}\u0000${relationship}`

/**
 * '' when the subject carries no AnatomicalPart, the lowercased term when it
 * does, and null for an AnatomicalPart whose term cannot be read -- which is
 * not the same as having none, and must not pass as "no stage recorded".
 */
export function subjectStage(row) {
  const subject = row?.subject || {}
  if ((subject.type || subject.base_class) !== 'AnatomicalPart') return ''
  return anatomicalPartName(subject)?.trim().toLocaleLowerCase('en') || null
}

/**
 * The stage as the rule table spells it: aliases folded (larvae -> larva), a
 * Subject without a part counted as NO_STAGE_COUNTS_AS, and an unreadable part
 * left to the table's '*' lines alone.
 */
export function evidenceStage(stage) {
  if (stage === null || stage === undefined) return ANY
  return tableTerm(stage === '' ? NO_STAGE_COUNTS_AS : stage) || ANY
}

/**
 * The table, checked once on load. A wrong colour or a stage/relationship
 * pair listed twice is an editing mistake; the console names it, and the
 * panel keeps working with the lines it can use (the first of two duplicates).
 */
function compileRules(rules) {
  const byKey = new Map()
  const list = []
  const problems = []
  for (const rule of Array.isArray(rules) ? rules : []) {
    const [stage, relationship, colour] = Array.isArray(rule) ? rule : []
    const text = JSON.stringify(rule)
    if (typeof stage !== 'string' || !stage.trim()
      || typeof relationship !== 'string' || !relationship.trim()) {
      problems.push(`${text}: needs a stage and a relationship ('*' for any)`)
      continue
    }
    if (!COLOUR_KEYS.includes(colour)) {
      problems.push(`${text}: colour must be one of ${COLOUR_KEYS.join(', ')}`)
      continue
    }
    const entry = {
      stage: tableTerm(stage),
      relationship: normalise(relationship),
      label: relationship.trim(),
      colour
    }
    const key = ruleKey(entry.stage, entry.relationship)
    if (byKey.has(key)) {
      problems.push(`${text}: same stage and relationship as an earlier line, which wins`)
      continue
    }
    byKey.set(key, colour)
    list.push(entry)
  }
  if (problems.length && typeof console !== 'undefined') {
    console.warn(`[panel:biological-associations-v2] evidenceRules.js:\n  ${problems.join('\n  ')}`)
  }
  return { byKey, list }
}

const RULES = compileRules(EVIDENCE_RULES)

/**
 * The colour of one stage x relationship, most specific line first:
 * stage + relationship, stage + '*', '*' + relationship, '*' + '*'.
 */
export function evidenceColour(stage, relationship) {
  const tableStageName = stage === ANY ? ANY : tableTerm(stage)
  const rel = normalise(relationship)
  const candidates = tableStageName === ANY
    ? [[ANY, rel], [ANY, ANY]]
    : [[tableStageName, rel], [tableStageName, ANY], [ANY, rel], [ANY, ANY]]
  for (const [s, r] of candidates) {
    const colour = RULES.byKey.get(ruleKey(s, r))
    if (colour) return colour
  }
  return FALLBACK_COLOUR
}

export function standardRowMark(row) {
  return evidenceColour(evidenceStage(subjectStage(row)), row?.relationship)
}

export function emptyStandardCounts() {
  return Object.fromEntries(COLOUR_KEYS.map(key => [key, 0]))
}

function stageLabel(stage) {
  if (stage === ANY) return 'any stage'
  const names = [stage]
  for (const [recorded, target] of ALIASES) {
    if (target === stage && recorded !== stage) names.push(recorded)
  }
  if (evidenceStage('') === stage) names.push('no stage recorded')
  return names.join(' / ')
}

/**
 * The cases one colour covers, as legend lines in table order:
 * "larva / larvae: reared from, collected from", "pupa: any other
 * relationship", "any stage: [legacy] feeds on", "everything else".
 */
function ruleLines(colour) {
  const stagesWithOwnLines = new Set(RULES.list
    .filter(rule => rule.relationship !== ANY)
    .map(rule => rule.stage))
  const groups = new Map()
  let catchAll = false
  for (const rule of RULES.list) {
    if (rule.colour !== colour) continue
    if (rule.stage === ANY && rule.relationship === ANY) {
      catchAll = true
      continue
    }
    if (!groups.has(rule.stage)) groups.set(rule.stage, [])
    groups.get(rule.stage).push(rule)
  }
  const lines = [...groups].map(([stage, rules]) => {
    const named = rules.filter(rule => rule.relationship !== ANY).map(rule => rule.label)
    if (rules.some(rule => rule.relationship === ANY)) {
      named.push(stagesWithOwnLines.has(stage) ? 'any other relationship' : 'any relationship')
    }
    return `${stageLabel(stage)}: ${named.join(', ')}`
  })
  if (catchAll) lines.push('everything else')
  return lines
}

/**
 * Green, orange and red, in the fixed slot order the Standard table renders.
 * Lives here, not in the table's <script setup>, so the column-heading legend
 * and the per-row breakdown can never drift apart: both read this one list,
 * and its `rules` lines come from the same table the rows are graded by.
 */
export const STANDARD_MARK_STYLES = Object.freeze(COLOURS.map(colour => Object.freeze({
  key: colour.key,
  class: colour.class,
  reason: EVIDENCE_LABELS[colour.key] || colour.key,
  rules: Object.freeze(ruleLines(colour.key))
})))

/** All three categories in a fixed order, each with the row's count. The table
 *  shows only the best of them; the breakdown behind the dot shows the rest. */
export function standardRowMarks(row) {
  const counts = row?.counts || {}
  const total = Number(row?.count) || 0
  return STANDARD_MARK_STYLES.map(mark => {
    const count = counts[mark.key] || 0
    return { ...mark, count, title: `${count} of ${total} records: ${mark.reason}` }
  })
}

/**
 * The single mark the Field Assistant paints for a row: the best category the
 * row has any record in, green before orange before red. That order is
 * STANDARD_MARK_STYLES' own, so the priority cannot drift from the legend.
 * null for a row with nothing classified, which the table then leaves blank
 * rather than inventing a colour for.
 */
export function standardBestMark(row) {
  return standardRowMarks(row).find(mark => mark.count) || null
}

/** Only the categories the row actually has -- listing "0 of 11" in the
 *  breakdown is noise. */
export function standardRowMarkLines(row) {
  return standardRowMarks(row).filter(mark => mark.count)
}

/**
 * The whole breakdown as one string. It is the accessible name of the dot's
 * button, so a screen-reader user hears every share -- not just the best one
 * the dot paints -- without opening the popover, which on touch is the only
 * way in at all.
 */
export function standardMarksLabel(row) {
  const name = row?.name || 'this taxon'
  const lines = standardRowMarkLines(row)
  return lines.length
    ? `Evidence for ${name}: ${lines.map(mark => mark.title).join('; ')}`
    : `Evidence for ${name}: no records classified`
}
