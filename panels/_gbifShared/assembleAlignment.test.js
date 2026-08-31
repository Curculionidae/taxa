import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAlignmentModel } from './assembleAlignment.js'
import { fetchChecklistConcept } from './gbifChecklistConcept.js'
import { matchKey } from './gbifNameMatch.js'

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)))

function stubFetch(routes) {
  return async (url) => {
    const u = String(url)
    for (const [needle, body] of routes) {
      if (u.includes(needle)) return { ok: true, status: 200, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

test('Larinus latus assembles to an overlap with the expected zones', async () => {
  const rawNodes = fx('tw-larinus-latus-nodes')
  const twNodes = rawNodes.map((n) => ({
    ...n,
    short: n.short,
    matchKey: matchKey(n.name.replace(/\s*\(.*/, '').trim(), { author: n.authorYear })
  }))

  const colConcept = await fetchChecklistConcept('Larinus latus', twNodes, {
    checklistKey: '7ddf754f-d193-4cc9-b351-99906754a03b',
    fetchImpl: stubFetch([
      ['/v1/species?datasetKey', fx('col-larinus-latus-search')],
      ['/v1/species/297459661/synonyms', fx('col-larinus-latus-synonyms')],
      ['/v1/species/297459661', fx('col-larinus-latus-species')]
    ])
  })

  const facet = fx('gbif-facet-larinus-latus')
  const facetCounts =
    facet.facets?.[0]?.counts?.map((c) => ({ name: c.name, count: c.count })) || []

  const model = buildAlignmentModel({
    twName: 'Larinus latus',
    colAcceptedName: colConcept.accepted.name,
    twAcceptedIsColSynonym: false,
    twNodes,
    colConcept,
    facetCounts,
    summaryCounts: { total: 1593, withImage: 766, withCoordinate: 1187 },
    matchDiagnostics: { acceptedMatchType: 'EXACT', acceptedIsSynonymChain: false },
    urls: {}
  })

  assert.equal(model.relation.kind, 'overlap')
  assert.equal(model.relation.symbol, '><')
  assert.equal(model.relation.sharedCount, 4)

  const consensusNames = model.zones.consensus.map((n) => n.short)
  assert.ok(consensusNames.some((n) => n.includes('mutabilis')), 'mutabilis (Host 1789 vs 1790) must be consensus, not a divergence')

  const foldsIn = model.zones.colFoldsIn.map((n) => n.short)
  assert.ok(foldsIn.some((n) => n.toLowerCase().includes('cardui')))
  assert.ok(!foldsIn.some((n) => n.includes('mutabilis')))

  const keepsIn = model.zones.twKeepsIn.map((n) => n.short)
  assert.ok(keepsIn.includes('Larinus subcostatus'))
  assert.ok(keepsIn.includes('Larinus costirostris'))
  assert.ok(keepsIn.includes('Larinus teretirostris'))
  assert.ok(!keepsIn.some((n) => n.includes('mutabilis')))

  // Curculio cardui, Lixus cardui and Rhinobatus cardui are one nomenclatural
  // entity written in three genera. They must collapse to a single folded row
  // carrying the summed GBIF tally once, not three rows of 931 each.
  const carduiRows = model.zones.colFoldsIn.filter((n) =>
    n.short.toLowerCase().includes('cardui')
  )
  assert.equal(carduiRows.length, 1)

  const cardui = carduiRows[0]
  assert.equal(cardui.records, 931)

  assert.ok(Array.isArray(cardui.otherCombinations))
  assert.ok(cardui.otherCombinations.length > 0)
  const carduiSpellings = [cardui.name, ...cardui.otherCombinations]
  assert.ok(carduiSpellings.some((s) => s.includes('Curculio cardui')))
  assert.ok(carduiSpellings.some((s) => s.includes('Lixus cardui')))
  assert.ok(carduiSpellings.some((s) => s.includes('Rhinobatus cardui')))

  // cardui, pollinosus and longirostris only: the genus recombinations of
  // cardui no longer inflate the zone to 5+ rows.
  assert.ok(model.zones.colFoldsIn.length <= 4)

  assert.ok(model.zones.inDataOnly.some((r) => r.name.startsWith('BOLD:')))
  assert.equal(model.relation.intAssessed, false)
})

test('colConcept null yields a none relation and null gbif, no throw', () => {
  const twNodes = [
    {
      name: 'Foo bar (Smith, 1900)',
      short: 'Foo bar',
      authorYear: '(Smith, 1900)',
      originalCombination: null,
      role: 'accepted',
      colMatched: false,
      matchKey: matchKey('Foo bar', { author: '(Smith, 1900)' })
    }
  ]
  const model = buildAlignmentModel({
    twName: 'Foo bar',
    colAcceptedName: 'Foo bar',
    twAcceptedIsColSynonym: false,
    twNodes,
    colConcept: null,
    facetCounts: [],
    summaryCounts: {},
    matchDiagnostics: {},
    urls: {}
  })
  assert.equal(model.relation.kind, 'none')
  assert.equal(model.gbif, null)
  assert.equal(model.zones.consensus.length, 0)
})

test('Ceutorhynchus pervicax assembles to a congruent concept', async () => {
  const rawNodes = fx('tw-pervicax-nodes')
  const twNodes = rawNodes.map((n) => ({
    ...n,
    short: n.short,
    matchKey: matchKey(n.name.replace(/\s*\(.*/, '').trim(), { author: n.authorYear })
  }))

  const colConcept = await fetchChecklistConcept('Ceutorhynchus pervicax', twNodes, {
    checklistKey: '7ddf754f-d193-4cc9-b351-99906754a03b',
    fetchImpl: stubFetch([
      ['/v1/species?datasetKey', fx('col-pervicax-search')],
      ['/v1/species/291434058/synonyms', fx('col-pervicax-synonyms')],
      ['/v1/species/291434058', fx('col-pervicax-species')]
    ])
  })

  const facet = fx('gbif-facet-pervicax')
  const facetCounts =
    facet.facets?.[0]?.counts?.map((c) => ({ name: c.name, count: c.count })) || []

  const model = buildAlignmentModel({
    twName: 'Ceutorhynchus pervicax',
    colAcceptedName: colConcept.accepted.name,
    twAcceptedIsColSynonym: false,
    twNodes,
    colConcept,
    facetCounts,
    summaryCounts: { total: 336, withImage: 2, withCoordinate: 199 },
    matchDiagnostics: { acceptedMatchType: 'EXACT', acceptedIsSynonymChain: false },
    urls: {}
  })

  assert.equal(model.relation.kind, 'congruent')
  assert.equal(model.relation.symbol, '≡')
  assert.equal(model.zones.twKeepsIn.length, 0)
  assert.equal(model.zones.colFoldsIn.length, 0)
  assert.equal(model.relation.sharedCount, model.zones.consensus.length)
  assert.equal(model.relation.reconciliation.adds.length, 0)
  assert.equal(model.relation.reconciliation.drops.length, 0)

  // the one shared name carries its GBIF record tally, and the BOLD bins stay
  // in the data only zone rather than being read as a divergence
  const shared = model.zones.consensus[0]
  assert.equal(shared.short, 'Ceutorhynchus pervicax')
  assert.equal(shared.records, 331)
  assert.ok(model.zones.inDataOnly.every((r) => r.name.startsWith('BOLD:')))
})

test('Pseudeuparius centromaculatus assembles to an included concept', async () => {
  const rawNodes = fx('tw-centromaculatus-nodes')
  const twNodes = rawNodes.map((n) => ({
    ...n,
    short: n.short,
    matchKey: matchKey(n.name.replace(/\s*\(.*/, '').trim(), { author: n.authorYear })
  }))

  const colConcept = await fetchChecklistConcept(
    'Pseudeuparius centromaculatus',
    twNodes,
    {
      checklistKey: '7ddf754f-d193-4cc9-b351-99906754a03b',
      fetchImpl: stubFetch([
        ['/v1/species?datasetKey', fx('col-centromaculatus-search')],
        ['/v1/species/297482975/synonyms', fx('col-centromaculatus-synonyms')],
        ['/v1/species/297482975', fx('col-centromaculatus-species')]
      ])
    }
  )

  const facet = fx('gbif-facet-centromaculatus')
  const facetCounts =
    facet.facets?.[0]?.counts?.map((c) => ({ name: c.name, count: c.count })) || []

  const model = buildAlignmentModel({
    twName: 'Pseudeuparius centromaculatus',
    colAcceptedName: colConcept.accepted.name,
    twAcceptedIsColSynonym: false,
    twNodes,
    colConcept,
    facetCounts,
    summaryCounts: { total: 53, withImage: 6, withCoordinate: 49 },
    matchDiagnostics: { acceptedMatchType: 'EXACT', acceptedIsSynonymChain: false },
    urls: {}
  })

  assert.equal(model.relation.kind, 'included')
  assert.equal(model.relation.symbol, '⊂')
  assert.equal(model.zones.twKeepsIn.length, 0)
  assert.ok(model.zones.colFoldsIn.length >= 1)
  assert.equal(model.relation.reconciliation.drops.length, 0)
  assert.ok(model.relation.reconciliation.adds.length >= 1)

  // the two Catalogue of Life extras (ceroderes, targionii), each present as a
  // pair of genus recombinations, collapse to two folded names
  assert.equal(model.zones.colFoldsIn.length, 2)
  const folded = model.zones.colFoldsIn.map((n) => n.short.toLowerCase())
  assert.ok(folded.some((n) => n.includes('ceroderes')))
  assert.ok(folded.some((n) => n.includes('targionii')))
  assert.ok(
    model.zones.colFoldsIn.every((n) => n.otherCombinations.length === 1),
    'each folded name keeps its alternate genus spelling'
  )
})
