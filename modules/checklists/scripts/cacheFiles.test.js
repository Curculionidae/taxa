import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checklistKey, assignKeys, groupUnplaced, bboxOf, definedBy, areasUsed, specimensSummary,
  checklistHeader, indexEntry, publicPlacement, decidingSource, partShapes, cacheContext, RULES_PATH
} from './cacheFiles.mjs'

const area = (fields) => ({
  key: `GA ${fields.id}`, kind: 'GA', origin: null, type: null, tdwg: null, iso2: null,
  level0: null, level1: null, parentId: null, parentName: null, ...fields
})
const step = (text, source = 'TaxonWorks', extra = {}) => ({ text, source, ...extra })
const placement = (name, steps, extra = {}) => ({
  checklist: name ? { id: 1, name } : null, part: null, state: null, shape: null, reason: name ? null : 'x', steps, ...extra
})

test('checklistKey: normalized name, hyphens, ASCII only', () => {
  assert.equal(checklistKey('French Guiana'), 'french-guiana')
  assert.equal(checklistKey('Réunion'), 'reunion')
  assert.equal(checklistKey('São Tomé and Principe'), 'sao-tome-and-principe')
  assert.equal(checklistKey("Côte d'Ivoire"), 'cote-d-ivoire')
  assert.equal(checklistKey('Virgin Islands, U.S.'), 'virgin-islands-u-s')
})

test('assignKeys: key by checklist id; a clash names both checklists', () => {
  const keys = assignKeys([{ id: 1, name: 'France' }, { id: 'MP', name: 'Northern Mariana Islands' }])
  assert.equal(keys.get(1), 'france')
  assert.equal(keys.get('MP'), 'northern-mariana-islands')
  assert.throws(() => assignKeys([{ id: 1, name: 'Korea' }, { id: 2, name: 'Korea.' }]),
    /checklists "Korea" and "Korea\." both get the key "korea"/)
})

test('groupUnplaced: ids by reason, the most frequent reason first, ids sorted', () => {
  const grouped = groupUnplaced([
    { reason: 'no locality at all', kind: 'CO', id: 9 },
    { reason: 'not measured yet', kind: 'AD', id: 5 },
    { reason: 'no locality at all', kind: 'CO', id: 3 },
    { reason: 'no locality at all', kind: 'FO', id: 1 }
  ])
  assert.deepEqual(Object.keys(grouped), ['no locality at all', 'not measured yet'])
  assert.deepEqual(grouped['no locality at all'], [['CO', 3], ['CO', 9], ['FO', 1]])
  assert.deepEqual(grouped['not measured yet'], [['AD', 5]])
})

test('bboxOf: west, south, east, north over every polygon, null for none', () => {
  const polygons = [[[[0, 0], [2, 0], [2, 1], [0, 0]]], [[[-1.123456, 5], [3, 6], [3, 5], [-1.123456, 5]]]]
  assert.deepEqual(bboxOf(polygons), [-1.1235, 0, 3, 6])
  assert.equal(bboxOf(null), null)
  assert.equal(bboxOf([]), null)
})

const rules = {
  synonyms: [{ names: ['United States', 'United States of America'], ref: 'placement.yml:120' }],
  checklists: [{ name: 'French Guiana', iso2: 'GF', areas: ['GA 32253', 'GA 78'], ref: 'placement.yml:66' },
    { name: 'Northern Mariana Islands', iso2: 'MP', areas: [], ref: 'placement.yml:90' }]
}

test('definedBy: country area, synonym, nested country, level0 stub [TaxonWorks/manual]', () => {
  const areasById = new Map([
    [237, area({ id: 237, name: 'United States', level0: 237, parentName: 'Earth' })],
    [33412, area({ id: 33412, name: 'United States of America', type: 'Country', parentName: 'Earth' })],
    [99, area({ id: 99, name: 'Alaska Territory', level0: 99, parentId: 237, parentName: 'United States' })]
  ])
  areasById.set(500, { key: 'GA 500', kind: 'GA', id: 500, name: 'USA', parentName: null, stub: true })
  const level0Names = new Map([[500, 'United States']])
  const list = definedBy({ name: 'United States', areaIds: [237, 33412, 99, 500] }, { areasById, level0Names, rules })
  assert.deepEqual(list, [
    { area: 'GA 237', name: 'United States', how: 'country area [TaxonWorks]' },
    { area: 'GA 33412', name: 'United States of America', how: 'country area, a spelling of United States [manual, placement.yml:120]' },
    { area: 'GA 99', name: 'Alaska Territory', how: 'country area under United States [TaxonWorks]' },
    { area: 'GA 500', name: 'United States', how: 'country of its subdivisions, named by their DwC country [TaxonWorks]' }
  ])
})

test('definedBy: own checklist entries, with and without areas', () => {
  const areasById = new Map([[78, area({ id: 78, name: 'French Guiana' })]])
  const own = { name: 'French Guiana', areaIds: [32253, 78], ref: 'placement.yml:66' }
  assert.deepEqual(definedBy(own, { areasById, level0Names: new Map(), rules }), [
    { area: 'GA 32253', name: null, how: 'listed in the checklist entry [manual, placement.yml:66]' },
    { area: 'GA 78', name: 'French Guiana', how: 'listed in the checklist entry [manual, placement.yml:66]' }
  ])
  const mp = { name: 'Northern Mariana Islands', areaIds: [], ref: 'placement.yml:90' }
  assert.deepEqual(definedBy(mp, { areasById, level0Names: new Map(), rules }), [
    { area: null, name: 'Northern Mariana Islands', how: 'checklist entry, by ISO code MP and names [manual, placement.yml:90]' }
  ])
})

test('areasUsed: one row per area with record count and its first step', () => {
  const cayenne = area({ id: 8837, name: 'Cayenne', type: 'Commune' })
  const gz = { ...area({ id: 10453, name: "Hawai'i: Kaua'i" }), key: 'GZ 10453', kind: 'GZ' }
  const p1 = placement('French Guiana', [step('Cayenne is a subdivision of French Guiana (GA 78)'), step('b', 'manual', { ref: 'placement.yml:66' })])
  const p2 = placement('United States', [step("Hawai'i: Kaua'i has ISO code US, United States")])
  const rows = areasUsed([{ area: cayenne, placement: p1 }, { area: gz, placement: p2 }, { area: cayenne, placement: p1 }])
  assert.deepEqual(rows, [
    { area: 'GA 8837', name: 'Cayenne', kind: 'Commune', records: 2, how: 'Cayenne is a subdivision of French Guiana (GA 78) [TaxonWorks]' },
    { area: 'GZ 10453', name: "Hawai'i: Kaua'i", kind: 'Gazetteer', records: 1, how: "Hawai'i: Kaua'i has ISO code US, United States [TaxonWorks]" }
  ])
})

test('specimensSummary: record count and how many by which first step', () => {
  const summary = specimensSummary([
    placement('Tanzania', [step('DwC country is Tanzania')]),
    placement('Tanzania', [step('DwC country is United Republic of Tanzania'), step('spelling', 'manual', { ref: 'placement.yml:1' })]),
    placement('Tanzania', [step('coordinates -6, 35 lie inside Tanzania', 'overlap')]),
    placement('French Guiana', [step('DwC country Guyane contains the name Guyane of the checklist French Guiana', 'manual', { ref: 'placement.yml:66' })])
  ])
  assert.deepEqual(summary, {
    records: 4,
    how: 'by DwC country 2 [TaxonWorks], by a name of the checklist entry 1 [manual], by coordinates inside the outline 1 [overlap]'
  })
  assert.deepEqual(specimensSummary([]), { records: 0, how: 'none' })
})

test('checklistHeader: fixed key order and the rules file', () => {
  const header = checklistHeader({
    key: 'french-guiana', name: 'French Guiana', iso2: 'GF', outline: 'GeographicArea/32253',
    definedBy: [], areasUsed: [], specimens: { records: 0, how: 'none' }, built: '2026-11-20'
  })
  assert.deepEqual(Object.keys(header), ['key', 'name', 'iso2', 'outline', 'defined_by', 'areas_used', 'specimens', 'built', 'rules'])
  assert.equal(header.rules, RULES_PATH)
  assert.equal(RULES_PATH, 'modules/checklists/rules/placement.yml')
})

test('indexEntry: no numeric ids, file name from the key', () => {
  const entry = indexEntry({
    key: 'france', name: 'France', iso2: 'FR', shape: 'GeographicArea/77', bbox: [-5, 41, 10, 51],
    parts: [{ name: 'Corsica', shape: null }], states: false, taxa: 10, records: 20
  })
  assert.deepEqual(entry, {
    key: 'france', file: 'france.json', name: 'France', iso2: 'FR', shape: 'GeographicArea/77', bbox: [-5, 41, 10, 51],
    parts: [{ name: 'Corsica', shape: null }], states: false, taxa: 10, records: 20
  })
  const plain = indexEntry({ key: 'spain', name: 'Spain', iso2: 'ES', shape: null, bbox: null, states: false, taxa: 1, records: 1 })
  assert.ok(!('parts' in plain))
  assert.ok(!('of' in plain))
  const own = indexEntry({ key: 'mayotte', name: 'Mayotte', iso2: 'YT', of: 'France', shape: null, bbox: null, states: false, taxa: 1, records: 1 })
  assert.equal(own.of, 'France')
  assert.ok(!('fallback' in own))
  // A checklist drawn from fallback-shapes.geojson names the feature, which may be spelled
  // like a synonym of the checklist (Saint Barthelemy for Saint Barthélemy).
  const barth = indexEntry({ key: 'saint-barthelemy', name: 'Saint Barthélemy', iso2: 'BL', shape: null, fallback: 'Saint Barthelemy', bbox: null, states: false, taxa: 1, records: 1 })
  assert.equal(barth.fallback, 'Saint Barthelemy')
})

test('publicPlacement: the checklist by key and name, never its numeric id', () => {
  const keys = new Map([[32253, 'french-guiana']])
  const out = publicPlacement({ ...placement('French Guiana', []), checklist: { id: 32253, name: 'French Guiana' } }, keys)
  assert.deepEqual(out.checklist, { key: 'french-guiana', name: 'French Guiana' })
  assert.equal(publicPlacement(placement(null, []), keys).checklist, null)
})

test('decidingSource: the last step about the checklist, not part, state or outline', () => {
  const cayenne = placement('French Guiana', [step('Cayenne is a subdivision of French Guiana (GA 78)'),
    step('French Guiana (GA 78) belongs to the checklist French Guiana', 'manual', { ref: 'placement.yml:66' })])
  assert.equal(decidingSource(cayenne), 'manual')
  const france = placement('France', [step('Lyon is in France (GA 77)'),
    step('Lyon (GA 5) is below country level, so it goes to the part Mainland France', 'manual', { ref: 'placement.yml:9' }),
    step('no outline cached for France')])
  assert.equal(decidingSource(france), 'TaxonWorks')
  const hawaii = placement('United States', [step("Kaua'i has ISO code US, United States"),
    step("Kaua'i (GZ 10453) lies in the state Hawaii", 'overlap', { ref: 'placement.yml:5', pct: 100, pctOf: 'Hawaii' })])
  assert.equal(decidingSource(hawaii), 'TaxonWorks')
  const russia = placement('Russia', [step('Central European Russia (TDWG 14RUC) lies in Russia', 'overlap', { ref: 'placement.yml:164' }),
    step('no state: spans several states: Tver 10%', 'overlap', { ref: 'placement.yml:487' })])
  assert.equal(decidingSource(russia), 'overlap')
})

test('partShapes: the first cached GA area of each part; Mainland France is GA 34185 (no Channel Islands)', async () => {
  const { readFileSync } = await import('node:fs')
  const { compileRules } = await import('../placement/rules.js')
  const rules = compileRules(readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8'))
  const shapes = new Set(['GeographicArea/32254', 'GeographicArea/34185', 'GeographicArea/33696'])
  assert.deepEqual(partShapes(rules.parts.France, shapes), [
    { name: 'Corsica', shape: 'GeographicArea/32254' },
    { name: 'Mainland France', shape: 'GeographicArea/34185' }
  ])
  assert.deepEqual(partShapes([{ name: 'X', areas: ['GZ 5', 'GA 9'] }], shapes), [{ name: 'X', shape: null }])
})

test('cacheContext: checklists, their outlines with bbox, and the cached outline keys by kind', () => {
  const checklists = [
    { id: 1, name: 'France', iso2: 'FR', areaIds: [1, 5], states: false },
    { id: 2, name: 'Spain', iso2: 'ES', areaIds: [2], states: false },
    { id: 3, name: 'Atlantis', iso2: '', areaIds: [3], states: false }
  ]
  const targets = [
    { id: 1, name: 'France', outline: 'GeographicArea/5', polygons: [[[[0, 0], [2.123456, 0], [2.123456, 1], [0, 0]]]] },
    { id: 2, name: 'Spain', outline: 'fallback/Spain', polygons: [[[[-3, 0], [-1, 0], [-1, 2], [-3, 0]]]] }
  ]
  const shapes = new Set(['GeographicArea/5', 'Gazetteer/7', 'GeographicArea/12', 'GeographicArea/2'])
  const unusable = new Set(['Gazetteer/7'])
  assert.deepEqual(cacheContext({ built: '2026-11-20', checklists, targets, shapes, unusable }), {
    built: '2026-11-20',
    checklists,
    outlines: [
      { id: 1, outline: 'GeographicArea/5', bbox: [0, 0, 2.1235, 1] },
      { id: 2, outline: 'fallback/Spain', bbox: [-3, 0, -1, 2] }
    ],
    shapes: { GeographicArea: [2, 5, 12], Gazetteer: [7] },
    unusable: { GeographicArea: [], Gazetteer: [7] }
  })
})
