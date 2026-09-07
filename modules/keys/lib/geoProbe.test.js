import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeParams, probeSig, PRESENCE_PARAMS } from './geoProbe.js'

test('family / subfamily / tribe / genus -> single column', () => {
  assert.deepEqual(probeParams({ rank: 'family', name: 'Curculionidae' }),
    { params: { family: 'Curculionidae' }, sig: 'family=Curculionidae' })
  assert.deepEqual(probeParams({ rank: 'subfamily', name: 'Entiminae' }),
    { params: { subfamily: 'Entiminae' }, sig: 'subfamily=Entiminae' })
  assert.deepEqual(probeParams({ rank: 'tribe', name: 'Otiorhynchini' }),
    { params: { tribe: 'Otiorhynchini' }, sig: 'tribe=Otiorhynchini' })
  assert.deepEqual(probeParams({ rank: 'genus', name: 'Curculio' }),
    { params: { genus: 'Curculio' }, sig: 'genus=Curculio' })
})

test('species -> genus + specificEpithet', () => {
  assert.deepEqual(probeParams({ rank: 'species', name: 'Otiorhynchus sulcatus' }),
    { params: { genus: 'Otiorhynchus', specificEpithet: 'sulcatus' },
      sig: 'genus=Otiorhynchus&specificEpithet=sulcatus' })
})

test('species with a subgenus parenthetical -> parenthetical dropped', () => {
  assert.deepEqual(
    probeParams({ rank: 'species', name: 'Otiorhynchus (Otiorhynchus) sulcatus' }),
    { params: { genus: 'Otiorhynchus', specificEpithet: 'sulcatus' },
      sig: 'genus=Otiorhynchus&specificEpithet=sulcatus' })
})

test('subgenus rank -> inventory fallback (0% flat column on this project)', () => {
  assert.deepEqual(probeParams({ rank: 'subgenus', name: 'Otiorhynchus' }),
    { fallback: 'inventory' })
})

test('rank above family -> inventory fallback', () => {
  assert.deepEqual(probeParams({ rank: 'superfamily', name: 'Curculionoidea' }),
    { fallback: 'inventory' })
})

test('missing / blank name -> inventory fallback', () => {
  assert.deepEqual(probeParams({ rank: 'genus', name: '' }), { fallback: 'inventory' })
  assert.deepEqual(probeParams({ rank: 'genus' }), { fallback: 'inventory' })
})

test('degenerate species name (one token, or genus === epithet) -> fallback', () => {
  assert.deepEqual(probeParams({ rank: 'species', name: 'Curculio' }), { fallback: 'inventory' })
})

test('PRESENCE_PARAMS is the always-added pair', () => {
  assert.deepEqual(PRESENCE_PARAMS, { occurrenceStatus: 'present', per: 1 })
})

test('probeSig is order-independent', () => {
  assert.equal(probeSig({ specificEpithet: 'sulcatus', genus: 'Otiorhynchus' }),
    'genus=Otiorhynchus&specificEpithet=sulcatus')
})
