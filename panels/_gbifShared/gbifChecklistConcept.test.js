import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchChecklistConcept } from './gbifChecklistConcept.js'
import { matchKey } from './gbifNameMatch.js'

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)))

function stubFetch(routes) {
  return async (url) => {
    const u = String(url)
    for (const [needle, body] of routes) {
      if (u.includes(needle)) {
        return { ok: true, status: 200, json: async () => body }
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

const CL = '7ddf754f-d193-4cc9-b351-99906754a03b'

const twNodes = [
  {
    name: 'Larinus latus',
    authorYear: '(Herbst, 1783)',
    originalCombination: 'Curculio latus Herbst, 1783',
    matchKey: matchKey('Larinus latus', { author: '(Herbst, 1783)' })
  }
]

test('resolves the integer key, returns accepted usage and split synonyms', async () => {
  const fetchImpl = stubFetch([
    ['/v1/species?datasetKey', fx('col-larinus-latus-search')],
    ['/v1/species/297459661/synonyms', fx('col-larinus-latus-synonyms')],
    ['/v1/species/297459661', fx('col-larinus-latus-species')]
  ])

  const c = await fetchChecklistConcept('Larinus latus', twNodes, {
    checklistKey: CL,
    fetchImpl
  })

  assert.equal(c.accepted.alphaKey, '6NXFP')
  assert.equal(c.accepted.intKey, 297459661)
  assert.equal(c.accepted.name.startsWith('Larinus latus'), true)

  const names = c.synonyms.map((s) => s.name)
  assert.ok(names.some((n) => n.startsWith('Lixus cardui')))
  assert.ok(!names.some((n) => n.startsWith('Lixus cynarae'))) // misapplied is split off
  assert.equal(c.misapplied.length, 1)

  const curculioLatus = c.synonyms.find((s) => s.name.startsWith('Curculio latus'))
  assert.equal(curculioLatus.matchTier, 'homotypic') // TW original combination

  // a non-basionym synonym must be graded on its own name, never inheriting
  // the concept-wide basionym match
  const lixusCardui = c.synonyms.find((s) => s.name.startsWith('Lixus cardui'))
  assert.notEqual(lixusCardui.matchTier, 'homotypic')
})

test('returns null when the species search fetch throws', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/v1/species?datasetKey')) {
      throw new Error('network')
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  const c = await fetchChecklistConcept('Larinus throwtest', twNodes, {
    checklistKey: CL,
    fetchImpl
  })
  assert.equal(c, null)
})

test('returns null when the species search finds nothing', async () => {
  const fetchImpl = stubFetch([['/v1/species?datasetKey', { results: [] }]])
  const c = await fetchChecklistConcept('Nonexistus nullus', twNodes, {
    checklistKey: CL,
    fetchImpl
  })
  assert.equal(c, null)
})
