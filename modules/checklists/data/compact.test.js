import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { compactChecklist, expandChecklist } from './compact.js'

const record = (fields) => ({
  dwc_occurrence_object_type: 'AssertedDistribution',
  dwc_occurrence_object_id: '1',
  otu_id: '10',
  country: 'Ukraine',
  scientificName: 'Aus bus Smith, 1900',
  scientificNameAuthorship: 'Smith, 1900',
  taxonRank: 'species',
  basisOfRecord: 'MaterialCitation',
  superfamily: 'Curculionoidea',
  family: 'Curculionidae',
  genus: 'Aus',
  ...fields
})

// Field order is not part of the data; compare records as sorted entries.
const sorted = (records) => records.map((r) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))))

test('round trip keeps every field, missing fields stay missing', () => {
  const full = 'Smith, A. (1900) A paper. <i>Journal</i>, 1, 1–2.'
  const records = [
    record({ id: '5', place: 'Kharkiv', stateProvince: 'Kharkiv', citations: [{ id: '7', full, pages: '3' }] }),
    record({ dwc_occurrence_object_id: '2', country: 'Moldova', subfamily: 'Entiminae' }),
    record({ reassessed: [{ note: 'absent', sources: [full, 'Other (2000) X.'] }], adventive: true }),
    (({ country, ...rest }) => rest)(record({ dwc_occurrence_object_id: '3' }))
  ]
  const file = compactChecklist(records)
  assert.equal(file.country, 'Ukraine')
  assert.equal(file.refs.length, 2)
  assert.deepEqual(sorted(expandChecklist(JSON.parse(JSON.stringify(file)))), sorted(records))
})

test('a plain record array (old files) passes through', () => {
  const records = [record({})]
  assert.equal(expandChecklist(records), records)
})

test('every built country file survives the round trip', () => {
  const dir = new URL('../../../public/checklists/countries/', import.meta.url)
  for (const name of readdirSync(dir)) {
    const stored = JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
    // Already compact files are checked by expanding and compacting again.
    const records = expandChecklist(stored)
    const again = expandChecklist(JSON.parse(JSON.stringify(compactChecklist(records))))
    assert.deepEqual(sorted(again), sorted(records), name)
  }
})
