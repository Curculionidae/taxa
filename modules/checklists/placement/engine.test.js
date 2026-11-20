import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules } from './rules.js'
import { toArea } from './areas.js'
import { deriveChecklists } from './checklists.js'
import { createContext, placeArea } from './engine.js'
import * as fx from './fixtures.js'

const yamlText = readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8')
const rules = compileRules(yamlText)
const lines = yamlText.split('\n')
/** 'placement.yml:<n>' of the first line containing `text` (after line `after`). */
const refOf = (text, after = 0) => {
  const index = lines.findIndex((line, i) => i >= after && line.includes(text))
  assert.ok(index >= 0, `line with ${text} not found`)
  return `placement.yml:${index + 1}`
}

const ga = (shape) => toArea('GeographicArea', shape)
const gz = (shape) => toArea('Gazetteer', shape)
const areas = [
  fx.ga77, fx.ga8837, fx.ga32253, fx.ga34200, fx.ga32254, fx.ga33696, fx.ga33876,
  fx.ga33639, fx.ga19713, fx.ga236, fx.ga34271, fx.ga15
].map(ga).concat([fx.gz3529, fx.gz10453].map(gz))
// New Zealand is used in TaxonWorks only through gazetteers here, so its
// checklist is given by hand (id and ISO code as a country file would have them).
const newZealand = { id: 158, name: 'New Zealand', iso2: 'NZ', areaIds: [158], states: false }
const checklists = [...deriveChecklists(areas, rules).checklists, newZealand]
const shapes = new Set(['GeographicArea/32253', 'GeographicArea/77', 'GeographicArea/32254',
  'GeographicArea/19713', 'GeographicArea/236', 'GeographicArea/33639', 'GeographicArea/33876'])
const ctx = createContext({ checklists, rules, geometry: null, shapes })
const sources = (placement) => placement.steps.map((step) => step.source)

test('Cayenne lands in French Guiana through its parent', () => {
  const placement = placeArea(ga(fx.ga8837), ctx)
  assert.equal(placement.checklist.name, 'French Guiana')
  assert.equal(placement.reason, null)
  assert.deepEqual(sources(placement), ['TaxonWorks', 'manual'])
  assert.equal(placement.steps[0].text, 'Cayenne is a subdivision of French Guiana (GA 78)')
  assert.equal(placement.steps[1].text, 'French Guiana (GA 78) belongs to the checklist French Guiana')
  assert.equal(placement.steps[1].ref, refOf('- name: French Guiana'))
})

test('the shape is the checklist outline', () => {
  const placement = placeArea(ga(fx.ga8837), ctx)
  assert.deepEqual(placement.shape, { key: 'GeographicArea/32253', name: 'French Guiana' })
})

test('Natural Earth French Guiana (GA 32253) lands in French Guiana, not France', () => {
  const placement = placeArea(ga(fx.ga32253), ctx)
  assert.equal(placement.checklist.name, 'French Guiana')
  assert.equal(placement.checklist.id, 32253)
  assert.equal(placement.part, null)
  assert.deepEqual(sources(placement), ['manual'])
  assert.equal(placement.steps[0].text, 'GA 32253 French Guiana belongs to the checklist French Guiana')
})

test('TDWG French Guiana (GA 34200) belongs to its own checklist before its overlap rule', () => {
  const placement = placeArea(ga(fx.ga34200), ctx)
  assert.equal(placement.checklist.name, 'French Guiana')
  assert.deepEqual(sources(placement), ['manual'])
})

test('TDWG Central European Russia lands in Russia by overlap', () => {
  const placement = placeArea(ga(fx.ga33876), ctx)
  assert.equal(placement.checklist.name, 'Russia')
  assert.deepEqual(sources(placement), ['overlap'])
  assert.equal(placement.steps[0].text, 'Central European Russia lies in Russia')
  assert.equal(placement.steps[0].pct, 100)
  assert.equal(placement.steps[0].ref, refOf('match: { tdwg: 14RUC }'))
  assert.match(placement.steps[0].ref, /^placement\.yml:\d+$/)
  assert.deepEqual(placement.shape, { key: 'GeographicArea/19713', name: 'Russia' })
})

test('TDWG Borneo is not placeable', () => {
  const placement = placeArea(ga(fx.ga33639), ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.shape, null)
  assert.equal(placement.reason, 'spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%')
  assert.deepEqual(sources(placement), ['overlap'])
  assert.equal(placement.steps[0].ref, refOf('match: { tdwg: 42BOR }'))
  assert.equal(placement.steps[0].text, 'Borneo spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%')
})

test('NZCC: Northland lands in New Zealand by its ISO code', () => {
  const placement = placeArea(gz(fx.gz3529), ctx)
  assert.equal(placement.checklist.name, 'New Zealand')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'TaxonWorks'])
  assert.equal(placement.steps[0].text, 'NZCC: Northland has ISO code NZ, New Zealand')
  assert.equal(placement.steps[1].text, 'no outline cached for New Zealand')
  assert.equal(placement.shape, null)
  assert.equal(placement.reason, null)
})

test('a gazetteer whose ISO code has no checklist is not placeable', () => {
  const placement = placeArea(gz(fx.gz10453), ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, 'no checklist for US')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('Corse lands in France, part Corsica', () => {
  const placement = placeArea(ga(fx.ga32254), ctx)
  assert.equal(placement.checklist.name, 'France')
  assert.equal(placement.part, 'Corsica')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'manual'])
  assert.equal(placement.steps[0].text, 'Corse is in France (GA 77)')
  assert.equal(placement.steps[1].ref, refOf('- name: Corsica'))
  assert.deepEqual(placement.shape, { key: 'GeographicArea/32254', name: 'Corsica' })
})

test('France itself has no part', () => {
  const placement = placeArea(ga(fx.ga77), ctx)
  assert.equal(placement.checklist.name, 'France')
  assert.equal(placement.part, null)
  assert.deepEqual(sources(placement), ['TaxonWorks'])
  assert.deepEqual(placement.shape, { key: 'GeographicArea/77', name: 'France' })
})

test('TDWG 12FRA lands in France, part Mainland France, manual', () => {
  const placement = placeArea(ga(fx.ga33696), ctx)
  assert.equal(placement.checklist.name, 'France')
  assert.equal(placement.part, 'Mainland France')
  assert.deepEqual(sources(placement), ['manual'])
  assert.equal(placement.steps[0].ref, refOf('match: { tdwg: 12FRA }'))
  assert.ok(placement.steps[0].text.startsWith(
    'France (TDWG 12FRA) counts as France, part Mainland France (approximately; TDWG France also covers Jersey and Guernsey)'
  ))
  // Mainland France lists no areas, so the outline is the checklist's.
  assert.deepEqual(placement.shape, { key: 'GeographicArea/77', name: 'France' })
})

test('TDWG Northern Ireland: manual beats overlap', () => {
  const placement = placeArea(ga(fx.ga34271), ctx)
  assert.equal(placement.checklist.name, 'United Kingdom')
  assert.deepEqual(sources(placement), ['manual'])
  const manualRef = refOf('match: { tdwg: 10IRE-NI }')
  const overlapRef = refOf('match: { tdwg: 10IRE-NI }', Number(manualRef.split(':')[1]))
  assert.equal(placement.steps[0].ref, manualRef)
  assert.ok(placement.steps[0].text.endsWith(
    `; overrides the overlap measurement United Kingdom 99%, Ireland 1% (2026-11-20) (${overlapRef})`
  ), placement.steps[0].text)
})

test('an area without outline and without rule', () => {
  const area = { ...ga(fx.ga33876), key: 'GA 99999', id: 99999, name: 'Nowhere', tdwg: '99NOW' }
  const placement = placeArea(area, ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, 'no outline')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('an area with outline but no rule is not measured yet', () => {
  const area = { ...ga(fx.ga33876), key: 'GA 33639', id: 33639, name: 'Somewhere', tdwg: '99SOM' }
  const placement = placeArea(area, ctx)
  assert.equal(placement.reason, 'not measured yet')
})

test('a TaxonWorks country without checklist', () => {
  const area = { ...ga(fx.ga32254), key: 'GA 5', id: 5, name: 'Somewhere', level0: 4, parentId: 4, parentName: 'Kosovo' }
  const placement = placeArea(area, ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, 'no checklist for Kosovo')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('state stays null for areas', () => {
  assert.equal(placeArea(ga(fx.ga33876), ctx).state, null)
})
