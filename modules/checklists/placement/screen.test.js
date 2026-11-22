import { test } from 'node:test'
import assert from 'node:assert/strict'
import { screenRecord, classificationFromParents } from './screen.js'

const row = (fields) => ({ taxonRank: 'species', otu_id: '7', scientificName: 'Aus bus X, 1900', superfamily: 'Curculionoidea', ...fields })

test('screenRecord: the reasons the checklists leave a record out, in order', () => {
  assert.deepEqual(screenRecord(row({ taxonRank: 'genus' })), { left: 'rank genus' })
  assert.deepEqual(screenRecord(row({ taxonRank: '' })), { left: 'rank none' })
  assert.deepEqual(screenRecord(row({ otu_id: '' })), { left: 'no OTU' })
  assert.deepEqual(screenRecord(row({ occurrenceStatus: 'Absent' })), { left: 'recorded as absent' })
  assert.deepEqual(screenRecord(row({ superfamily: 'Chrysomeloidea' })), { left: 'not in Curculionoidea (Chrysomeloidea)' })
  assert.deepEqual(screenRecord(row({}), { distributionAbsent: true }), { left: 'distribution is absent' })
})

test('screenRecord: a row without superfamily takes its OTU parents; a failed lookup is not left out', () => {
  const parents = classificationFromParents(['Root', 'Curculionoidea', 'Curculionidae', 'Entiminae'])
  assert.deepEqual(parents, { superfamily: 'Curculionoidea', family: 'Curculionidae', subfamily: 'Entiminae' })
  const ok = screenRecord(row({ superfamily: '' }), { parentClassification: parents })
  assert.equal(ok.classification.family, 'Curculionidae')
  assert.equal(ok.classification.genus, 'Aus')
  assert.equal(ok.lookupFailed, false)
  assert.deepEqual(screenRecord(row({ superfamily: '' }), { parentClassification: { superfamily: 'Chrysomeloidea' } }), { left: 'not in Curculionoidea (Chrysomeloidea)' })
  assert.equal(screenRecord(row({ superfamily: '' }), { parentClassification: null }).lookupFailed, true)
  assert.deepEqual(screenRecord(row({ superfamily: '' })), { left: 'not in Curculionoidea (no superfamily)' })
})

test('screenRecord does not change the row', () => {
  const input = row({ genus: '' })
  screenRecord(input)
  assert.equal(input.genus, '')
})
