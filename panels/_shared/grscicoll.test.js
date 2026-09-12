import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveInstitutionName, getCachedInstitutionName, resolveCollectionName } from './grscicoll.js'

function stubFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return () => { globalThis.fetch = original }
}

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body }
}

test('resolveInstitutionName: resolves by identifier when unambiguous', async () => {
  const calls = []
  const restore = stubFetch(async (url) => {
    calls.push(url)
    return jsonResponse({ results: [{ name: 'Zoologisches Institut' }] })
  })
  try {
    const name = await resolveInstitutionName('ZMUH-TEST-1', 'http://grbio.org/institution/x1')
    assert.equal(name, 'Zoologisches Institut')
    assert.equal(calls.length, 1)
    assert.ok(calls[0].includes('identifier='))
  } finally {
    restore()
  }
})

test('resolveInstitutionName: falls back to code search when identifier search is ambiguous', async () => {
  let call = 0
  const restore = stubFetch(async () => {
    call++
    if (call === 1) return jsonResponse({ results: [] }) // identifier search: no match
    return jsonResponse({ results: [{ name: 'Swedish Museum of Natural History' }] })
  })
  try {
    const name = await resolveInstitutionName('NHRS-TEST-2', 'http://grbio.org/institution/x2')
    assert.equal(name, 'Swedish Museum of Natural History')
    assert.equal(call, 2)
  } finally {
    restore()
  }
})

test('resolveInstitutionName: caches result, second call makes no new request', async () => {
  let calls = 0
  const restore = stubFetch(async () => {
    calls++
    return jsonResponse({ results: [{ name: 'Cached Museum' }] })
  })
  try {
    await resolveInstitutionName('CACHE-TEST-3', 'http://grbio.org/institution/x3')
    const again = await resolveInstitutionName('CACHE-TEST-3', 'http://grbio.org/institution/x3')
    assert.equal(again, 'Cached Museum')
    assert.equal(calls, 1)
  } finally {
    restore()
  }
})

test('resolveInstitutionName: null code -> null, no request', async () => {
  const restore = stubFetch(async () => { throw new Error('should not be called') })
  try {
    assert.equal(await resolveInstitutionName(null), null)
  } finally {
    restore()
  }
})

test('getCachedInstitutionName: reads what resolveInstitutionName already cached', async () => {
  const restore = stubFetch(async () => jsonResponse({ results: [{ name: 'Sync Museum' }] }))
  try {
    assert.equal(getCachedInstitutionName('SYNC-TEST-4'), undefined)
    await resolveInstitutionName('SYNC-TEST-4', 'http://grbio.org/institution/x4')
    assert.equal(getCachedInstitutionName('SYNC-TEST-4'), 'Sync Museum')
  } finally {
    restore()
  }
})

test('resolveCollectionName: caches by institutionCode+code pair', async () => {
  let calls = 0
  const restore = stubFetch(async () => {
    calls++
    return jsonResponse({ results: [{ name: 'Department of Entomology' }] })
  })
  try {
    const name = await resolveCollectionName('COLL-TEST-5', 'INST-TEST-5')
    assert.equal(name, 'Department of Entomology')
    const again = await resolveCollectionName('COLL-TEST-5', 'INST-TEST-5')
    assert.equal(again, 'Department of Entomology')
    assert.equal(calls, 1)
  } finally {
    restore()
  }
})
