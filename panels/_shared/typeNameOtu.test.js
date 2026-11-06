import { test } from 'node:test'
import assert from 'node:assert/strict'

import { typeStatusName, findTypeNameOtuId } from './typeNameOtu.js'

// a fake axios-like `get` over a { path: data } table; params are matched too
function fakeGet(routes) {
  const calls = []
  const get = async (path, config = {}) => {
    const key = `${path}?${new URLSearchParams(config.params || {})}`
    calls.push(key)
    const hit = Object.keys(routes).find((k) => key.startsWith(k))
    if (!hit) throw new Error(`404 ${key}`)
    return { data: routes[hit] }
  }
  return { get, calls }
}

const meridionalis = {
  id: 833931,
  cached_original_combination: 'Bothynoderes meridionalis',
  cached_author_year: '(Chevrolat, 1873)'
}
const otherMeridionalis = {
  id: 834352,
  cached_original_combination: 'Larinus meridionalis',
  cached_author_year: 'Rosenhauer, 1856'
}

test('typeStatusName: the name after the last " of ", split into name, author and epithet', () => {
  assert.deepEqual(typeStatusName('syntypes of Bothynoderes meridionalis Chevrolat, 1873'), {
    name: 'Bothynoderes meridionalis',
    author: 'Chevrolat, 1873',
    epithet: 'meridionalis'
  })
  assert.deepEqual(
    typeStatusName('syntypes of Bothynoderes (Bothynoderes) crotchi var. napoleonis Reitter, 1905'),
    {
      name: 'Bothynoderes (Bothynoderes) crotchi var. napoleonis',
      author: 'Reitter, 1905',
      epithet: 'napoleonis'
    }
  )
})

test('typeStatusName: null for a status that names no taxon', () => {
  assert.equal(typeStatusName('paratype'), null)
  assert.equal(typeStatusName(''), null)
})

test('findTypeNameOtuId: the OTU of the name whose original combination and author match', async () => {
  const { get } = fakeGet({
    '/taxon_names?name=meridionalis': [otherMeridionalis, meridionalis],
    '/otus?taxon_name_id%5B%5D=833931': [{ id: 732705, name: null }]
  })
  assert.equal(
    await findTypeNameOtuId('syntypes of Bothynoderes meridionalis Chevrolat, 1873', { get }),
    732705
  )
})

test('findTypeNameOtuId: null when no name, or more than one, matches', async () => {
  const twin = { ...meridionalis, id: 999 }
  const { get } = fakeGet({ '/taxon_names?name=meridionalis': [meridionalis, twin] })
  assert.equal(
    await findTypeNameOtuId('syntypes of Bothynoderes meridionalis Chevrolat, 1873', { get }),
    null
  )
  const none = fakeGet({ '/taxon_names?name=meridionalis': [otherMeridionalis] })
  assert.equal(
    await findTypeNameOtuId('syntypes of Bothynoderes meridionalis Chevrolat, 1873', { get: none.get }),
    null
  )
})

test('findTypeNameOtuId: null on a failed request or a name without an OTU, never throws', async () => {
  assert.equal(await findTypeNameOtuId('holotype of Aus bus Smith, 1900', { get: fakeGet({}).get }), null)
  const { get } = fakeGet({
    '/taxon_names?name=meridionalis': [meridionalis],
    '/otus?taxon_name_id%5B%5D=833931': []
  })
  assert.equal(
    await findTypeNameOtuId('syntypes of Bothynoderes meridionalis Chevrolat, 1873', { get }),
    null
  )
})
