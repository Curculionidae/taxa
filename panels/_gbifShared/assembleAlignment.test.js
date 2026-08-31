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

  const cardui = model.zones.colFoldsIn.find((n) => n.short.toLowerCase().includes('cardui'))
  assert.equal(cardui.records, 931)

  assert.ok(model.zones.inDataOnly.some((r) => r.name.startsWith('BOLD:')))
  assert.equal(model.relation.intAssessed, false)
})
