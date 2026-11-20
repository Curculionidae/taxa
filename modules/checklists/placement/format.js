// The short plain text form of one placement decision, and the parser of what
// a curator types into the lookup box.
//
// Input:  formatPlacement gets the subject (what was placed) and the Placement
//         the engine returned (engine.js). parseLookup gets the typed text.
// Output: formatPlacement returns a multi-line string, parseLookup returns
//         { kind, id } or null. The same text is printed by the build's
//         --verbose and --explain output and shown on the curator page.
// Pure and browser-safe: no imports, no network, no file system.

const LABEL_WIDTH = 9
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
function sourceTag(step) {
  if (step.source === 'TaxonWorks') return '[TaxonWorks]'
  if (step.source === 'manual') return `[manual, ${step.ref}]`
  const share = step.pct !== undefined ? ` ${step.pct}%${step.pctOf ? ` ${step.pctOf}` : ''}` : ''
  return `[overlap${share}${step.ref ? `, ${step.ref}` : ''}]`
}

/**
 * Render one decision as text. Lines: `<KIND> <id>  <label>`, then `area` (only
 * when an area is given), one `step` per decision step with the source tags
 * aligned in a column (every step text padded to the longest plus two spaces),
 * `result` and `shape`.
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

  if (placement.shape) lines.push(row('shape', `${placement.shape.key} (${placement.shape.name})`))
  else lines.push(row('shape', `none (${placement.checklist ? 'no outline cached' : placement.reason})`))
  return lines.join('\n')
}

/**
 * Read the lookup box: a kind (GA, GZ, AD, CO or FO, any case), an optional
 * space and the id, e.g. 'ad 556796', 'AD556796', ' GZ 10453 '. A bare number
 * or an unknown kind gives null.
 * @param {string} text
 * @returns {{ kind: 'GA'|'GZ'|'AD'|'CO'|'FO', id: number } | null}
 */
export function parseLookup(text) {
  const found = /^([a-z]{2})\s?(\d+)$/i.exec(String(text ?? '').trim())
  if (!found) return null
  const kind = found[1].toUpperCase()
  return KINDS.includes(kind) ? { kind, id: Number(found[2]) } : null
}
