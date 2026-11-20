import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRules } from './rules.js'
import {
  areaRoot, buildAreaTree, filterTree, isProblem, decisionOf, reasonKind, reasonDetail, unplacedSections, summarizeOtu,
  cachedPlacement, differsFromCache, ruleSections, DECISION_ORDER, splitRefs, sourceTags, afterDecisionSteps, lineLink, plainReason, plainReasons
} from './overview.js'

const placed = (name, steps = [{ text: `x is in ${name}`, source: 'TaxonWorks' }], extra = {}) => ({
  checklist: { key: name.toLowerCase(), name }, part: null, state: null,
  shape: { key: 'GeographicArea/1', name }, reason: null, steps, ...extra
})
const unplaced = (reason, steps = [{ text: `y ${reason}`, source: 'overlap', ref: 'placement.yml:211' }]) => ({
  checklist: null, part: null, state: null, shape: null, reason, steps
})
const row = (key, name, extra = {}) => ({
  key, name, origin: 'gadm', type: 'County', tdwg: null, iso2: null, parentId: null, parentName: null,
  records: 1, placement: placed('France'), ...extra
})
const stub = (key, name) => ({ ...row(key, name), origin: null, type: null, records: 0, placement: null })

// French Guiana as in areas.json of 2026-11-20: GA 32253 (ne_states) under
// France, GA 8837 Cayenne under the stub GA 78, GA 34200 (TDWG L4) under the
// stub GA 33722; Borneo (TDWG L3) not placeable; one gazetteer.
const AREAS = [
  row('GA 77', 'France', { origin: 'country_names_and_code_elements', type: 'Country', parentId: 1 }),
  stub('GA 1', 'Earth'),
  row('GA 32253', 'French Guiana', { origin: 'ne_states', parentId: 77, placement: placed('French Guiana', [{ text: 'GA 32253 French Guiana belongs to the checklist French Guiana', source: 'manual', ref: 'placement.yml:69' }]) }),
  stub('GA 78', 'French Guiana'),
  row('GA 8837', 'Cayenne', { parentId: 78 }),
  stub('GA 33722', 'French Guiana'),
  row('GA 34200', 'French Guiana', { origin: 'tdwg_l4', type: 'TDWG Level 4', parentId: 33722 }),
  row('GA 33639', 'Borneo', { origin: 'tdwg_l3', type: 'TDWG Level 3', parentId: 33574, placement: unplaced('spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%') }),
  stub('GA 33574', 'Malesia'),
  row('GZ 3549', 'Hispaniola', { origin: null, type: null, placement: unplaced('spans several countries: Dominican Republic 66%, Haiti 34%') }),
  row('GA 210', 'Spain', { origin: 'country_names_and_code_elements', type: 'Country', parentId: 1, placement: placed('Spain', [{ text: 'Spain is a country', source: 'TaxonWorks' }, { text: 'no outline cached for Spain', source: 'TaxonWorks' }], { shape: null }) })
]

test('areaRoot: gazetteers by kind, TDWG by origin, the rest political', () => {
  assert.equal(areaRoot(row('GZ 3549', 'Hispaniola', { origin: null })), 'Gazetteers')
  assert.equal(areaRoot(row('GA 34200', 'x', { origin: 'tdwg_l4' })), 'TDWG')
  assert.equal(areaRoot(row('GA 32253', 'x', { origin: 'ne_states' })), 'Political')
  assert.equal(areaRoot(row('GA 9', 'x', { origin: null })), 'Political')
})

test('buildAreaTree: three roots, nested by parentId, stubs in the root of their children', () => {
  const roots = buildAreaTree(AREAS)
  assert.deepEqual(roots.map((root) => root.name), ['Political', 'TDWG', 'Gazetteers'])
  const [political, tdwg, gazetteers] = roots
  assert.deepEqual(political.nodes.map((node) => node.key), ['GA 1', 'GA 78'])
  const earth = political.nodes[0]
  assert.equal(earth.stub, true)
  assert.deepEqual(earth.children.map((node) => node.key), ['GA 77', 'GA 210'])
  assert.deepEqual(earth.children[0].children.map((node) => node.key), ['GA 32253'])
  assert.deepEqual(political.nodes[1].children.map((node) => node.key), ['GA 8837'])
  assert.deepEqual(tdwg.nodes.map((node) => node.key), ['GA 33722', 'GA 33574'])
  assert.deepEqual(tdwg.nodes[1].children.map((node) => node.key), ['GA 33639'])
  assert.deepEqual(gazetteers.nodes.map((node) => node.key), ['ISO none'])
  assert.deepEqual(gazetteers.nodes[0].children.map((node) => node.key), ['GZ 3549'])
  assert.equal(political.count, 4)
  assert.equal(political.problems, 1)
  assert.equal(earth.problems, 1)
})

// Alabama as TaxonWorks gives it: GA 26688 is used by no record, known only as
// the parent (level1) of its counties, whose level0 is GA 237 United States.
// The build compiles `ancestors` (cacheFiles.mjs areaPositions); the tree shows them.
test('buildAreaTree: a stub sits where the build compiled it, Alabama under the United States (R44)', () => {
  const rows = [
    row('GA 237', 'United States', { origin: 'country_names_and_code_elements', type: 'Country', parentId: 1, ancestors: [] }),
    row('GA 30081', 'Clay', { parentId: 26688, ancestors: ['GA 237', 'GA 26688'] }),
    { ...stub('GA 26688', 'Alabama'), ancestors: ['GA 237'] },
    row('GZ 10453', "Hawai'i: Kaua'i", { origin: null, type: null, iso2: 'US', ancestors: [] }),
    row('GZ 10458', 'Australia: Norfolk Island', { origin: null, type: null, iso2: 'AU', ancestors: [] })
  ]
  const [political, , gazetteers] = buildAreaTree(rows)
  assert.deepEqual(political.nodes.map((node) => node.key), ['GA 237'])
  assert.deepEqual(political.nodes[0].children.map((node) => node.key), ['GA 26688'])
  assert.deepEqual(political.nodes[0].children[0].children.map((node) => node.key), ['GA 30081'])
  assert.deepEqual(gazetteers.nodes.map((node) => [node.name, node.children.map((child) => child.key)]),
    [['ISO AU', ['GZ 10458']], ['ISO US', ['GZ 10453']]])
})

test('isProblem: not placeable or no outline; stubs never', () => {
  assert.equal(isProblem(AREAS[0]), false)
  assert.equal(isProblem(AREAS[1]), false)
  assert.equal(isProblem(AREAS[7]), true)
  assert.equal(isProblem(AREAS[10]), true)
})

test('filterTree: name filter keeps matches and their ancestors, opened', () => {
  const roots = filterTree(buildAreaTree(AREAS), { text: 'cayen' })
  assert.deepEqual(roots.map((root) => root.nodes.map((node) => node.key)), [['GA 78'], [], []])
  assert.equal(roots[0].nodes[0].open, true)
  assert.deepEqual(roots[0].nodes[0].children.map((node) => node.key), ['GA 8837'])
})

test('filterTree: problems only, accent insensitive text, and no filter leaves the tree', () => {
  const tree = buildAreaTree(AREAS)
  const problems = filterTree(tree, { problemsOnly: true })
  assert.deepEqual(problems[0].nodes.map((node) => node.key), ['GA 1'])
  assert.deepEqual(problems[0].nodes[0].children.map((node) => node.key), ['GA 210'])
  assert.deepEqual(problems[1].nodes.map((node) => node.key), ['GA 33574'])
  assert.deepEqual(problems[2].nodes[0].children.map((node) => node.key), ['GZ 3549'])
  assert.equal(filterTree(tree, { text: 'BÓRNEO' })[1].nodes[0].children[0].key, 'GA 33639')
  assert.equal(filterTree(tree, {}), tree)
})

test('decisionOf: checklist with part and state, the deciding step tag', () => {
  const cayenne = placed('French Guiana', [
    { text: 'Cayenne is a subdivision of French Guiana (GA 78)', source: 'TaxonWorks' },
    { text: 'French Guiana (GA 78) belongs to the checklist French Guiana', source: 'manual', ref: 'placement.yml:69' }
  ])
  assert.deepEqual(decisionOf(cayenne), { text: 'French Guiana', tag: '[manual, placement.yml:69]', problem: false })
  const corsica = placed('France', [{ text: 'a', source: 'TaxonWorks' }, { text: 'Corse is the part Corsica', source: 'manual', ref: 'placement.yml:159' }], { part: 'Corsica', state: 'X' })
  assert.deepEqual(decisionOf(corsica), { text: 'France, part Corsica, state X', tag: '[TaxonWorks]', problem: false })
  assert.deepEqual(decisionOf(AREAS[7].placement), {
    text: 'not placeable: spans several countries: Indonesia 72%, Malaysia 28%, Brunei 1%', tag: '[overlap, placement.yml:211]', problem: true
  })
  assert.deepEqual(decisionOf(AREAS[10].placement), { text: 'Spain, no outline', tag: '[TaxonWorks]', problem: true })
  assert.equal(decisionOf(null), null)
  assert.deepEqual(decisionOf(unplaced('distribution has no area', [])), { text: 'not placeable: distribution has no area', tag: '', problem: true })
})

test('reasonKind groups the variants of one reason', () => {
  assert.equal(reasonKind('spans several countries: Indonesia 72%, Malaysia 28%'), 'spans several countries')
  assert.equal(reasonKind('no checklist for Kosovo'), 'no checklist for a country')
  assert.equal(reasonKind('coordinates in several countries (Russia, Ukraine)'), 'coordinates in several countries')
  assert.equal(reasonKind('lies on the border of Czech Republic and Poland'), 'lies on the border of Czech Republic and Poland')
  assert.equal(reasonKind('locality text only'), 'locality text only')
})

test('reasonDetail: the shares, names or country of a reason, no kind', () => {
  assert.equal(reasonDetail('spans several countries: Indonesia 51%, Papua New Guinea 49%'), 'Indonesia 51%, Papua New Guinea 49%')
  assert.equal(reasonDetail('coordinates in several countries (Russia, Ukraine)'), 'Russia, Ukraine')
  assert.equal(reasonDetail('no checklist for Kosovo'), 'Kosovo')
  assert.equal(reasonDetail('locality text only'), '')
})

test('unplacedSections: one line per area with its shares and count, GA and GZ mixed, largest first (R53)', () => {
  const sections = unplacedSections({
    'locality text only': [['CO', 1], ['CO', 2, null, 'Germany'], ['FO', 3], ['CO', 4]],
    'spans several countries: Papua New Guinea 51%, Indonesia 49%': [['AD', 10, 'GZ 3614'], ['AD', 13, 'GZ 3614']],
    'spans several countries: Indonesia 51%, Papua New Guinea 49%': [['AD', 11, 'GA 33838'], ['AD', 12, 'GA 33838'], ['AD', 14, 'GA 33838']],
    'no checklist for Kosovo': [['CO', 20, null, 'Kosovo']]
  }, new Map([['GZ 3614', 'New Guinea'], ['GA 33838', 'New Guinea']]))
  assert.deepEqual(sections.map(({ kind, count, areas, countries, locality }) => [kind, count, areas, countries, locality]), [
    ['spans several countries', 5, 2, 0, false],
    ['no checklist for a country', 1, 0, 1, false],
    ['locality text only', 4, 0, 2, true]
  ])
  assert.deepEqual(sections[0].lines.map(({ label, area, detail, count, records }) => [label, area, detail, count, records.map((r) => r.id)]), [
    ['New Guinea', 'GA 33838', 'Indonesia 51%, Papua New Guinea 49%', 3, [11, 12, 14]],
    ['New Guinea', 'GZ 3614', 'Papua New Guinea 51%, Indonesia 49%', 2, [10, 13]]
  ])
  assert.deepEqual(sections[1].lines.map(({ label, detail }) => [label, detail]), [['Kosovo', 'Kosovo']])
})

test('unplacedSections: records without an area grouped by their DwC country, else "no country"', () => {
  const [section] = unplacedSections({ 'coordinates outside every outline': [['CO', 1, null, 'Chile'], ['FO', 2], ['CO', 3, null, 'Chile']] })
  assert.deepEqual(section.lines.map(({ label, country, area, count }) => [label, country, area, count]), [['Chile', 'Chile', null, 2], ['no country', '', null, 1]])
  assert.equal(section.countries, 2)
})

test('splitRefs and sourceTags: rules lines become links, every contributing source once (R43, R46)', () => {
  assert.deepEqual(splitRefs('a [manual, placement.yml:12] b'), [{ text: 'a [manual, ' }, { text: 'placement.yml:12', line: 12 }, { text: '] b' }])
  assert.deepEqual(splitRefs('plain'), [{ text: 'plain' }])
  const placement = placed('Russia', [
    { text: 'x is in Russia', source: 'TaxonWorks' },
    { text: 'y lies in the state Z', source: 'overlap', ref: 'placement.yml:539', pct: 100, pctOf: 'Z' },
    { text: 'z', source: 'TaxonWorks' }
  ])
  assert.deepEqual(sourceTags(placement), ['[TaxonWorks]', '[overlap 100% Z, placement.yml:539]'])
})

test('afterDecisionSteps: part, state (named state countries) and outline', () => {
  const rules = compileRules(readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8'))
  const steps = afterDecisionSteps(rules)
  assert.equal(steps[0].text, 'The part (France only: Corsica or Mainland France).')
  assert.equal(steps[1].text, 'The state or province, only for the checklists browsed by state: United States, Canada, Australia, China and Russia.')
  assert.match(steps[1].ref, /^placement\.yml:\d+$/)
})

test('summarizeOtu: by kind, placed, checklists, not placed by kind, left out', () => {
  const rows = [
    { kind: 'AD', placement: placed('France') }, { kind: 'AD', placement: placed('France') }, { kind: 'CO', placement: placed('Spain') },
    { kind: 'AD', placement: unplaced('spans several countries: A 60%, B 40%') },
    { kind: 'AD', placement: unplaced('spans several countries: C 60%, D 40%') },
    { kind: 'FO', placement: unplaced('locality text only') },
    { kind: 'AD', leftOut: 'absent', placement: placed('Italy') }
  ]
  assert.equal(summarizeOtu(rows), '7 records (5 AD, 1 CO, 1 FO): 3 placed in 2 checklists, 3 not placed (2 spans several countries, 1 locality text only), 1 not in checklists (1 absent)')
  assert.equal(summarizeOtu([{ kind: 'CO', placement: placed('France') }]), '1 record (1 CO): 1 placed in 1 checklist')
  assert.equal(summarizeOtu([]), 'No records.')
})

test('cachedPlacement and differsFromCache', () => {
  const records = [{ dwc_occurrence_object_type: 'AssertedDistribution', dwc_occurrence_object_id: '556796', state: 'X' }]
  const unplacedFile = { 'locality text only': [['CO', 5]] }
  const cache = { checklistName: 'France', records, unplaced: unplacedFile }
  assert.deepEqual(cachedPlacement({ kind: 'AD', id: 556796 }, cache), { checklist: 'France', part: null, state: 'X' })
  assert.deepEqual(cachedPlacement({ kind: 'CO', id: 5 }, cache), { reason: 'locality text only' })
  assert.equal(cachedPlacement({ kind: 'CO', id: 6 }, cache), null)

  const live = placed('France', undefined, { state: 'X' })
  assert.equal(differsFromCache(live, { checklist: 'France', part: null, state: 'X' }), false)
  assert.equal(differsFromCache(live, { checklist: 'France', part: null, state: null }), true)
  assert.equal(differsFromCache(live, { reason: 'not measured yet' }), true)
  assert.equal(differsFromCache(live, null), true)
  assert.equal(differsFromCache(unplaced('not measured yet'), { reason: 'not measured yet' }), false)
  assert.equal(differsFromCache(unplaced('not measured yet'), { checklist: 'France' }), true)
})

test('ruleSections: every rule of the rules file with its ref', () => {
  const rules = compileRules(readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8'))
  const sections = ruleSections(rules)
  assert.deepEqual(sections.map((section) => section.name), [
    'Checklists of their own', 'Synonyms', 'Parts', 'State countries', 'Ignored name words', 'Manual rules', 'Overlap rules'
  ])
  const byName = Object.fromEntries(sections.map((section) => [section.name, section]))
  assert.equal(byName['Overlap rules'].collapsed, true)
  assert.equal(byName['Overlap rules'].rows.length, rules.overlap.length)
  assert.equal(byName['Manual rules'].rows.length, rules.manual.length)
  const guiana = byName['Checklists of their own'].rows.find((row) => row.action.startsWith('checklist French Guiana'))
  assert.match(guiana.ref, /^placement\.yml:\d+$/)
  assert.match(guiana.match, /GA 78/)
  assert.match(byName['State countries'].rows[0].match, /United States/)
  assert.match(byName['Ignored name words'].rows[0].match, /oblast/)
  assert.ok(sections.every((section) => section.rows.every((row) => row.ref && row.match && row.action)))
  const borneo = byName['Overlap rules'].rows.find((row) => row.match === 'TDWG 42BOR')
  assert.equal(borneo.action, 'not placeable: spans several countries')
  assert.match(borneo.why, /^measured Indonesia/)
  assert.equal(DECISION_ORDER.length, 6)
})

test('lineLink: the Rules tab with the route hash #L<N>, the rest of the query kept', () => {
  const to = lineLink({ query: { curator: '1', lookup: 'CO 1383195', line: '5' } })(168)
  assert.deepEqual(to, { query: { curator: '1', lookup: 'CO 1383195', tab: 'rules', line: undefined }, hash: '#L168' })
})

test('plainReason: the deciding step in a few words, with its rules line (R54)', () => {
  const reason = (steps, extra) => plainReason(placed('X', steps, extra))
  assert.deepEqual(reason([{ text: 'Cayman Is. (GA 31732) is a country', source: 'TaxonWorks' }, { text: 'Cayman Is. is a spelling of Cayman Islands', source: 'manual', ref: 'placement.yml:131' }]),
    { text: 'spelling synonym', ref: 'placement.yml:131' })
  assert.deepEqual(reason([{ text: 'Corse is in France (GA 77)', source: 'TaxonWorks' }]), { text: 'GA hierarchy in TaxonWorks (GA 77)', ref: null })
  assert.deepEqual(reason([{ text: 'Spain (GA 210) is a country', source: 'TaxonWorks' }]), { text: 'country area in TaxonWorks', ref: null })
  assert.deepEqual(reason([{ text: 'Auckland has ISO code NZ, New Zealand', source: 'TaxonWorks' }]), { text: 'gazetteer ISO code NZ', ref: null })
  assert.deepEqual(reason([{ text: 'GA 32253 French Guiana belongs to the checklist French Guiana', source: 'manual', ref: 'placement.yml:74' }]),
    { text: 'own checklist entry', ref: 'placement.yml:74' })
  assert.deepEqual(reason([{ text: 'Yakutskiya (TDWG 30YAK) lies in Russia', source: 'overlap', ref: 'placement.yml:240', pct: 100, pctOf: 'Russia' },
    { text: 'no state: not measured yet', source: 'TaxonWorks' }]), { text: 'measured 100% in Russia', ref: 'placement.yml:240' })
  assert.deepEqual(plainReason(unplaced('spans several countries: A 60%, B 40%', [{ text: 'Borneo spans several countries: A 60%, B 40%', source: 'overlap', ref: 'placement.yml:226' }])),
    { text: 'measured: spans several countries', ref: 'placement.yml:226' })
  assert.deepEqual(reason([{ text: 'France (TDWG 12FRA) counts as France, part Mainland France (approximately)', source: 'manual', ref: 'placement.yml:182' }]),
    { text: 'manual rule', ref: 'placement.yml:182' })
  assert.deepEqual(reason([{ text: 'coordinates 44.5, 34.24 lie within about 5 km of the coast of Ukraine', source: 'overlap', ref: 'placement.yml:168' }]),
    { text: 'coordinates near the coast', ref: 'placement.yml:168' })
  assert.equal(plainReason(null), null)
})

test('plainReasons: one reason for each decision, from the step that decided it', () => {
  const reasons = (steps, extra = {}) => plainReasons(placed('X', steps, extra))
  // Primor'ye GA 20330: checklist from the hierarchy, state measured
  assert.deepEqual(reasons([
    { text: "Primor'ye is in Russia (GA 19713)", source: 'TaxonWorks', stage: 'checklist' },
    { text: "Primor'ye (GA 20330) lies in the state Primorsky Krai", source: 'overlap', ref: 'placement.yml:539', pct: 100, pctOf: 'Primorsky Krai', stage: 'state' }
  ], { state: 'Primorsky Krai' }), {
    checklist: { text: 'GA hierarchy in TaxonWorks (GA 19713)', ref: null },
    part: null,
    state: { text: 'measured 100% in Primorsky Krai', ref: 'placement.yml:539' }
  })
  // an Alabama county: state through the parent
  assert.deepEqual(reasons([
    { text: 'Clay is in United States (GA 237)', source: 'TaxonWorks', stage: 'checklist' },
    { text: 'Clay is a subdivision of Alabama (GA 26688), the state Alabama', source: 'TaxonWorks', stage: 'state' }
  ], { state: 'Alabama' }).state, { text: 'GA hierarchy in TaxonWorks (GA 26688)', ref: null })
  // Alabama itself: its own name is a state in TaxonWorks
  assert.deepEqual(reasons([
    { text: 'Alabama is in United States (GA 33412)', source: 'TaxonWorks', stage: 'checklist' },
    { text: 'Alabama (GA 33455) is the state Alabama', source: 'TaxonWorks', stage: 'state' }
  ], { state: 'Alabama' }).state, { text: 'the area is this state in TaxonWorks', ref: null })
  // a manual state rule, and a name matched after ignoring words
  assert.deepEqual(reasons([
    { text: 'Chukot (GA 20379) counts as the state Chukotka', source: 'manual', ref: 'placement.yml:600', stage: 'state' }
  ], { state: 'Chukotka' }).state, { text: 'manual rule', ref: 'placement.yml:600' })
  assert.deepEqual(reasons([
    { text: 'Tuva (GA 19977) matches the state Tuva (ignoring "republic")', source: 'manual', ref: 'placement.yml:30', stage: 'state' }
  ], { state: 'Tuva' }).state, { text: 'name matches after ignoring words', ref: 'placement.yml:30' })
  // Corse GA 32254: the part by a manual entry; no state
  assert.deepEqual(reasons([
    { text: 'Corse is in France (GA 77)', source: 'TaxonWorks', stage: 'checklist' },
    { text: 'Corse (GA 32254) belongs to the part Corsica', source: 'manual', ref: 'placement.yml:172', stage: 'part' }
  ], { part: 'Corsica' }), {
    checklist: { text: 'GA hierarchy in TaxonWorks (GA 77)', ref: null },
    part: { text: 'manual entry', ref: 'placement.yml:172' },
    state: null
  })
  // the rest part
  assert.deepEqual(reasons([
    { text: 'Aquitaine is in France (GA 77)', source: 'TaxonWorks', stage: 'checklist' },
    { text: 'Aquitaine (GA 32220) is below country level, so it goes to the part Mainland France', source: 'manual', ref: 'placement.yml:175', stage: 'part' }
  ], { part: 'Mainland France' }).part, { text: 'rest of the country', ref: 'placement.yml:175' })
  // a TDWG area measured for its country, and its part named by the same rule
  assert.deepEqual(reasons([
    { text: 'Portugal (TDWG 12POR) lies in Portugal', source: 'overlap', ref: 'placement.yml:211', pct: 99, pctOf: 'Portugal', stage: 'checklist' }
  ]).checklist, { text: 'measured 99% in Portugal', ref: 'placement.yml:211' })
  assert.deepEqual(reasons([
    { text: 'France (TDWG 12FRA) counts as France, part Mainland France', source: 'manual', ref: 'placement.yml:182', stage: 'checklist', decidesPart: true }
  ], { part: 'Mainland France' }).part, { text: 'manual rule', ref: 'placement.yml:182' })
  // Tierra del Fuego GA 2588: no state, no part, so no reason for either
  assert.deepEqual(reasons([{ text: 'Tierra del Fuego is in Argentina (GA 12)', source: 'TaxonWorks', stage: 'checklist' }]), {
    checklist: { text: 'GA hierarchy in TaxonWorks (GA 12)', ref: null }, part: null, state: null
  })
  // steps of an older cache have no stage: no reason rather than a guess
  assert.deepEqual(reasons([
    { text: 'Corse is in France (GA 77)', source: 'TaxonWorks' },
    { text: 'Corse (GA 32254) belongs to the part Corsica', source: 'manual', ref: 'placement.yml:172' }
  ], { part: 'Corsica' }).part, null)
  // not placed or no placement: nothing
  assert.deepEqual(plainReasons(unplaced('no outline')), { checklist: null, part: null, state: null })
  assert.deepEqual(plainReasons(null), { checklist: null, part: null, state: null })
})
