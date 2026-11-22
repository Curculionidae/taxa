import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules } from './rules.js'
import { toArea } from './areas.js'
import { deriveChecklists } from './checklists.js'
import { hasPoint, createContext, placeArea, placeRecord } from './engine.js'
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
  fx.ga33639, fx.ga19713, fx.ga236, fx.ga34271, fx.ga15, fx.ga237, fx.ga33412, fx.ga33455,
  fx.ga26386, fx.ga31761
].map(ga).concat([fx.gz3529, fx.gz10453, fx.gz3575].map(gz))
// New Zealand is used in TaxonWorks only through gazetteers here, so its
// checklist is given by hand (id and ISO code as a country file would have them).
const newZealand = { id: 158, name: 'New Zealand', iso2: 'NZ', areaIds: [158], states: false }
const checklists = [...deriveChecklists(areas, rules, new Map()).checklists, newZealand]
const shapes = new Set(['GeographicArea/32253', 'GeographicArea/77', 'GeographicArea/32254',
  'GeographicArea/19713', 'GeographicArea/236', 'GeographicArea/237', 'GeographicArea/33639', 'GeographicArea/33876'])
const ctx = createContext({ checklists, rules, geometry: null, shapes })
// The steps that found something (a check that found nothing, Step.none, is left out).
const found = (placement) => placement.steps.filter((step) => !step.none)
const sources = (placement) => found(placement).map((step) => step.source)

test('Cayenne lands in French Guiana through its parent', () => {
  const placement = placeArea(ga(fx.ga8837), ctx)
  assert.equal(placement.checklist.name, 'French Guiana')
  assert.equal(placement.reason, null)
  assert.deepEqual(sources(placement), ['TaxonWorks', 'manual'])
  assert.equal(found(placement)[0].text, 'Cayenne is a subdivision of French Guiana (GA 78)')
  assert.equal(found(placement)[1].text, 'French Guiana (GA 78) belongs to the checklist French Guiana')
  assert.equal(found(placement)[1].ref, refOf('- name: French Guiana'))
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
  assert.equal(found(placement)[0].text, 'GA 32253 French Guiana belongs to the checklist French Guiana')
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
  assert.equal(found(placement)[0].text, 'Central European Russia (TDWG 14RUC) lies in Russia')
  assert.equal(found(placement)[0].pct, 100)
  assert.equal(found(placement)[0].ref, refOf('match: { tdwg: 14RUC }'))
  assert.match(found(placement)[0].ref, /^placement\.yml:\d+$/)
  assert.deepEqual(placement.shape, { key: 'GeographicArea/19713', name: 'Russia' })
})

test('TDWG Borneo is not placeable', () => {
  const placement = placeArea(ga(fx.ga33639), ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.shape, null)
  assert.equal(placement.reason, 'spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%')
  assert.deepEqual(sources(placement), ['overlap'])
  assert.equal(found(placement)[0].ref, refOf('match: { tdwg: 42BOR }'))
  assert.equal(found(placement)[0].text, 'Borneo spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%')
})

test('NZCC: Northland lands in New Zealand by its ISO code', () => {
  const placement = placeArea(gz(fx.gz3529), ctx)
  assert.equal(placement.checklist.name, 'New Zealand')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'TaxonWorks', 'TaxonWorks'])
  assert.equal(found(placement)[0].text, 'NZCC: Northland has ISO code NZ')
  assert.equal(found(placement)[1].text, 'NZ is the ISO code of New Zealand')
  assert.equal(found(placement)[2].text, 'no outline cached for New Zealand')
  assert.equal(placement.shape, null)
  assert.equal(placement.reason, null)
})

test('a gazetteer whose ISO code has no checklist is not placeable', () => {
  const placement = placeArea(gz({ ...fx.gz10453, iso_3166_a2: 'ZZ' }), ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, 'no checklist for ZZ')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('a Solomon Islands gazetteer lands in Solomon Islands though its country area has no ISO (R18)', () => {
  const placement = placeArea(gz(fx.gz3575), ctx)
  assert.equal(placement.checklist.name, 'Solomon Islands')
  assert.deepEqual(found(placement).slice(0, 2).map((step) => [step.text, step.source, step.ref]), [
    ['Solomon Islands: Guadalcanal has ISO code SB', 'TaxonWorks', undefined],
    ['SB is the ISO code of Solomon Islands', 'manual', refOf('  Solomon Islands: SB')]
  ])
})

test('a US state under GA 33412 lands in United States (R17)', () => {
  const placement = placeArea(ga(fx.ga33455), ctx)
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.checklist.id, 237)
  assert.equal(found(placement)[0].text, 'Alabama is in United States (GA 33412)')
  const usa = placeArea(ga(fx.ga33412), ctx)
  assert.equal(usa.checklist.name, 'United States')
  assert.deepEqual(found(usa).map((step) => [step.text, step.source]), [
    ['United States of America (GA 33412) is a country', 'TaxonWorks'],
    ['United States of America is a spelling of United States', 'manual']
  ])
  assert.equal(found(usa)[1].ref, refOf('[United States, United States of America]'))
  // GA 33412 has no shape; the outline is GA 237's.
  assert.deepEqual(usa.shape, { key: 'GeographicArea/237', name: 'United States' })
  assert.deepEqual(placement.shape, { key: 'GeographicArea/237', name: 'United States' })
})

test('Texas (no level0) lands in United States through its parent GA 237', () => {
  const placement = placeArea(ga(fx.ga26386), ctx)
  assert.equal(placement.checklist.name, 'United States')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
  assert.equal(found(placement)[0].text, 'Texas is a subdivision of United States (GA 237)')
})

test('Corse lands in France, part Corsica', () => {
  const placement = placeArea(ga(fx.ga32254), ctx)
  assert.equal(placement.checklist.name, 'France')
  assert.equal(placement.part, 'Corsica')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'manual'])
  assert.equal(found(placement)[0].text, 'Corse is in France (GA 77)')
  assert.equal(found(placement)[1].ref, refOf('- name: Corsica'))
  assert.deepEqual(placement.shape, { key: 'GeographicArea/32254', name: 'Corsica' })
})

test('France itself has no part', () => {
  const placement = placeArea(ga(fx.ga77), ctx)
  assert.equal(placement.checklist.name, 'France')
  assert.equal(placement.part, null)
  assert.deepEqual(sources(placement), ['TaxonWorks', 'TaxonWorks'])
  assert.equal(found(placement).at(-1).text, 'no part: France (GA 77) is the whole of France')
  assert.deepEqual(placement.shape, { key: 'GeographicArea/77', name: 'France' })
})

test('TDWG 12FRA lands in France, part Mainland France, manual', () => {
  const placement = placeArea(ga(fx.ga33696), ctx)
  assert.equal(placement.checklist.name, 'France')
  assert.equal(placement.part, 'Mainland France')
  assert.deepEqual(sources(placement), ['manual'])
  assert.equal(found(placement)[0].ref, refOf('match: { tdwg: 12FRA }'))
  assert.ok(found(placement)[0].text.startsWith(
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
  assert.equal(found(placement)[0].ref, manualRef)
  assert.ok(found(placement)[0].text.endsWith(
    `; overrides the overlap measurement United Kingdom 99%, Ireland 1% (2026-11-20) (${overlapRef})`
  ), found(placement)[0].text)
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
  const area = { ...ga(fx.ga32254), key: 'GA 5', id: 5, name: 'Somewhere', level0: 4, parentId: 4, parentName: 'Atlantis' }
  const placement = placeArea(area, ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, 'no checklist for Atlantis')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('state stays null for areas', () => {
  assert.equal(placeArea(ga(fx.ga33876), ctx).state, null)
})

// Records (specimens, field occurrences) and states.
// Fixture overlap rules for made-up areas, appended to the real rules file the
// way the measuring script appends them. Real areas (Kaua'i, Central European
// Russia) use the real measured lines of the rules file.
const stateRulesText = `
  - match: { gazetteer_prefix: "Hawai'i: Ni" }
    subdivision_of: { country: United States, state: Hawaii }
    measured: "Hawaii 100% (2026-11-20)"
  - match: { area: GA 900001 }
    subdivision_of: { country: Russia, state: Krasnoyarsk }
    measured: "Krasnoyarsk 100% (2026-11-20)"
`
const recordYaml = yamlText.replace(/\n*$/, '\n') + stateRulesText
const recordRules = compileRules(recordYaml)
const recordLines = recordYaml.split('\n')
const recordRefOf = (text) => `placement.yml:${recordLines.findLastIndex((line) => line.includes(text)) + 1}`
// Countries the fixture areas do not bring, given by hand as a country file would have them.
const tanzania = { id: 31731, name: 'Tanzania', iso2: 'TZ', areaIds: [31731], states: false }
const ukraine = { id: 234, name: 'Ukraine', iso2: 'UA', areaIds: [234], states: false }
const georgia = { id: 81, name: 'Georgia', iso2: 'GE', areaIds: [81], states: false }
const recordChecklists = [...checklists, tanzania, ukraine, georgia]
// Fake geometry: points by "lng,lat", states by checklist id.
// A point near a coast is listed in nearPoints (geometry.js checklistsAtPoint `near`).
const pointsIn = new Map([['30.5,50.4', [234]], ['40.1,49.9', [234, 19713]], ['0,0', []], ['-84.4,33.7', [237]], ['33.4,44.4', [234]], ['-84.5,33.8', [237]]])
const nearPoints = new Set(['33.4,44.4', '-84.5,33.8'])
const statesAt = new Map([['237:-84.4,33.7', { name: 'Georgia', near: false }], ['237:-84.5,33.8', { name: 'Georgia', near: true }]])
const partsAt = new Map([['77:9.1,42.1', { name: 'Corsica', by: 'outline' }], ['77:2.3,48.9', { name: 'Mainland France', by: 'outline' }], ['77:-1.5,46', { name: 'Mainland France', by: 'box' }]])
const geometry = {
  checklistsAt: async ([lng, lat]) => ({ ids: pointsIn.get(`${lng},${lat}`) ?? [], near: nearPoints.has(`${lng},${lat}`) }),
  stateAt: async (id, [lng, lat]) => statesAt.get(`${id}:${lng},${lat}`) ?? null,
  partAt: async (id, [lng, lat]) => partsAt.get(`${id}:${lng},${lat}`) ?? null,
  // Names and Natural Earth aliases as Geometry.stateNames gives them.
  stateNames: (id) => ({
    237: ['Alabama', 'Colorado', 'District of Columbia', 'Georgia', 'Hawaii', 'Oregon', 'Texas', 'Utah', 'Washington']
      .map((name) => ({ name, aliases: [] })),
    19713: [
      { name: 'Krasnoyarsk', aliases: [] },
      { name: 'Moscow Oblast', aliases: ['Moskovskaya'] },
      { name: 'Moscow', aliases: ['Moskva', 'Moskovskaya'] },
      { name: 'Pskov', aliases: ["Pskovskaya Oblast'"] },
      { name: "Tver'", aliases: [] },
      // Natural Earth lists Chukot among the aliases of Sakha (Yakutia), as in subdivisions.geojson.
      { name: 'Sakha (Yakutia)', aliases: ['Sakha Republic', 'Chukot'] },
      { name: 'Chukchi Autonomous Okrug', aliases: [] }
    ]
  })[id] ?? []
}
// GA 900003 and GA 900009 are fixture areas with a cached outline; GZ 900004 is
// a gazetteer whose cached outline is a point (context `unusable`).
const recordShapes = new Set([...shapes, 'GeographicArea/31731', 'GeographicArea/234', 'GeographicArea/81',
  'GeographicArea/900003', 'GeographicArea/900009', 'Gazetteer/900004'])
const rctx = createContext({ checklists: recordChecklists, rules: recordRules, geometry, shapes: recordShapes, unusable: new Set(['Gazetteer/900004']) })
const specimen = (fields) => ({ type: 'CollectionObject', id: 1, ...fields })
const ad = (area) => placeRecord({ type: 'AssertedDistribution', id: 1 }, rctx, area)
// GA 900001 "Evenk" and the US state "Georgia" are fixture areas made for these tests.
const evenk = { ...ga(fx.ga32254), key: 'GA 900001', id: 900001, name: 'Evenk', level0: 19713, parentId: 19713, parentName: 'Russia' }
const usGeorgia = { ...ga(fx.ga33455), key: 'GA 900002', id: 900002, name: 'Georgia' }

test('Tanzania specimen through synonym', async () => {
  const placement = await placeRecord(specimen({ country: 'United Republic of Tanzania' }), rctx)
  assert.equal(placement.checklist.name, 'Tanzania')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'manual'])
  assert.equal(found(placement)[0].text, 'DwC country is United Republic of Tanzania')
  assert.equal(found(placement)[1].text, 'United Republic of Tanzania is a spelling of Tanzania')
  assert.equal(found(placement)[1].ref, refOf('- [Tanzania, United Republic of Tanzania]'))
  assert.equal(placement.state, null)
})

test('specimen France + stateProvince French Guiana lands in French Guiana', async () => {
  const placement = await placeRecord(specimen({ country: 'France', stateProvince: 'French Guiana' }), rctx)
  assert.equal(placement.checklist.name, 'French Guiana')
  assert.deepEqual(sources(placement), ['manual'])
  assert.equal(found(placement)[0].text,
    'DwC stateProvince French Guiana contains the name French Guiana of the checklist French Guiana')
  assert.equal(found(placement)[0].ref, refOf('- name: French Guiana'))
  assert.deepEqual(placement.shape, { key: 'GeographicArea/32253', name: 'French Guiana' })
})

test('specimen France + stateProvince Corse lands in France, part Corsica', async () => {
  const placement = await placeRecord(specimen({ country: 'France', stateProvince: 'Corse' }), rctx)
  assert.equal(placement.checklist.name, 'France')
  assert.equal(placement.part, 'Corsica')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'manual'])
  assert.equal(found(placement)[1].text, 'DwC stateProvince Corse carries the name Corse of the part Corsica')
  assert.equal(found(placement)[1].ref, refOf('- name: Corsica'))
  const mainland = await placeRecord(specimen({ country: 'France', stateProvince: 'Alsace' }), rctx)
  assert.equal(mainland.part, 'Mainland France')
  const none = await placeRecord(specimen({ country: 'France' }), rctx)
  assert.equal(none.part, null)
})

test('coordinates only', async () => {
  const placement = await placeRecord(specimen({ lat: 50.4, lng: 30.5 }), rctx)
  assert.equal(placement.checklist.name, 'Ukraine')
  assert.equal(placement.reason, null)
  assert.deepEqual(found(placement)[0], { text: 'coordinates 50.4, 30.5 lie inside Ukraine', source: 'overlap', stage: 'checklist' })
})

test('coordinates within the coastal tolerance say so and cite the rules line (R48)', async () => {
  const placement = await placeRecord(specimen({ lat: 44.4, lng: 33.4 }), rctx)
  assert.equal(placement.checklist.name, 'Ukraine')
  assert.deepEqual(found(placement)[0], {
    text: 'coordinates 44.4, 33.4 lie within about 5 km of the coast of Ukraine',
    source: 'overlap',
    ref: refOf('coastal_tolerance_degrees:'),
    stage: 'checklist'
  })
  const state = await placeRecord(specimen({ lat: 33.8, lng: -84.5 }), rctx)
  assert.equal(state.state, 'Georgia')
  assert.equal(found(state).at(-1).text, 'coordinates 33.8, -84.5 lie within about 5 km of the coast of the state Georgia')
  assert.equal(found(state).at(-1).ref, refOf('coastal_tolerance_degrees:'))
})

test('border point', async () => {
  const placement = await placeRecord(specimen({ lat: 49.9, lng: 40.1 }), rctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.shape, null)
  assert.equal(placement.reason, 'coordinates in several countries (Russia, Ukraine)')
})

test('coordinates outside every outline', async () => {
  const placement = await placeRecord(specimen({ lat: 0, lng: 0 }), rctx)
  assert.equal(placement.reason, 'coordinates outside every outline')
})

test('a DwC country wins over coordinates', async () => {
  const placement = await placeRecord(specimen({ country: 'Ukraine', lat: 49.9, lng: 40.1 }), rctx)
  assert.equal(placement.checklist.name, 'Ukraine')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('no country and no coordinates', async () => {
  assert.equal((await placeRecord(specimen({ locality: 'near the river' }), rctx)).reason, 'locality text only')
  assert.equal((await placeRecord(specimen({}), rctx)).reason, 'no locality at all')
  assert.equal((await placeRecord({ type: 'FieldOccurrence', id: 2 }, rctx)).reason, 'no locality at all')
})

test('a Kosovo specimen lands in the Kosovo checklist (R34)', async () => {
  const placement = await placeRecord(specimen({ country: 'Kosovo', lat: 42.6, lng: 21.1 }), rctx)
  assert.equal(placement.checklist.name, 'Kosovo')
  assert.equal(placement.reason, null)
  assert.equal(found(placement)[0].text, 'DwC country is Kosovo')
})

test('TDWG Norfolk Is. is the Norfolk Island checklist; Lord Howe I. below it stays in Australia (R35)', () => {
  const norfolk = placeArea(ga(fx.ga33700), ctx)
  assert.equal(norfolk.checklist.name, 'Norfolk Island')
  assert.equal(found(norfolk)[0].ref, refOf('- name: Norfolk Island'))
  const lordHowe = placeArea(ga(fx.ga34374), ctx)
  assert.equal(lordHowe.checklist.name, 'Australia')
  assert.equal(found(lordHowe)[0].source, 'manual')
  assert.equal(found(lordHowe)[0].ref, refOf('match: { tdwg: 50NFK-LH }'))
})

test('Kralicky Sneznik is not placeable by a manual rule (R36)', () => {
  const placement = placeArea(gz(fx.gz10572), ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, 'lies on the border of Czech Republic and Poland')
  assert.equal(found(placement)[0].source, 'manual')
  assert.ok(!rules.overlap.some((rule) => rule.match.area === 'GZ 10572'))
})

test('a US specimen takes its state from DwC stateProvince', async () => {
  const placement = await placeRecord(specimen({ country: 'United States', stateProvince: 'Texas' }), rctx)
  assert.equal(placement.state, 'Texas')
  assert.deepEqual(found(placement).at(-1), { text: 'DwC stateProvince Texas is the state Texas', source: 'TaxonWorks', stage: 'state' })
})

test('a US specimen without stateProvince takes its state from its coordinates', async () => {
  const placement = await placeRecord(specimen({ country: 'United States of America', lat: 33.7, lng: -84.4 }), rctx)
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.state, 'Georgia')
  assert.deepEqual(found(placement).at(-1), { text: 'coordinates 33.7, -84.4 lie inside the state Georgia', source: 'overlap', stage: 'state' })
})

test('a US specimen with neither gets no state, with the reason', async () => {
  const placement = await placeRecord(specimen({ country: 'United States', stateProvince: 'Atlantis' }), rctx)
  assert.equal(placement.state, null)
  assert.equal(found(placement).at(-1).text, 'no state: Atlantis is not a state of United States')
  assert.ok(placement.steps.some((step) => step.none && step.text === 'DwC stateProvince Atlantis is no state name of United States'))
})

test('a specimen with DwC country Georgia and stateProvince Georgia lands in the country Georgia with no state', async () => {
  const placement = await placeRecord(specimen({ country: 'Georgia', stateProvince: 'Georgia' }), rctx)
  assert.equal(placement.checklist.name, 'Georgia')
  assert.equal(placement.state, null)
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('the US state Georgia stays in the United States (state Georgia) and does not merge with the country Georgia', async () => {
  const placement = await ad(usGeorgia)
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.state, 'Georgia')
  assert.deepEqual(found(placement).at(-1), { text: 'Georgia (GA 900002) is the state Georgia', source: 'TaxonWorks', stage: 'state' })
})

test('Hawaiian gazetteer gets state Hawaii by its measured overlap rule', async () => {
  const placement = await ad(gz(fx.gz10453))
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.state, 'Hawaii')
  const step = found(placement).find((s) => s.text.includes('state'))
  assert.deepEqual(step, {
    text: "Hawai'i: Kaua'i (GZ 10453) lies in the state Hawaii",
    source: 'overlap',
    ref: recordRefOf('match: { area: "GZ 10453" }'),
    pct: 100,
    pctOf: 'Hawaii',
    stage: 'state'
  })
})

test('a state rule can match gazetteers by name prefix', async () => {
  const niihau = gz({ ...fx.gz10453, id: 900004, name: "Hawai'i: Ni'ihau" })
  const placement = await ad(niihau)
  assert.equal(placement.state, 'Hawaii')
  assert.equal(found(placement).at(-1).ref, recordRefOf("gazetteer_prefix: \"Hawai'i: Ni\""))
})

test('Evenk (political) gets state Krasnoyarsk by overlap rule', async () => {
  const placement = await ad(evenk)
  assert.equal(placement.checklist.name, 'Russia')
  assert.equal(placement.state, 'Krasnoyarsk')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'overlap'])
  assert.equal(found(placement)[1].ref, recordRefOf('match: { area: GA 900001 }'))
})

test('Chukot (GA 20379) gets the Chukotka state from its manual rule, not from its wrong outline', async () => {
  const chukot = { ...evenk, key: 'GA 20379', id: 20379, name: 'Chukot' }
  const placement = await ad(chukot)
  assert.equal(placement.checklist.name, 'Russia')
  assert.equal(placement.state, 'Chukchi Autonomous Okrug')
  const ref = refOf('match: { area: GA 20379 }')
  assert.ok(placement.steps.every((step) => step.source !== 'overlap'))
  assert.deepEqual(found(placement).at(-1), {
    text: 'Chukot (GA 20379) counts as the state Chukchi Autonomous Okrug (the cached TaxonWorks outline of Chukot ' +
      'also covers Yakutia; fix the shape in TaxonWorks)',
    source: 'manual',
    ref,
    stage: 'state'
  })
})

test('Central European Russia has no state, reason spans', async () => {
  const placement = await ad(ga(fx.ga33876))
  assert.equal(placement.checklist.name, 'Russia')
  assert.equal(placement.state, null)
  // The country still comes from the country overlap line, not the state line.
  assert.equal(found(placement)[0].ref, refOf('match: { tdwg: 14RUC }'))
  // The state line is the measured one, the last line matching 14RUC.
  const spans = recordRules.overlap.find((rule) => rule.match.tdwg === '14RUC' && rule.action.notPlaceable)
  assert.deepEqual(found(placement)[1], {
    text: `no state: spans several states: ${spans.measured.replace(/ \(\d{4}-\d{2}-\d{2}\)$/, '')}`,
    source: 'overlap',
    ref: recordRefOf('match: { tdwg: 14RUC }'),
    stage: 'state'
  })
  assert.notEqual(found(placement)[0].ref, found(placement)[1].ref)
})

test('an area for the whole country gets no state', async () => {
  const placement = await ad(ga(fx.ga19713))
  assert.equal(placement.state, null)
  assert.deepEqual(found(placement).at(-1), { text: 'no state: record is for the whole country', source: 'TaxonWorks', stage: 'state' })
})

test('a state area no rule measured yet', async () => {
  const placement = await ad({ ...evenk, key: 'GA 900003', id: 900003, name: 'Somewhere' })
  assert.equal(found(placement).at(-1).text, 'no state: not measured yet')
})

test('no state for an area without outline, or whose outline holds no polygon', async () => {
  const bare = await ad({ ...evenk, key: 'GA 900005', id: 900005, name: 'Somewhere' })
  assert.equal(found(bare).at(-1).text, 'no state: no outline to measure')
  const point = await ad({ ...gz(fx.gz10453), key: 'GZ 900004', id: 900004, name: "Hawai'i: Somewhere" })
  assert.equal(point.checklist.name, 'United States')
  assert.equal(found(point).at(-1).text, 'no state: no usable outline (no polygon)')
})

test('a country area whose outline holds no polygon is not measurable, not "not measured yet"', () => {
  const point = { ...gz(fx.gz3529), key: 'GZ 900004', id: 900004, name: 'Low Beskids', iso2: null }
  const placement = placeArea(point, rctx)
  assert.equal(placement.reason, 'no usable outline (no polygon)')
  assert.equal(found(placement)[0].text, 'Low Beskids (GZ 900004) has no country in TaxonWorks and no rule; its cached outline holds no polygon to measure')
})

test('a state rule "outside every state outline" gives the reason for no state', async () => {
  const outsideRules = compileRules(recordYaml.replace(/\n*$/, '\n') + `  - match: { area: GA 900006 }
    not_placeable: outside every state outline
    measured: "no sample in any outline (2026-11-20)"
`)
  const local = createContext({ checklists: recordChecklists, rules: outsideRules, geometry, shapes: recordShapes })
  const placement = await placeRecord({ type: 'AssertedDistribution', id: 1 }, local, { ...evenk, key: 'GA 900006', id: 900006, name: 'Island' })
  assert.equal(placement.checklist.name, 'Russia')
  assert.equal(found(placement).at(-1).text, 'no state: outside every state outline')
  assert.match(found(placement).at(-1).ref, /^placement\.yml:\d+$/)
})

test('a country without states gets no state step', async () => {
  const placement = await ad(ga(fx.ga77))
  assert.equal(placement.state, null)
  assert.ok(!placement.steps.some((step) => step.text.startsWith('no state')))
})

test('a France specimen with only coordinates in Corsica gets part Corsica', async () => {
  const placement = await placeRecord(specimen({ country: 'France', lat: 42.1, lng: 9.1 }), rctx)
  assert.equal(placement.part, 'Corsica')
  assert.deepEqual(found(placement).at(-1), { text: 'coordinates 42.1, 9.1 lie inside Corsica', source: 'overlap', stage: 'part' })
  assert.deepEqual(placement.shape, { key: 'GeographicArea/32254', name: 'Corsica' })
})

test('a France specimen with coordinates on the mainland gets Mainland France', async () => {
  const byOutline = await placeRecord(specimen({ country: 'France', lat: 48.9, lng: 2.3 }), rctx)
  assert.equal(byOutline.part, 'Mainland France')
  assert.equal(found(byOutline).at(-1).source, 'overlap')
  // A point only the rough box of a part holds says so and cites the part's line.
  const byBox = await placeRecord(specimen({ country: 'France', lat: 46, lng: -1.5 }), rctx)
  assert.equal(byBox.part, 'Mainland France')
  assert.deepEqual(found(byBox).at(-1), {
    text: 'coordinates 46, -1.5 lie inside the rough box of the part Mainland France', source: 'manual', ref: refOf('- name: Mainland France'),
    stage: 'part'
  })
  // A point no part outline or box holds still lies below country level: the rest part.
  const byRest = await placeRecord(specimen({ country: 'France', lat: 45.5, lng: 4.8 }), rctx)
  assert.equal(byRest.part, 'Mainland France')
  assert.equal(found(byRest).at(-1).text, 'coordinates 45.5, 4.8 lie below country level, so they go to the part Mainland France')
})

test('a county abroad named like an overseas department stays in its own country', async () => {
  const placement = await placeRecord(specimen({ country: 'United States', stateProvince: 'Texas', county: 'Martinique County' }), rctx)
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.state, 'Texas')
  const loose = await placeRecord(specimen({ stateProvince: 'Martinique' }), rctx)
  assert.equal(loose.checklist.name, 'Martinique')
})

test('coordinates without geometry are not checked', async () => {
  const bare = createContext({ checklists: recordChecklists, rules: recordRules, geometry: null, shapes: recordShapes })
  const placement = await placeRecord(specimen({ lat: 50.4, lng: 30.5 }), bare)
  assert.equal(placement.reason, 'coordinates not checked')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('an overlap step names what its share refers to', () => {
  const placement = placeArea(ga(fx.ga33876), ctx)
  assert.equal(found(placement)[0].pct, 100)
  assert.equal(found(placement)[0].pctOf, 'Russia')
})

// R30: an area's own name is a state only when the area is a state.
const ignoredRef = refOf('ignored_name_words:')

test('a county named like a state gets the state it lies in, not the state of its name', async () => {
  for (const [shape, state] of [[fx.ga30398, 'Texas'], [fx.ga29533, 'Utah'], [fx.ga28085, 'Oregon']]) {
    const placement = await ad(ga(shape))
    assert.equal(placement.checklist.name, 'United States')
    assert.equal(placement.state, state, shape.name)
    assert.deepEqual(found(placement).at(-1), {
      text: `${shape.name} is a subdivision of ${state} (GA ${shape.parent_id}), the state ${state}`,
      source: 'TaxonWorks',
      stage: 'state'
    })
  }
})

test('a gadm state (type Unknown, parent the country) is the state of its own name', async () => {
  const placement = await ad(ga(fx.ga26370))
  assert.equal(placement.state, 'Washington')
  assert.deepEqual(found(placement).at(-1), { text: 'Washington (GA 26370) is the state Washington', source: 'TaxonWorks', stage: 'state' })
})

test('a Natural Earth alias decides nothing: stateProvince Moskva is no state name (R51)', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Moskva' }), rctx)
  assert.equal(placement.state, null)
  assert.deepEqual(found(placement).at(-1), { text: 'no state: Moskva is not a state of Russia', source: 'TaxonWorks', stage: 'state' })
  assert.ok(placement.steps.some((step) => step.none && step.text === 'DwC stateProvince Moskva is no state name of Russia'))
  assert.ok(!placement.steps.some((step) => step.source === 'Natural Earth'))
})

test('a stateProvince that names a TaxonWorks area of the checklist takes that area\'s state (R51)', async () => {
  const russia = recordChecklists.find((checklist) => checklist.name === 'Russia')
  const local = createContext({
    checklists: recordChecklists, rules: recordRules, geometry, shapes: recordShapes,
    stateAreas: new Map([[russia.id, [evenk]]])
  })
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Evenk', lat: 50.4, lng: 30.5 }), local)
  assert.equal(placement.state, 'Krasnoyarsk')
  assert.deepEqual(found(placement).at(-1), {
    text: 'DwC stateProvince Evenk is TaxonWorks area GA 900001, which lies in the state Krasnoyarsk',
    source: 'overlap', ref: recordRefOf('match: { area: GA 900001 }'), pct: 100, pctOf: 'Krasnoyarsk',
    stage: 'state'
  })
  // Two areas of that name in the checklist: the name is ambiguous and ignored.
  const twice = createContext({
    checklists: recordChecklists, rules: recordRules, geometry, shapes: recordShapes,
    stateAreas: new Map([[russia.id, [evenk, { ...evenk, key: 'GA 900011', id: 900011 }]]])
  })
  const ambiguous = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Evenk' }), twice)
  assert.equal(ambiguous.state, null)
})

test('a stateProvince matched by ignoring words cites the word list', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Krasnoyarsk Krai' }), rctx)
  assert.equal(placement.state, 'Krasnoyarsk')
  assert.deepEqual(found(placement).at(-1), {
    text: 'DwC stateProvince "Krasnoyarsk Krai" matches the state Krasnoyarsk (ignoring "krai")',
    source: 'manual',
    ref: ignoredRef,
    stage: 'state'
  })
  // "Sakha" was the alias "Sakha Republic" with "republic" ignored; aliases decide nothing now (R51).
  const both = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Sakha' }), rctx)
  assert.equal(both.state, null)
})

test('an exact stateProvince wins over coordinates and needs no Natural Earth step', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Moscow Oblast' }), rctx)
  assert.equal(placement.state, 'Moscow Oblast')
  assert.equal(found(placement).at(-1).source, 'TaxonWorks')
})

test('a state area named by an alias gets no state from it (R51), a parent matched by ignoring words does', async () => {
  const moskva = { ...evenk, key: 'GA 900005', id: 900005, name: 'Moskva' }
  const own = await ad(moskva)
  assert.equal(own.state, null)
  assert.deepEqual(found(own).at(-1), { text: 'no state: no outline to measure', source: 'TaxonWorks', stage: 'state' })
  const district = { ...evenk, key: 'GA 900006', id: 900006, name: 'Some District', level1: 900007, parentId: 900007, parentName: 'Pskov Oblast', origin: 'gadm', type: 'Raion' }
  const parent = await ad(district)
  assert.equal(parent.state, 'Pskov')
  assert.deepEqual(found(parent).at(-1), {
    text: 'Some District is a subdivision of Pskov Oblast (GA 900007), which matches the state Pskov (ignoring "oblast")',
    source: 'manual',
    ref: ignoredRef,
    stage: 'state'
  })
})

test('a TDWG area, which has no levels, is still tried by its own name', async () => {
  // Placed in Russia by the 14RUC country rule; its name, not the 14RUC state rule, gives the state.
  const tdwg = { ...ga(fx.ga33876), key: 'GA 900008', id: 900008, name: 'Krasnoyarsk' }
  const placement = await ad(tdwg)
  assert.equal(placement.state, 'Krasnoyarsk')
  assert.deepEqual(found(placement).at(-1), { text: 'Krasnoyarsk (TDWG 14RUC) is the state Krasnoyarsk', source: 'TaxonWorks', stage: 'state' })
})

test('an area below a county does not take the county name as its state', async () => {
  // Parent GA 29533 is Washington County, Utah; the state (level1) is GA 26581 Utah.
  const town = { ...ga(fx.ga29533), key: 'GA 900009', id: 900009, name: 'Some Town', type: 'Town', parentId: 29533, parentName: 'Washington' }
  const placement = await ad(town)
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.state, null)
  assert.equal(found(placement).at(-1).text, 'no state: not measured yet')
})

test('a Cornwall-like county lands in the United Kingdom with no state and no state step (R50)', async () => {
  const cornwall = { ...ga(fx.ga32254), key: 'GA 900010', id: 900010, name: 'Cornwall', type: 'County', level0: 236, level1: null, parentId: 236, parentName: 'United Kingdom', origin: 'ne_states' }
  const placement = await ad(cornwall)
  assert.equal(placement.checklist.name, 'United Kingdom')
  assert.equal(placement.state, null)
  assert.ok(!placement.steps.some((step) => step.text.startsWith('no state')))
})

test('a gazetteer without ISO code and without rule lists every check before its reason', () => {
  const area = { ...gz(fx.gz3529), key: 'GZ 900010', id: 900010, name: 'Nowhere Island', iso2: null }
  const placement = placeArea(area, rctx)
  assert.equal(placement.reason, 'no outline')
  assert.deepEqual(placement.steps.map((step) => [step.text, step.source, Boolean(step.none)]), [
    ['no manual rule for Nowhere Island (GZ 900010)', 'manual', true],
    ['Nowhere Island (GZ 900010) matches no checklist of its own (by area, parent, ISO code or name)', 'manual', true],
    ['Nowhere Island (GZ 900010) is a gazetteer, which has no country in TaxonWorks', 'TaxonWorks', true],
    ['Nowhere Island (GZ 900010) has no ISO code in TaxonWorks', 'TaxonWorks', true],
    ['no overlap rule for Nowhere Island (GZ 900010)', 'overlap', true],
    ['Nowhere Island (GZ 900010) has no country in TaxonWorks, no rule and no cached outline to measure', 'TaxonWorks', false]
  ])
})

test('a specimen lists the checks it passed before the one that placed it', async () => {
  const placement = await placeRecord(specimen({ lat: 50.4, lng: 30.5 }), rctx)
  const none = placement.steps.filter((step) => step.none).map((step) => step.text)
  assert.deepEqual(none.slice(0, 2), ['no DwC country, stateProvince or county to name a checklist of its own', 'no DwC country'])
})

test('the own-checklist step names the DwC fields it read', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Moskva' }), rctx)
  const own = placement.steps.find((step) => step.text.includes('of a checklist of its own'))
  assert.equal(own.text, 'DwC country Russia carries no name of a checklist of its own')
  assert.equal(own.none, true)
})

test('a state check that finds no rule giving a state does not hide the rule that says why there is none', async () => {
  const placement = await ad(gz(fx.gz10453))
  const texts = placement.steps.map((step) => step.text)
  assert.ok(texts.some((text) => /^no manual rule gives .* a state$/.test(text)), texts.join('\n'))
})

// Task 1 (PLAN-specimen-data.md): a specimen without coordinates is placed by
// its collecting event's area, exactly as an asserted distribution on it.
test('a specimen without coordinates is placed by its collecting event area, as an AD on it', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Evenkia', eventArea: evenk }), rctx)
  const asAd = await ad(evenk)
  assert.equal(placement.checklist.name, 'Russia')
  assert.equal(placement.state, 'Krasnoyarsk')
  assert.equal(placement.state, asAd.state)
  assert.deepEqual(placement.steps.slice(0, 2), [
    { text: 'no coordinates and no georeference shape', source: 'TaxonWorks', none: true, stage: 'checklist' },
    { text: "the collecting event's area is Evenk (GA 900001)", source: 'TaxonWorks', via: 'eventArea', stage: 'checklist' }
  ])
  assert.deepEqual(placement.steps.slice(2), asAd.steps)
})

test('with coordinates the collecting event area is not used', async () => {
  const fields = { country: 'Russia', stateProvince: 'Moskva', lat: 50.4, lng: 30.5 }
  const withArea = await placeRecord(specimen({ ...fields, eventArea: evenk }), rctx)
  const without = await placeRecord(specimen(fields), rctx)
  assert.deepEqual(withArea, without)
})

test('an event area that gives no checklist hands over to the DwC fields, after its steps', async () => {
  const nowhere = { ...gz(fx.gz3529), key: 'GZ 900010', id: 900010, name: 'Nowhere Island', iso2: null }
  const placement = await placeRecord(specimen({ country: 'Russia', eventArea: nowhere }), rctx)
  assert.equal(placement.checklist.name, 'Russia')
  const texts = placement.steps.map((step) => step.text)
  assert.equal(texts[1], "the collecting event's area is Nowhere Island (GZ 900010)")
  assert.ok(texts.includes('Nowhere Island (GZ 900010) has no country in TaxonWorks, no rule and no cached outline to measure'), texts.join('\n'))
  const handOver = texts.indexOf('the area cannot be placed by its outline yet, so the DwC fields are read')
  assert.ok(handOver > 0, texts.join('\n'))
  assert.ok(texts.indexOf('DwC country is Russia') > handOver)
})

test('an event area no distribution uses is named, then the DwC fields decide', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', eventArea: { key: 'GA 999999' } }), rctx)
  const without = await placeRecord(specimen({ country: 'Russia' }), rctx)
  assert.equal(placement.checklist.name, without.checklist.name)
  assert.deepEqual(placement.steps[1], {
    text: "the collecting event's area GA 999999 is used by no distribution, so its country and levels are not known; the DwC fields are read",
    source: 'TaxonWorks', none: true, stage: 'checklist'
  })
  assert.deepEqual(placement.steps.slice(2), without.steps.slice(2))
})

// Task 1b: a georeference drawn as a shape (DwC footprintWKT, no decimalLatitude).
const SQUARE = 'POLYGON Z ((30.4 50.3 0,30.6 50.3 0,30.6 50.5 0,30.4 50.5 0,30.4 50.3 0))'

test('a georeference shape gives the point inside it, tested like coordinates', async () => {
  const placement = await placeRecord(specimen({ footprint: SQUARE, locality: 'Kyiv' }), rctx)
  assert.equal(placement.checklist.name, 'Ukraine')
  assert.deepEqual(placement.steps[0], { text: 'the georeference is a shape; the point 50.4, 30.5 inside it is used', source: 'TaxonWorks', via: 'shape', stage: 'checklist' })
  assert.ok(placement.steps.some((step) => step.text === 'coordinates 50.4, 30.5 lie inside Ukraine'))
})

test('coordinates win over the shape, and the shape over the collecting event area', async () => {
  const point = { lat: 50.4, lng: 30.5 }
  const withShape = await placeRecord(specimen({ ...point, footprint: 'POLYGON ((0 0,1 0,1 1,0 0))' }), rctx)
  assert.deepEqual(withShape, await placeRecord(specimen(point), rctx))
  const shapeAndArea = await placeRecord(specimen({ footprint: SQUARE, eventArea: evenk }), rctx)
  assert.equal(shapeAndArea.checklist.name, 'Ukraine')
  assert.ok(!shapeAndArea.steps.some((step) => step.text.startsWith("the collecting event's area")))
})

test('a specimen without a point says so first, then whether its collecting event has an area', async () => {
  const co = await placeRecord(specimen({ locality: 'somewhere' }), rctx)
  assert.deepEqual(co.steps.map((step) => step.text), [
    'no coordinates and no georeference shape',
    'the collecting event has no area',
    'no DwC country, stateProvince or county to name a checklist of its own',
    'no DwC country',
    'no DwC country and no coordinates, only locality text'
  ])
  const fo = await placeRecord({ type: 'FieldOccurrence', id: 3, country: 'Russia' }, rctx)
  assert.equal(fo.steps[1].text, 'the collecting event area of a field occurrence is not available from TaxonWorks')
  const badShape = await placeRecord(specimen({ footprint: 'POINT (1 2)' }), rctx)
  assert.equal(badShape.steps[0].text, 'no coordinates, and the georeference shape gives no point')
})

test('an event area that a rule makes not placeable stays not placeable for the specimen too', async () => {
  const spansRules = compileRules(recordYaml.replace(/\n*$/, '\n') + `  - match: { area: GA 900012 }
    not_placeable: spans several countries
    measured: "Russia 60%, Kazakhstan 40% (2026-11-20)"
`)
  const local = createContext({ checklists: recordChecklists, rules: spansRules, geometry, shapes: recordShapes })
  const border = { ...evenk, key: 'GA 900012', id: 900012, name: 'Border Steppe', level0: null, parentId: null, parentName: null }
  const asAd = await placeRecord({ type: 'AssertedDistribution', id: 1 }, local, border)
  const placement = await placeRecord(specimen({ country: 'Russia', eventArea: border }), local)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, asAd.reason)
  assert.ok(!placement.steps.some((step) => step.text.startsWith('DwC country')), placement.steps.map((step) => step.text).join('\n'))
})

test('a parent without a name is named by its key', () => {
  const area = { ...gz(fx.gz3529), kind: 'GA', key: 'GA 900013', id: 900013, name: 'Orphan', iso2: null, level0: null, parentId: 555, parentName: null }
  const texts = placeArea(area, rctx).steps.map((step) => step.text)
  assert.ok(texts.includes('Orphan (GA 900013) has no country in TaxonWorks, and its parent GA 555 has no checklist'), texts.join('\n'))
})

test('hasPoint: coordinates or a point in the georeference shape, not text that is no number', () => {
  assert.equal(hasPoint({ lat: '50.4', lng: '30.5' }), true)
  assert.equal(hasPoint({ footprint: SQUARE }), true)
  assert.equal(hasPoint({ lat: 'n/a', lng: '30.5' }), false)
  assert.equal(hasPoint({}), false)
})

test('the first step of a specimen placed through its shape or collecting event area says how (via)', async () => {
  assert.equal((await placeRecord(specimen({ footprint: SQUARE }), rctx)).steps[0].via, 'shape')
  assert.equal((await placeRecord(specimen({ eventArea: evenk }), rctx)).steps[1].via, 'eventArea')
})
