import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchTwSynonymRows,
  fetchTwSynonymNames,
  synonymNameStrings
} from './twSynonymNames.js'

// Live rows for Himatium errans (taxon name 1631990), 2026-10-12.
const ERRANS = 1631990
const errans = { id: ERRANS, cached: 'Himatium errans', cached_valid_taxon_name_id: ERRANS }
const parvula = { id: 1632003, cached: 'Himatium errans parvula', cached_valid_taxon_name_id: ERRANS }
const nigritulum = { id: 1632029, cached: 'Himatium nigritulum', cached_valid_taxon_name_id: ERRANS }
// Carries a Synonym::Subjective relationship to errans AND a Valid status, so
// TaxonWorks keeps it valid. It must never count as a synonym of errans.
const conicum = { id: 1631956, cached: 'Himatium conicum', cached_valid_taxon_name_id: 1631956 }

const stub = (rows, calls = []) => async (url, config) => {
  calls.push({ url, config })
  return { data: rows }
}

test('asks TaxonWorks for the synonymified name set', async () => {
  const calls = []
  await fetchTwSynonymRows(101, { request: stub([], calls) })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/taxon_names')
  assert.equal(calls[0].config.params['taxon_name_id[]'], 101)
  assert.equal(calls[0].config.params.synonymify, true)
})

test('returns the synonyms without the taxon itself', async () => {
  const rows = await fetchTwSynonymRows(ERRANS, {
    request: stub([errans, parvula, nigritulum])
  })
  assert.deepEqual(synonymNameStrings(rows), [
    'Himatium errans parvula',
    'Himatium nigritulum'
  ])
})

test('drops a row whose valid name is another taxon (reinstated name)', async () => {
  const rows = await fetchTwSynonymRows(102, {
    request: stub([
      { ...errans, id: 102, cached_valid_taxon_name_id: 102 },
      { ...parvula, cached_valid_taxon_name_id: 102 },
      conicum
    ])
  })
  assert.deepEqual(synonymNameStrings(rows), ['Himatium errans parvula'])
})

test('a string taxon id still excludes the taxon itself', async () => {
  const rows = await fetchTwSynonymRows('103', {
    request: stub([
      { id: 103, cached: 'Aus bus', cached_valid_taxon_name_id: 103 },
      { id: 9, cached: 'Aus cus', cached_valid_taxon_name_id: 103 }
    ])
  })
  assert.deepEqual(synonymNameStrings(rows), ['Aus cus'])
})

test('memoises a success, never a failure', async () => {
  let n = 0
  const flaky = async () => {
    n++
    if (n === 1) throw new Error('network')
    return { data: [{ id: 9, cached: 'Aus cus', cached_valid_taxon_name_id: 104 }] }
  }
  await assert.rejects(fetchTwSynonymRows(104, { request: flaky }))
  assert.deepEqual(await fetchTwSynonymNames(104, { request: flaky }), ['Aus cus'])
  await fetchTwSynonymRows(104, { request: flaky })
  assert.equal(n, 2)
})

test('fetchTwSynonymNames returns [] on failure and for no id', async () => {
  const failing = async () => {
    throw new Error('network')
  }
  assert.deepEqual(await fetchTwSynonymNames(105, { request: failing }), [])
  assert.deepEqual(await fetchTwSynonymNames(null), [])
})
