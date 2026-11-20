import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules } from './rules.js'
import { toArea } from './areas.js'
import { deriveChecklists } from './checklists.js'
import { createContext, placeArea, placeRecord } from './engine.js'
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
// Country ISO codes the build reads from scripts/data/country-iso.json (R18).
const isoByName = new Map([['solomon islands', 'SB']])
// New Zealand is used in TaxonWorks only through gazetteers here, so its
// checklist is given by hand (id and ISO code as a country file would have them).
const newZealand = { id: 158, name: 'New Zealand', iso2: 'NZ', areaIds: [158], states: false }
const checklists = [...deriveChecklists(areas, rules, new Map(), isoByName).checklists, newZealand]
const shapes = new Set(['GeographicArea/32253', 'GeographicArea/77', 'GeographicArea/32254',
  'GeographicArea/19713', 'GeographicArea/236', 'GeographicArea/237', 'GeographicArea/33639', 'GeographicArea/33876'])
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
  assert.equal(placement.steps[0].text, 'Central European Russia (TDWG 14RUC) lies in Russia')
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
  const placement = placeArea(gz({ ...fx.gz10453, iso_3166_a2: 'ZZ' }), ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, 'no checklist for ZZ')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
})

test('a Solomon Islands gazetteer lands in Solomon Islands though its country area has no ISO (R18)', () => {
  const placement = placeArea(gz(fx.gz3575), ctx)
  assert.equal(placement.checklist.name, 'Solomon Islands')
  assert.equal(placement.steps[0].text, 'Solomon Islands: Guadalcanal has ISO code SB, Solomon Islands')
})

test('a US state under GA 33412 lands in United States (R17)', () => {
  const placement = placeArea(ga(fx.ga33455), ctx)
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.checklist.id, 237)
  assert.equal(placement.steps[0].text, 'Alabama is in United States (GA 33412)')
  const usa = placeArea(ga(fx.ga33412), ctx)
  assert.equal(usa.checklist.name, 'United States')
  assert.deepEqual(usa.steps.map((step) => [step.text, step.source]), [
    ['United States of America (GA 33412) is a country', 'TaxonWorks'],
    ['United States of America is a spelling of United States', 'manual']
  ])
  assert.equal(usa.steps[1].ref, refOf('[United States, United States of America]'))
  // GA 33412 has no shape; the outline is GA 237's.
  assert.deepEqual(usa.shape, { key: 'GeographicArea/237', name: 'United States' })
  assert.deepEqual(placement.shape, { key: 'GeographicArea/237', name: 'United States' })
})

test('Texas (no level0) lands in United States through its parent GA 237', () => {
  const placement = placeArea(ga(fx.ga26386), ctx)
  assert.equal(placement.checklist.name, 'United States')
  assert.deepEqual(sources(placement), ['TaxonWorks'])
  assert.equal(placement.steps[0].text, 'Texas is a subdivision of United States (GA 237)')
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
const pointsIn = new Map([['30.5,50.4', [234]], ['40.1,49.9', [234, 19713]], ['0,0', []], ['-84.4,33.7', [237]]])
const statesAt = new Map([['237:-84.4,33.7', 'Georgia']])
const partsAt = new Map([['77:9.1,42.1', 'Corsica'], ['77:2.3,48.9', 'Mainland France']])
const geometry = {
  checklistsAt: async ([lng, lat]) => pointsIn.get(`${lng},${lat}`) ?? [],
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
const recordShapes = new Set([...shapes, 'GeographicArea/31731', 'GeographicArea/234', 'GeographicArea/81'])
const rctx = createContext({ checklists: recordChecklists, rules: recordRules, geometry, shapes: recordShapes })
const specimen = (fields) => ({ type: 'CollectionObject', id: 1, ...fields })
const ad = (area) => placeRecord({ type: 'AssertedDistribution', id: 1 }, rctx, area)
// GA 900001 "Evenk" and the US state "Georgia" are fixture areas made for these tests.
const evenk = { ...ga(fx.ga32254), key: 'GA 900001', id: 900001, name: 'Evenk', level0: 19713, parentId: 19713, parentName: 'Russia' }
const usGeorgia = { ...ga(fx.ga33455), key: 'GA 900002', id: 900002, name: 'Georgia' }

test('Tanzania specimen through synonym', async () => {
  const placement = await placeRecord(specimen({ country: 'United Republic of Tanzania' }), rctx)
  assert.equal(placement.checklist.name, 'Tanzania')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'manual'])
  assert.equal(placement.steps[0].text, 'DwC country is United Republic of Tanzania')
  assert.equal(placement.steps[1].text, 'United Republic of Tanzania is a spelling of Tanzania')
  assert.equal(placement.steps[1].ref, refOf('- [Tanzania, United Republic of Tanzania]'))
  assert.equal(placement.state, null)
})

test('specimen France + stateProvince French Guiana lands in French Guiana', async () => {
  const placement = await placeRecord(specimen({ country: 'France', stateProvince: 'French Guiana' }), rctx)
  assert.equal(placement.checklist.name, 'French Guiana')
  assert.deepEqual(sources(placement), ['manual'])
  assert.equal(placement.steps[0].text,
    'DwC stateProvince French Guiana contains the name French Guiana of the checklist French Guiana')
  assert.equal(placement.steps[0].ref, refOf('- name: French Guiana'))
  assert.deepEqual(placement.shape, { key: 'GeographicArea/32253', name: 'French Guiana' })
})

test('specimen France + stateProvince Corse lands in France, part Corsica', async () => {
  const placement = await placeRecord(specimen({ country: 'France', stateProvince: 'Corse' }), rctx)
  assert.equal(placement.checklist.name, 'France')
  assert.equal(placement.part, 'Corsica')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'manual'])
  assert.equal(placement.steps[1].text, 'DwC stateProvince Corse carries the name Corse of the part Corsica')
  assert.equal(placement.steps[1].ref, refOf('- name: Corsica'))
  const mainland = await placeRecord(specimen({ country: 'France', stateProvince: 'Alsace' }), rctx)
  assert.equal(mainland.part, 'Mainland France')
  const none = await placeRecord(specimen({ country: 'France' }), rctx)
  assert.equal(none.part, null)
})

test('coordinates only', async () => {
  const placement = await placeRecord(specimen({ lat: 50.4, lng: 30.5 }), rctx)
  assert.equal(placement.checklist.name, 'Ukraine')
  assert.equal(placement.reason, null)
  assert.deepEqual(placement.steps[0], { text: 'coordinates 50.4, 30.5 lie inside Ukraine', source: 'overlap' })
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
  assert.equal(placement.steps[0].text, 'DwC country is Kosovo')
})

test('TDWG Norfolk Is. is the Norfolk Island checklist; Lord Howe I. below it stays in Australia (R35)', () => {
  const norfolk = placeArea(ga(fx.ga33700), ctx)
  assert.equal(norfolk.checklist.name, 'Norfolk Island')
  assert.equal(norfolk.steps[0].ref, refOf('- name: Norfolk Island'))
  const lordHowe = placeArea(ga(fx.ga34374), ctx)
  assert.equal(lordHowe.checklist.name, 'Australia')
  assert.equal(lordHowe.steps[0].source, 'manual')
  assert.equal(lordHowe.steps[0].ref, refOf('match: { tdwg: 50NFK-LH }'))
})

test('Kralicky Sneznik is not placeable by a manual rule (R36)', () => {
  const placement = placeArea(gz(fx.gz10572), ctx)
  assert.equal(placement.checklist, null)
  assert.equal(placement.reason, 'lies on the border of Czech Republic and Poland')
  assert.equal(placement.steps[0].source, 'manual')
  assert.ok(!rules.overlap.some((rule) => rule.match.area === 'GZ 10572'))
})

test('a US specimen takes its state from DwC stateProvince', async () => {
  const placement = await placeRecord(specimen({ country: 'United States', stateProvince: 'Texas' }), rctx)
  assert.equal(placement.state, 'Texas')
  assert.deepEqual(placement.steps.at(-1), { text: 'DwC stateProvince Texas is the state Texas', source: 'TaxonWorks' })
})

test('a US specimen without stateProvince takes its state from its coordinates', async () => {
  const placement = await placeRecord(specimen({ country: 'United States of America', lat: 33.7, lng: -84.4 }), rctx)
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.state, 'Georgia')
  assert.deepEqual(placement.steps.at(-1), { text: 'coordinates 33.7, -84.4 lie inside the state Georgia', source: 'overlap' })
})

test('a US specimen with neither gets no state, with the reason', async () => {
  const placement = await placeRecord(specimen({ country: 'United States', stateProvince: 'Atlantis' }), rctx)
  assert.equal(placement.state, null)
  assert.equal(placement.steps.at(-1).text, 'no state: Atlantis is not a state of United States')
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
  assert.deepEqual(placement.steps.at(-1), { text: 'Georgia (GA 900002) is the state Georgia', source: 'TaxonWorks' })
})

test('Hawaiian gazetteer gets state Hawaii by its measured overlap rule', async () => {
  const placement = await ad(gz(fx.gz10453))
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.state, 'Hawaii')
  const step = placement.steps.find((s) => s.text.includes('state'))
  assert.deepEqual(step, {
    text: "Hawai'i: Kaua'i (GZ 10453) lies in the state Hawaii",
    source: 'overlap',
    ref: recordRefOf('match: { area: "GZ 10453" }'),
    pct: 100,
    pctOf: 'Hawaii'
  })
})

test('a state rule can match gazetteers by name prefix', async () => {
  const niihau = gz({ ...fx.gz10453, id: 900004, name: "Hawai'i: Ni'ihau" })
  const placement = await ad(niihau)
  assert.equal(placement.state, 'Hawaii')
  assert.equal(placement.steps.at(-1).ref, recordRefOf("gazetteer_prefix: \"Hawai'i: Ni\""))
})

test('Evenk (political) gets state Krasnoyarsk by overlap rule', async () => {
  const placement = await ad(evenk)
  assert.equal(placement.checklist.name, 'Russia')
  assert.equal(placement.state, 'Krasnoyarsk')
  assert.deepEqual(sources(placement), ['TaxonWorks', 'overlap'])
  assert.equal(placement.steps[1].ref, recordRefOf('match: { area: GA 900001 }'))
})

test('Chukot (GA 20379) gets the Chukotka state from its manual rule, not from its wrong outline', async () => {
  const chukot = { ...evenk, key: 'GA 20379', id: 20379, name: 'Chukot' }
  const placement = await ad(chukot)
  assert.equal(placement.checklist.name, 'Russia')
  assert.equal(placement.state, 'Chukchi Autonomous Okrug')
  const ref = refOf('match: { area: GA 20379 }')
  assert.ok(placement.steps.every((step) => step.source !== 'overlap'))
  assert.deepEqual(placement.steps.at(-1), {
    text: 'Chukot (GA 20379) counts as the state Chukchi Autonomous Okrug (the cached TaxonWorks outline of Chukot ' +
      'also covers Yakutia; fix the shape in TaxonWorks)',
    source: 'manual',
    ref
  })
})

test('Central European Russia has no state, reason spans', async () => {
  const placement = await ad(ga(fx.ga33876))
  assert.equal(placement.checklist.name, 'Russia')
  assert.equal(placement.state, null)
  // The country still comes from the country overlap line, not the state line.
  assert.equal(placement.steps[0].ref, refOf('match: { tdwg: 14RUC }'))
  // The state line is the measured one, the last line matching 14RUC.
  const spans = recordRules.overlap.find((rule) => rule.match.tdwg === '14RUC' && rule.action.notPlaceable)
  assert.deepEqual(placement.steps[1], {
    text: `no state: spans several states: ${spans.measured.replace(/ \(\d{4}-\d{2}-\d{2}\)$/, '')}`,
    source: 'overlap',
    ref: recordRefOf('match: { tdwg: 14RUC }')
  })
  assert.notEqual(placement.steps[0].ref, placement.steps[1].ref)
})

test('an area for the whole country gets no state', async () => {
  const placement = await ad(ga(fx.ga19713))
  assert.equal(placement.state, null)
  assert.deepEqual(placement.steps.at(-1), { text: 'no state: record is for the whole country', source: 'TaxonWorks' })
})

test('a state area no rule measured yet', async () => {
  const placement = await ad({ ...evenk, key: 'GA 900003', id: 900003, name: 'Somewhere' })
  assert.equal(placement.steps.at(-1).text, 'no state: not measured yet')
})

test('a country without states gets no state step', async () => {
  const placement = await ad(ga(fx.ga77))
  assert.equal(placement.state, null)
  assert.ok(!placement.steps.some((step) => step.text.startsWith('no state')))
})

test('a France specimen with only coordinates in Corsica gets part Corsica', async () => {
  const placement = await placeRecord(specimen({ country: 'France', lat: 42.1, lng: 9.1 }), rctx)
  assert.equal(placement.part, 'Corsica')
  assert.deepEqual(placement.steps.at(-1), { text: 'coordinates 42.1, 9.1 lie inside Corsica', source: 'overlap' })
  assert.deepEqual(placement.shape, { key: 'GeographicArea/32254', name: 'Corsica' })
})

test('a France specimen with coordinates on the mainland gets Mainland France', async () => {
  const byOutline = await placeRecord(specimen({ country: 'France', lat: 48.9, lng: 2.3 }), rctx)
  assert.equal(byOutline.part, 'Mainland France')
  assert.equal(byOutline.steps.at(-1).source, 'overlap')
  // A point no part outline or box holds still lies below country level: the rest part.
  const byRest = await placeRecord(specimen({ country: 'France', lat: 45.5, lng: 4.8 }), rctx)
  assert.equal(byRest.part, 'Mainland France')
  assert.equal(byRest.steps.at(-1).text, 'coordinates 45.5, 4.8 lie below country level, so they go to the part Mainland France')
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
  assert.equal(placement.steps[0].pct, 100)
  assert.equal(placement.steps[0].pctOf, 'Russia')
})

// R30: an area's own name is a state only when the area is a state.
const ignoredRef = refOf('ignored_name_words:')

test('a county named like a state gets the state it lies in, not the state of its name', async () => {
  for (const [shape, state] of [[fx.ga30398, 'Texas'], [fx.ga29533, 'Utah'], [fx.ga28085, 'Oregon']]) {
    const placement = await ad(ga(shape))
    assert.equal(placement.checklist.name, 'United States')
    assert.equal(placement.state, state, shape.name)
    assert.deepEqual(placement.steps.at(-1), {
      text: `${shape.name} is a subdivision of ${state} (GA ${shape.parent_id}), the state ${state}`,
      source: 'TaxonWorks'
    })
  }
})

test('a gadm state (type Unknown, parent the country) is the state of its own name', async () => {
  const placement = await ad(ga(fx.ga26370))
  assert.equal(placement.state, 'Washington')
  assert.deepEqual(placement.steps.at(-1), { text: 'Washington (GA 26370) is the state Washington', source: 'TaxonWorks' })
})

test('a stateProvince matched through a Natural Earth alias says so', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Moskva' }), rctx)
  assert.equal(placement.state, 'Moscow')
  assert.deepEqual(placement.steps.at(-1), { text: 'DwC stateProvince Moskva is a Natural Earth name of the state Moscow', source: 'Natural Earth' })
})

test('a stateProvince matched by ignoring words cites the word list', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Krasnoyarsk Krai' }), rctx)
  assert.equal(placement.state, 'Krasnoyarsk')
  assert.deepEqual(placement.steps.at(-1), {
    text: 'DwC stateProvince "Krasnoyarsk Krai" matches the state Krasnoyarsk (ignoring "krai")',
    source: 'manual',
    ref: ignoredRef
  })
  const both = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Sakha' }), rctx)
  assert.equal(both.state, 'Sakha (Yakutia)')
  assert.deepEqual(both.steps.at(-1), {
    text: 'DwC stateProvince "Sakha" matches Sakha Republic, a Natural Earth name of the state Sakha (Yakutia) (ignoring "republic")',
    source: 'manual',
    ref: ignoredRef
  })
})

test('an exact stateProvince wins over coordinates and needs no Natural Earth step', async () => {
  const placement = await placeRecord(specimen({ country: 'Russia', stateProvince: 'Moscow Oblast' }), rctx)
  assert.equal(placement.state, 'Moscow Oblast')
  assert.equal(placement.steps.at(-1).source, 'TaxonWorks')
})

test('a state area matched through an alias, and a parent matched by ignoring words', async () => {
  const moskva = { ...evenk, key: 'GA 900005', id: 900005, name: 'Moskva' }
  const own = await ad(moskva)
  assert.equal(own.state, 'Moscow')
  assert.deepEqual(own.steps.at(-1), { text: 'Moskva (GA 900005) is a Natural Earth name of the state Moscow', source: 'Natural Earth' })
  const district = { ...evenk, key: 'GA 900006', id: 900006, name: 'Some District', level1: 900007, parentId: 900007, parentName: 'Pskov Oblast', origin: 'gadm', type: 'Raion' }
  const parent = await ad(district)
  assert.equal(parent.state, 'Pskov')
  assert.deepEqual(parent.steps.at(-1), {
    text: 'Some District is a subdivision of Pskov Oblast (GA 900007), which matches the state Pskov (ignoring "oblast")',
    source: 'manual',
    ref: ignoredRef
  })
})

test('a TDWG area, which has no levels, is still tried by its own name', async () => {
  // Placed in Russia by the 14RUC country rule; its name, not the 14RUC state rule, gives the state.
  const tdwg = { ...ga(fx.ga33876), key: 'GA 900008', id: 900008, name: 'Krasnoyarsk' }
  const placement = await ad(tdwg)
  assert.equal(placement.state, 'Krasnoyarsk')
  assert.deepEqual(placement.steps.at(-1), { text: 'Krasnoyarsk (TDWG 14RUC) is the state Krasnoyarsk', source: 'TaxonWorks' })
})

test('an area below a county does not take the county name as its state', async () => {
  // Parent GA 29533 is Washington County, Utah; the state (level1) is GA 26581 Utah.
  const town = { ...ga(fx.ga29533), key: 'GA 900009', id: 900009, name: 'Some Town', type: 'Town', parentId: 29533, parentName: 'Washington' }
  const placement = await ad(town)
  assert.equal(placement.checklist.name, 'United States')
  assert.equal(placement.state, null)
  assert.equal(placement.steps.at(-1).text, 'no state: not measured yet')
})
