import { test } from 'node:test'
import assert from 'node:assert/strict'

import { loadSummaryIndexes, loadOtuScopeMembership } from './loadStandardAssociations.js'

// A fake axios-like api that records every request as one string (path plus
// query string plus params) and answers one page of `rows`.
function fakeApi(rows = []) {
  const calls = []
  const get = async (url, config = {}) => {
    const params = new URLSearchParams()
    Object.entries(config.params || {}).forEach(([k, v]) => params.append(k, String(v)))
    calls.push(`${url}${params.size ? (url.includes('?') ? '&' : '?') + params : ''}`)
    return { data: rows, headers: {} }
  }
  return { api: { get }, calls }
}

test('loadSummaryIndexes: the taxon query adds coordinate OTUs by default', async () => {
  const { api, calls } = fakeApi([])
  await loadSummaryIndexes(77, api)
  assert.equal(calls.filter((c) => c.includes('coordinatify')).length, 1)
})

test('loadSummaryIndexes: coordinatify false asks for the name\'s own associations only', async () => {
  const { api, calls } = fakeApi([])
  await loadSummaryIndexes(77, api, undefined, undefined, undefined, { coordinatify: false })
  assert.equal(calls.length, 3)
  assert.equal(calls.filter((c) => c.includes('coordinatify')).length, 0)
  assert.ok(calls.some((c) => c.includes('otu_query%5Btaxon_name_id%5D%5B%5D=77')))
})

test('loadOtuScopeMembership: coordinatify false leaves it off the /otus scope check', async () => {
  const { api, calls } = fakeApi([{ id: 5 }])
  const inScope = await loadOtuScopeMembership([5, 6], 77, api, undefined, [10], { coordinatify: false })
  assert.deepEqual(inScope, new Set(['5']))
  assert.ok(calls.length >= 1)
  assert.ok(calls.every((c) => !c.includes('coordinatify')))
})

test('loadOtuScopeMembership: coordinate OTUs are included by default', async () => {
  const { api, calls } = fakeApi([{ id: 5 }])
  await loadOtuScopeMembership([5], 77, api, undefined, [10])
  assert.ok(calls[0].includes('coordinatify=true'))
})
