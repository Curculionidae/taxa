import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  typeMaterialsOf,
  specimenByTypeMaterialId,
  fetchTypeSpecimens,
  loadTypeSpecimens
} from './typeMaterialSpecimen.js'

const co = (id, ...typeMaterialIds) => ({
  id,
  type_material: typeMaterialIds.map((tm) => ({
    global_id: `gid://taxon-works/TypeMaterial/${tm}`,
    object_label: `holotype of Name ${tm}`
  }))
})

// a fake `get` over a { path prefix: data } table that records what was asked for
function fakeGet(routes) {
  const calls = []
  const get = async (path) => {
    calls.push(path)
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path.startsWith(k))
    if (!key) throw new Error(`404 ${path}`)
    return { data: routes[key] }
  }
  return { get, calls }
}

test('typeMaterialsOf: reads id and label out of the type_material entries', () => {
  assert.deepEqual(typeMaterialsOf(co(1, 245733, 9)), [
    { id: 245733, label: 'holotype of Name 245733' },
    { id: 9, label: 'holotype of Name 9' }
  ])
})

test('typeMaterialsOf: no / malformed type_material -> empty', () => {
  assert.deepEqual(typeMaterialsOf({ id: 1 }), [])
  assert.deepEqual(typeMaterialsOf(null), [])
  assert.deepEqual(typeMaterialsOf({ type_material: [{ global_id: 'gid://taxon-works/Otu/5' }, {}] }), [])
})

test('fetchTypeSpecimens: types of the valid name and of its synonyms', async () => {
  const { get } = fakeGet({
    '/otus/10': { id: 10, taxon_name_id: 77 },
    '/taxon_names?taxon_name_id[]=77&synonymify=true': [{ id: 77 }, { id: 78 }, { id: 79 }],
    '/collection_objects?type_specimen_taxon_name_id=77&': [{ id: 501 }],
    '/collection_objects?type_specimen_taxon_name_id=78&': [{ id: 502 }],
    '/collection_objects?type_specimen_taxon_name_id=79&': [],
    '/collection_objects/501': co(501, 245733),
    '/collection_objects/502': co(502, 245734)
  })
  const specimens = await fetchTypeSpecimens(10, { get })
  assert.deepEqual(specimens.map((s) => s.collectionObjectId), [501, 502])
  const byTm = specimenByTypeMaterialId(specimens)
  assert.equal(byTm.get(245733), 501)
  assert.equal(byTm.get(245734), 502)
})

test('fetchTypeSpecimens: a failed synonym lookup still resolves the own name', async () => {
  const { get } = fakeGet({
    '/otus/10': { id: 10, taxon_name_id: 77 },
    '/collection_objects?type_specimen_taxon_name_id=77&': [{ id: 501 }],
    '/collection_objects/501': co(501, 245733)
  })
  const specimens = await fetchTypeSpecimens(10, { get })
  assert.deepEqual(specimens.map((s) => s.collectionObjectId), [501])
})

test('fetchTypeSpecimens: an OTU without a taxon name asks for nothing more', async () => {
  const { get, calls } = fakeGet({ '/otus/10': { id: 10, taxon_name_id: null } })
  assert.deepEqual(await fetchTypeSpecimens(10, { get }), [])
  assert.equal(calls.length, 1)
})

test('fetchTypeSpecimens: a failing specimen lookup only drops that specimen', async () => {
  const { get } = fakeGet({
    '/otus/10': { id: 10, taxon_name_id: 77 },
    '/taxon_names?': [{ id: 77 }],
    '/collection_objects?type_specimen_taxon_name_id=77&': [{ id: 501 }, { id: 502 }],
    '/collection_objects/502': co(502, 245734)
  })
  const specimens = await fetchTypeSpecimens(10, { get })
  assert.deepEqual(specimens.map((s) => s.collectionObjectId), [502])
})

test('loadTypeSpecimens: complete only when every request succeeded', async () => {
  const routes = {
    '/otus/10': { id: 10, taxon_name_id: 77 },
    '/taxon_names?': [{ id: 77 }],
    '/collection_objects?type_specimen_taxon_name_id=77&': [{ id: 501 }, { id: 502 }],
    '/collection_objects/501': co(501, 245733),
    '/collection_objects/502': co(502, 245734)
  }
  assert.equal((await loadTypeSpecimens(10, fakeGet(routes).get)).complete, true)
  delete routes['/collection_objects/501']
  const partial = await loadTypeSpecimens(10, fakeGet(routes).get)
  assert.equal(partial.complete, false)
  assert.deepEqual(partial.specimens.map((s) => s.collectionObjectId), [502])
  assert.equal((await loadTypeSpecimens(10, fakeGet({}).get)).complete, false)
})

test('fetchTypeSpecimens: never throws', async () => {
  const { get } = fakeGet({})
  assert.deepEqual(await fetchTypeSpecimens(10, { get }), [])
})
