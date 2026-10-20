import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { nameKey, indexSynonyms, createTaxonNameIdLoader } from './taxonNameIds.js'

// Larinus (Phyllonomeus) and its two synonyms, as the API returns them.
const NAMES = [
  {
    id: 834377,
    cached_valid_taxon_name_id: 834377,
    cached_html: '<i>Larinus</i> (<i>Phyllonomeus</i>)',
    cached_original_combination_html: '<i>Phyllonomeus</i>',
    cached_author_year: 'Gistel, 1856'
  },
  {
    id: 834378,
    cached_valid_taxon_name_id: 834377,
    cached_html: '<i>Larinus</i> (<i>Rhinobatus</i>)',
    cached_original_combination_html: '<i>Rhinobatus</i>',
    cached_author_year: 'Germar, 1817'
  },
  {
    id: 834379,
    cached_valid_taxon_name_id: 834377,
    cached_html: '<i>Larinus</i> (<i>Larinorhynchus</i>)',
    cached_original_combination_html: '<i>Larinorhynchus</i>',
    cached_author_year: 'Reitter, 1924'
  }
]

describe('nameKey', () => {
  it('drops tags, entities and extra spaces', () => {
    assert.equal(nameKey(' <i>Aus</i>  &amp; <i>bus</i> L., 1758 '), 'Aus & bus L., 1758')
  })
})

describe('indexSynonyms', () => {
  it('finds a synonym by its original combination or its current form', () => {
    const byText = indexSynonyms(NAMES).get(834377)

    assert.equal(byText.get('Rhinobatus Germar, 1817'), 834378)
    assert.equal(byText.get('Larinus (Rhinobatus) Germar, 1817'), 834378)
    assert.equal(byText.has('Phyllonomeus Gistel, 1856'), false) // the valid name
  })

  it('finds an original combination shown without the author parentheses', () => {
    const cynarae = {
      id: 834449,
      cached_valid_taxon_name_id: 834447,
      cached_html: '<i>Larinus cynarae</i>',
      cached_original_combination_html: '<i>Curculio cynarae</i>',
      cached_author_year: '(Herbst, 1795)'
    }
    const byText = indexSynonyms([cynarae]).get(834447)

    assert.equal(byText.get('Curculio cynarae Herbst, 1795'), 834449)
    assert.equal(byText.get('Larinus cynarae (Herbst, 1795)'), 834449)
  })

  it('links neither of two synonyms that read the same', () => {
    const twin = { ...NAMES[1], id: 999 }
    const byText = indexSynonyms([...NAMES, twin]).get(834377)

    assert.equal(byText.get('Rhinobatus Germar, 1817'), null)
  })
})

describe('createTaxonNameIdLoader', () => {
  it('batches the nodes of one tick into one request per endpoint', async () => {
    const calls = []
    const loader = createTaxonNameIdLoader(async (url, params) => {
      calls.push(url)
      if (url === '/otus') {
        return params.otu_id.map((id) => ({ id, taxon_name_id: id === 1 ? 834377 : 5 }))
      }
      return NAMES
    })
    const [a, b] = await Promise.all([loader.load(1), loader.load('2')])

    assert.deepEqual(calls, ['/otus', '/taxon_names'])
    assert.equal(a.taxonNameId, 834377)
    assert.equal(a.synonymId('<i>Larinorhynchus</i> Reitter, 1924'), 834379)
    assert.equal(a.synonymId('<i>Nonexistent</i> Nobody, 2000'), null)
    assert.equal(b.taxonNameId, 5)
  })

  it('asks again after a failed request', async () => {
    let fail = true
    const loader = createTaxonNameIdLoader(async (url, params) => {
      if (fail) throw new Error('offline')
      return url === '/otus' ? params.otu_id.map((id) => ({ id, taxon_name_id: 7 })) : []
    })

    await assert.rejects(loader.load(1))
    fail = false
    assert.equal((await loader.load(1)).taxonNameId, 7)
  })
})
