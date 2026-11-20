// The short plain text form of one placement decision, and the parser of what
// a curator types into the lookup box.
//
// Input:  formatPlacement gets the subject (what was placed) and the Placement
//         the engine returned (engine.js). parseLookup gets the typed text.
// Output: formatPlacement returns a multi-line string, formatStep one line
//         (a step and its source tag), sourceTag the tag alone, decidingStep
//         the step that decided, formatExplanation the --explain text,
//         parseLookup returns { kind, id } or null. The same text is printed by the build's
//         --verbose and --explain output and shown on the curator page.
// Pure and browser-safe: no imports, no network, no file system.

const LABEL_WIDTH = 10
const KINDS = ['GA', 'GZ', 'AD', 'CO', 'FO']

const row = (name, text) => `  ${name.padEnd(LABEL_WIDTH)}${text}`

/**
 * The source tag after a step text: `[TaxonWorks]`, `[manual, placement.yml:12]`,
 * `[overlap 72% Russia, placement.yml:40]` (measured share and what it refers
 * to), `[overlap, placement.yml:40]` (a rule without a share) and `[overlap]`
 * (a live coordinate step, no rule line).
 * @param {import('./engine.js').Step} step
 * @returns {string}
 */
export function sourceTag(step) {
  if (step.source === 'TaxonWorks') return '[TaxonWorks]'
  if (step.source === 'manual') return `[manual, ${step.ref}]`
  const share = step.pct !== undefined ? ` ${step.pct}%${step.pctOf ? ` ${step.pctOf}` : ''}` : ''
  return `[overlap${share}${step.ref ? `, ${step.ref}` : ''}]`
}

// Steps after the checklist decision: the part, the state, the outline.
const AFTER_DECISION = /\bthe part |^no state|the state |^no outline cached|^outline of /

/**
 * The step that decided the checklist of a placed record: the last step before
 * the part, state and outline steps (Cayenne: the manual line that gives GA 78
 * its own checklist). For a record not placed, the last step (the one that
 * gives the reason). The build's summary counts placed records by its source,
 * compare.mjs groups by it and the curator page tags each decision with it.
 * @param {import('./engine.js').Placement} placement
 * @returns {import('./engine.js').Step|null}  null when there are no steps
 */
export function decidingStep(placement) {
  // A step of the engine says which decision it belongs to (Step.stage); the
  // wording is only used for steps of an older cache.
  const staged = placement.steps.some((step) => step.stage)
  const steps = placement.steps.filter((step) => (staged ? step.stage === 'checklist' : !AFTER_DECISION.test(step.text)))
  return steps.at(-1) ?? placement.steps[0] ?? null
}

/**
 * One step on one line: its text, a space and its source tag, e.g.
 * 'Cayenne is a subdivision of French Guiana (GA 78) [TaxonWorks]'. The build
 * uses it for the `how` of the country file header.
 * @param {import('./engine.js').Step} step
 * @returns {string}
 */
export function formatStep(step) {
  return `${step.text} ${sourceTag(step)}`
}

/**
 * Render one decision as text. Lines: `<KIND> <id>  <label>`, then `area` (only
 * when an area is given), one `step` per decision step with the source tags
 * aligned in a column (every step text padded to the longest plus two spaces),
 * `result` and `drawn as` (the outline the record is drawn with on the checklist map).
 * @param {{ kind: string, id: number|string, label: string,
 *   area?: { kind: string, id: number|string, name: string } }} subject
 *   what was placed: 'AD 556796' and its label; `area` is the area behind it
 * @param {import('./engine.js').Placement} placement
 * @returns {string}
 */
export function formatPlacement(subject, placement) {
  const lines = [`${subject.kind} ${subject.id}  ${subject.label}`]
  const { area } = subject
  if (area) lines.push(row('area', `${area.kind} ${area.id} ${area.name} (${area.kind})`))

  const width = Math.max(0, ...placement.steps.map((step) => step.text.length)) + 2
  for (const step of placement.steps) lines.push(row('step', `${step.text.padEnd(width)}${sourceTag(step)}`))

  if (placement.checklist) {
    const extra = [placement.part && `part ${placement.part}`, placement.state && `state ${placement.state}`]
    lines.push(row('result', [`${placement.checklist.name} checklist`, ...extra.filter(Boolean)].join(', ')))
  } else {
    lines.push(row('result', `not placeable: ${placement.reason}`))
  }

  lines.push(row('drawn as', drawnAs(placement)))
  return lines.join('\n')
}

// What the record is drawn with on the checklist map: the outline's name and key
// (a cached TaxonWorks area) or 'Natural Earth' (the fallback), or nothing.
function drawnAs(placement) {
  if (!placement.checklist) return 'nothing (not placed in a checklist)'
  const { shape } = placement
  if (!shape) return `nothing (no outline for ${placement.checklist.name})`
  return `${shape.name} outline (${shape.key.startsWith('fallback/') ? 'Natural Earth' : shape.key})`
}

/**
 * The text --explain prints and the curator page shows: formatPlacement, or,
 * for a decision without steps that placed nothing (a distribution without
 * area), the first line and the result alone.
 * @param {{ kind: string, id: number|string, label: string, area?: Object }} subject
 * @param {import('./engine.js').Placement} placement
 * @returns {string}
 */
export function formatExplanation(subject, placement) {
  if (!placement.steps.length && !placement.checklist) {
    return `${subject.kind} ${subject.id}  ${subject.label}\n${row('result', `not placeable: ${placement.reason}`)}`
  }
  return formatPlacement(subject, placement)
}

/**
 * Read the lookup box: a kind (GA, GZ, AD, CO or FO, any case), any number of
 * spaces and the id, e.g. 'ad 556796', 'AD556796', ' GZ  10453 '. A bare number
 * or an unknown kind gives null.
 * @param {string} text
 * @returns {{ kind: 'GA'|'GZ'|'AD'|'CO'|'FO', id: number } | null}
 */
export function parseLookup(text) {
  const found = /^([a-z]{2})\s*(\d+)$/i.exec(String(text ?? '').trim())
  if (!found) return null
  const kind = found[1].toUpperCase()
  return KINDS.includes(kind) ? { kind, id: Number(found[2]) } : null
}
