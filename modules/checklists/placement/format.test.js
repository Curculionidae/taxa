import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules } from './rules.js'
import { toArea } from './areas.js'
import { deriveChecklists } from './checklists.js'
import { createContext, placeArea } from './engine.js'
import { formatPlacement, formatStep, parseLookup } from './format.js'
import * as fx from './fixtures.js'

const yamlText = readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8')
const rules = compileRules(yamlText)
const ga = (shape) => toArea('GeographicArea', shape)
const areas = [fx.ga77, fx.ga8837, fx.ga32253, fx.ga34200, fx.ga33876, fx.ga19713, fx.ga33639].map(ga)
const { checklists } = deriveChecklists(areas, rules, new Map(), new Map())
const shapes = new Set(['GeographicArea/32253', 'GeographicArea/19713'])
const ctx = createContext({ checklists, rules, geometry: null, shapes })

test('Cayenne explanation reads as the short text form', () => {
  const index = yamlText.split('\n').findIndex((line) => line.includes('- name: French Guiana'))
  const ref = `placement.yml:${index + 1}`
  const area = ga(fx.ga8837)
  const text = formatPlacement({ label: 'Phaedropus candidus', kind: 'AD', area, id: 556796 }, placeArea(area, ctx))
  const first = 'Cayenne is a subdivision of French Guiana (GA 78)'
  const second = 'French Guiana (GA 78) belongs to the checklist French Guiana'
  assert.equal(text, [
    'AD 556796  Phaedropus candidus',
    '  area     GA 8837 Cayenne (GA)',
    `  step     ${first.padEnd(second.length + 2)}[TaxonWorks]`,
    `  step     ${second}  [manual, ${ref}]`,
    '  result   French Guiana checklist',
    '  shape    GeographicArea/32253 (French Guiana)'
  ].join('\n'))
})

test('overlap tag carries share and name, not placeable shows the reason', () => {
  const area = ga(fx.ga33876)
  const text = formatPlacement({ kind: 'GA', id: 33876, label: 'x' }, placeArea(area, ctx))
  assert.match(text, /\[overlap 100% Russia, placement\.yml:\d+\]/)
  const bad = formatPlacement({ kind: 'GA', id: 33639, label: 'y' }, placeArea(ga(fx.ga33639), ctx))
  assert.match(bad, /  result   not placeable: /)
  assert.match(bad, /  shape    none \(.+\)$/)
})

test('part, state, and no outline cached', () => {
  const placement = { checklist: { id: 1, name: 'France' }, part: 'Corsica', state: 'X', shape: null, reason: null,
    steps: [{ text: 'live', source: 'overlap' }, { text: 'r', source: 'overlap', ref: 'placement.yml:3' }] }
  const text = formatPlacement({ kind: 'CO', id: 5, label: 'l' }, placement)
  assert.match(text, /  result   France checklist, part Corsica, state X\n/)
  assert.match(text, /  step     live {2}\[overlap\]\n/)
  assert.match(text, /\[overlap, placement\.yml:3\]/)
  assert.ok(text.endsWith('  shape    none (no outline cached)'))
  assert.ok(!text.includes('area     '))
})

test('parseLookup', () => {
  assert.deepEqual(parseLookup('ad 556796'), { kind: 'AD', id: 556796 })
  assert.deepEqual(parseLookup('AD556796'), { kind: 'AD', id: 556796 })
  assert.deepEqual(parseLookup(' GZ 10453 '), { kind: 'GZ', id: 10453 })
  assert.deepEqual(parseLookup('fo 7'), { kind: 'FO', id: 7 })
  assert.equal(parseLookup('556796'), null)
  assert.equal(parseLookup('XY 1'), null)
  assert.equal(parseLookup(''), null)
})

test('Borneo step tag carries no share', () => {
  const index = yamlText.split('\n').findIndex((line) => line.includes('match: { tdwg: 42BOR }'))
  const ref = `placement.yml:${index + 1}`
  const text = formatPlacement({ kind: 'GA', id: 33639, label: 'Borneo' }, placeArea(ga(fx.ga33639), ctx))
  const step = 'Borneo spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%'
  assert.ok(text.includes(`  step     ${step}  [overlap, ${ref}]\n`), text)
  assert.ok(!/overlap \d/.test(text))
})

test('formatStep: one step as text and source tag', () => {
  assert.equal(formatStep({ text: 'Cayenne is in France (GA 77)', source: 'TaxonWorks' }), 'Cayenne is in France (GA 77) [TaxonWorks]')
  assert.equal(formatStep({ text: 'x', source: 'manual', ref: 'placement.yml:66' }), 'x [manual, placement.yml:66]')
  assert.equal(formatStep({ text: 'y', source: 'overlap', ref: 'placement.yml:9', pct: 100, pctOf: 'Russia' }), 'y [overlap 100% Russia, placement.yml:9]')
})
