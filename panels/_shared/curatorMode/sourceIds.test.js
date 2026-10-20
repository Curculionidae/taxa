import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { plainKey, indexSources, searchTermFor, searchSourceId } from './sourceIds.js'

const REITTER =
  'Reitter, E. (1912) Übersicht der Untergattungen und Artengruppen der Gattung Otiorhynchus Germ. <i>Wiener Entomologische Zeitung</i>, 31, 45–67. Available at https://www.biodiversitylibrary.org/page/12080142'

describe('plainKey', () => {
  it('matches the linkified panel text to the source text', () => {
    const shown = REITTER.replace(
      'https://www.biodiversitylibrary.org/page/12080142',
      '<a href="https://www.biodiversitylibrary.org/page/12080142">https://www.biodiversitylibrary.org/page/12080142</a>'
    )

    assert.equal(plainKey(shown), plainKey(REITTER))
    assert.equal(plainKey('A &amp;  B'), 'A & B')
  })
})

describe('indexSources', () => {
  it('maps text to id, and a text two sources share to null', () => {
    const index = indexSources([
      { id: 1, cached: REITTER },
      { id: 2, cached: 'Same (2000) Text.' },
      { id: 3, cached: 'Same (2000) Text.' },
      { id: 1, cached: REITTER }
    ])

    assert.equal(index.get(plainKey(REITTER)), 1)
    assert.equal(index.get('Same (2000) Text.'), null)
  })
})

describe('searchSourceId', () => {
  it('searches by the first words and keeps only an exact match', async () => {
    let params
    const request = {
      get: async (url, options) => {
        params = options.params
        return {
          data: [
            { id: 7, cached: 'Fabricius, J.C. (1781) Species insectorum. Vol. 1.' },
            { id: 8, cached: 'Fabricius, J.C. (1781) Species insectorum. Vol. 2.' }
          ]
        }
      }
    }
    const key = 'Fabricius, J.C. (1781) Species insectorum. Vol. 2.'

    assert.equal(await searchSourceId(request, key), 8)
    assert.equal(params.query_term, searchTermFor(key))
    assert.equal(params.query_term, 'Fabricius, J.C. (1781) Species insectorum. Vol.')
    assert.equal(await searchSourceId(request, 'Nobody (1900) Nothing.'), null)
  })
})
