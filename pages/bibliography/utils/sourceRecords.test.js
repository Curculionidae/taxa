import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getSourceRecords, getCitationColor } from './sourceRecords.js'

const SOURCE_ID = 7

const NAME_PARAM = 'taxon_name_query[source_query][source_id][]'
const OTU_PARAM = 'source_query[source_id][]'
const DISTRIBUTION_PARAM =
  'asserted_distribution_query[source_query][source_id][]'

const otu = (id, label, taxonNameId = null) => ({
  id,
  taxon_name_id: taxonNameId,
  object_tag: `<span class="otu_tag">${label}</span>`
})

const citation = (
  type,
  objectId,
  { pages = null, topics = [], original = false } = {}
) => ({
  citation_object_type: type,
  citation_object_id: objectId,
  is_original: original,
  pages,
  citation_topics: topics.map((name, index) => ({
    topic: { id: index + 1, name, definition: `About ${name}` }
  }))
})

/**
 * Fake axios instance. `otus` maps a facet parameter to the OTUs it returns.
 * Serves the list in pages, the way the API does.
 */
function makeRequest({
  citations = [],
  otus = {},
  associations = [],
  pool = [],
  names = [],
  routes = {}
}) {
  const calls = []

  return {
    calls,
    get(url, { params }) {
      calls.push({ url, params })

      if (routes[url]) {
        const data = routes[url](params)

        return Promise.resolve({
          data,
          headers: { 'pagination-total': String(data.length) }
        })
      }

      const facet = Object.keys(otus).find((key) => key in params)
      let all = otus[facet] ?? []

      if (url === '/citations') all = citations
      if (url === '/biological_associations/basic') {
        all = params.biological_association_id
          ? associations.filter(({ id }) =>
              params.biological_association_id.includes(id)
            )
          : associations
      }
      if (url === '/asserted_distributions') all = []
      if (params.otu_id) all = pool.filter(({ id }) => params.otu_id.includes(id))
      if (url === '/taxon_names') {
        all = names.filter(({ id }) => params.taxon_name_id.includes(id))
      }
      if (url === '/otus' && params.taxon_name_id) {
        all = pool.filter((o) => params.taxon_name_id.includes(o.taxon_name_id))
      }

      const start = (params.page - 1) * params.per

      return Promise.resolve({
        data: all.slice(start, start + params.per),
        headers: { 'pagination-total': String(all.length) }
      })
    }
  }
}

describe('getSourceRecords', () => {
  it('lists an OTU cited only through an asserted distribution', async () => {
    const request = makeRequest({
      citations: [citation('AssertedDistribution', 300)],
      otus: { [DISTRIBUTION_PARAM]: [otu(1, 'Aus bus')] }
    })

    const { otus, unlinked } = await getSourceRecords(SOURCE_ID, request)

    assert.equal(otus.length, 1)
    assert.equal(otus[0].id, 1)
    assert.deepEqual(otus[0].citedOn, [
      { type: 'AssertedDistribution', pages: null }
    ])
    assert.deepEqual(unlinked, [])
  })

  it('only queries the paths the source has citations for', async () => {
    const request = makeRequest({
      citations: [citation('Otu', 1)],
      otus: { [OTU_PARAM]: [otu(1, 'Aus bus')] }
    })

    await getSourceRecords(SOURCE_ID, request)

    const otuCalls = request.calls.filter(({ url }) => url === '/otus')

    assert.equal(otuCalls.length, 1)
    assert.equal(otuCalls[0].params[OTU_PARAM], SOURCE_ID)
  })

  it('merges an OTU reached through several paths into one row', async () => {
    const request = makeRequest({
      citations: [
        citation('TaxonName', 50, { pages: '12' }),
        citation('Otu', 1, { pages: '14', topics: ['Biology'] }),
        citation('AssertedDistribution', 300)
      ],
      otus: {
        [NAME_PARAM]: [otu(1, 'Aus bus', 50)],
        [OTU_PARAM]: [otu(1, 'Aus bus', 50)],
        [DISTRIBUTION_PARAM]: [otu(1, 'Aus bus', 50)]
      }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.equal(otus.length, 1)
    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonName', pages: '12' },
      {
        type: 'Otu',
        pages: '14',
        topics: [{ id: 1, name: 'Biology', definition: 'About Biology' }]
      },
      { type: 'AssertedDistribution', pages: null }
    ])
  })

  it('lists a biological association under its subject OTU only', async () => {
    const request = makeRequest({
      citations: [citation('BiologicalAssociation', 900, { pages: '63' })],
      associations: [
        { id: 900, subject_otu_id: 1, object_otu_id: 2 },
        { id: 901, subject_otu_id: 1, object_otu_id: 3 }
      ],
      pool: [otu(1, 'Aus bus'), otu(2, 'Planta una'), otu(3, 'Planta dua')]
    })

    const { otus, unlinked } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus.map(({ id }) => id), [1])
    assert.deepEqual(otus[0].citedOn, [
      { type: 'BiologicalAssociation', pages: '63' }
    ])
    assert.deepEqual(unlinked, [])
  })

  it('lists a distribution of a biological association under the subject OTU', async () => {
    const request = makeRequest({
      citations: [
        citation('BiologicalAssociation', 900, { pages: '44' }),
        citation('AssertedDistribution', 300, { pages: '45' })
      ],
      associations: [{ id: 900, subject_otu_id: 1, object_otu_id: 2 }],
      pool: [otu(1, 'Aus bus'), otu(2, 'Planta una')],
      otus: { [DISTRIBUTION_PARAM]: [] },
      routes: {
        '/asserted_distributions': () => [
          {
            id: 300,
            asserted_distribution_object_type: 'BiologicalAssociation',
            asserted_distribution_object_id: 900
          }
        ]
      }
    })

    const { otus, unlinked } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus.map(({ id }) => id), [1])
    assert.deepEqual(otus[0].citedOn, [
      { type: 'AssertedDistribution', pages: '45' },
      { type: 'BiologicalAssociation', pages: '44' }
    ])
    assert.deepEqual(unlinked, [])
  })

  it('shows the pages of a distribution cited on an OTU', async () => {
    const request = makeRequest({
      citations: [citation('AssertedDistribution', 300, { pages: '12' })],
      otus: { [DISTRIBUTION_PARAM]: [otu(1, 'Aus bus')] },
      routes: {
        '/asserted_distributions': () => [
          {
            id: 300,
            asserted_distribution_object_type: 'Otu',
            asserted_distribution_object_id: 1
          }
        ]
      }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'AssertedDistribution', pages: '12' }
    ])
  })

  it('sorts OTUs by their plain text label', async () => {
    const request = makeRequest({
      citations: [citation('Otu', 1), citation('Otu', 2)],
      otus: { [OTU_PARAM]: [otu(1, '<i>Zus</i> aus'), otu(2, '<i>Aus</i> bus')] }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus.map(({ id }) => id), [2, 1])
  })

  it('counts citations that lead to no OTU as unlinked', async () => {
    const request = makeRequest({
      citations: [
        citation('TypeMaterial', 9),
        citation('TypeMaterial', 10),
        citation('Otu', 1)
      ],
      otus: { [OTU_PARAM]: [otu(1, 'Aus bus')] },
      routes: { '/collection_objects': () => [] }
    })

    const { otus, unlinked } = await getSourceRecords(SOURCE_ID, request)

    assert.equal(otus.length, 1)
    assert.deepEqual(unlinked, [{ type: 'TypeMaterial', count: 2 }])
  })

  it('counts the citations of a type that only partly lead to a taxon', async () => {
    const request = makeRequest({
      citations: [
        citation('AssertedDistribution', 300, { pages: '5' }),
        citation('AssertedDistribution', 301),
        citation('AssertedDistribution', 302),
        citation('TaxonName', 50),
        citation('TaxonName', 99)
      ],
      otus: {
        [DISTRIBUTION_PARAM]: [otu(1, 'Aus bus', 50)],
        [NAME_PARAM]: [otu(1, 'Aus bus', 50)]
      },
      routes: {
        '/asserted_distributions': () => [
          {
            id: 300,
            asserted_distribution_object_type: 'Otu',
            asserted_distribution_object_id: 1
          },
          {
            id: 301,
            asserted_distribution_object_type: 'BiologicalAssociation',
            asserted_distribution_object_id: 900
          }
        ]
      }
    })

    const { otus, unlinked } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonName', pages: null },
      { type: 'AssertedDistribution', pages: '5' }
    ])
    assert.deepEqual(unlinked, [
      { type: 'AssertedDistribution', count: 2 },
      { type: 'TaxonName', count: 1 }
    ])
  })

  it('lists a cited name that has no OTU as a row without a link', async () => {
    const request = makeRequest({
      citations: [citation('TaxonName', 50, { pages: '75' })],
      otus: { [NAME_PARAM]: [] },
      names: [
        {
          id: 50,
          cached_html: '<i>Aus bus</i>',
          cached_author_year: 'Smith & Jones, 1900',
          cached_valid_taxon_name_id: 50
        }
      ]
    })

    const { otus, unlinked } = await getSourceRecords(SOURCE_ID, request)

    assert.equal(otus.length, 1)
    assert.equal(otus[0].otuId, null)
    assert.equal(otus[0].object_tag, '<i>Aus bus</i> Smith &amp; Jones, 1900')
    assert.deepEqual(otus[0].citedOn, [{ type: 'TaxonName', pages: '75' }])
    assert.deepEqual(unlinked, [])
  })

  it('tells the original description from other citations of a name', async () => {
    const request = makeRequest({
      citations: [
        citation('TaxonName', 50, { pages: '12', original: true }),
        citation('TaxonName', 51, { pages: '12' }),
        citation('TaxonName', 51, { pages: '30' })
      ],
      otus: { [NAME_PARAM]: [otu(1, 'Aus bus', 50), otu(2, 'Aus cus', 51)] }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonName', pages: '12', kind: 'original' }
    ])
    assert.deepEqual(otus[1].citedOn, [
      { type: 'TaxonName', pages: '12' },
      { type: 'TaxonName', pages: '30' }
    ])
  })

  it('does not call the first use of a combination an original description', async () => {
    const request = makeRequest({
      citations: [citation('TaxonName', 50, { pages: '75', original: true })],
      otus: { [NAME_PARAM]: [] },
      names: [
        {
          id: 50,
          type: 'Combination',
          cached_html: '<i>Cus bus</i>',
          cached_author_year: '(Smith, 1900)',
          cached_valid_taxon_name_id: 50
        }
      ]
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonName', pages: '75', kind: 'combination' }
    ])
  })

  it('calls the origin citation of a misspelled name a misspelling', async () => {
    const request = makeRequest({
      citations: [citation('TaxonName', 50, { pages: '9', original: true })],
      otus: { [NAME_PARAM]: [otu(1, '<i>Aus bus</i> [sic] Smith, 1900', 50)] }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonName', pages: '9', kind: 'misspelling' }
    ])
  })

  it('names the kind of relationship and status, one pill per kind', async () => {
    const request = makeRequest({
      citations: [
        citation('TaxonNameRelationship', 600, { pages: '80' }),
        citation('TaxonNameRelationship', 601, { pages: '80' }),
        citation('TaxonNameRelationship', 602, { pages: '80' }),
        citation('TaxonNameClassification', 700, { pages: '81' })
      ],
      pool: [otu(1, 'Aus bus', 50)],
      routes: {
        '/taxon_name_relationships': () => [
          {
            id: 600,
            subject_taxon_name_id: 50,
            type: 'TaxonNameRelationship::Iczn::Invalidating::Synonym::Subjective'
          },
          {
            id: 601,
            subject_taxon_name_id: 50,
            type: 'TaxonNameRelationship::Iczn::Invalidating::Synonym'
          },
          {
            id: 602,
            subject_taxon_name_id: 50,
            type: 'TaxonNameRelationship::Typification::Genus::Original::OriginalMonotypy'
          }
        ],
        '/taxon_name_classifications/700': () => ({
          taxon_name_id: 50,
          type: 'TaxonNameClassification::Iczn::Unavailable::NomenNudum::NoDescription'
        })
      }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonNameRelationship', pages: '80', kind: 'Synonymy' },
      { type: 'TaxonNameRelationship', pages: '80', kind: 'Type species' },
      { type: 'TaxonNameClassification', pages: '81', kind: 'Nomen nudum' }
    ])
  })

  it('does not repeat a pill for a citation without pages', async () => {
    const request = makeRequest({
      citations: [
        citation('Otu', 1, { pages: '29' }),
        citation('Otu', 1),
        citation('TaxonName', 50)
      ],
      otus: {
        [NAME_PARAM]: [otu(1, 'Aus bus', 50)],
        [OTU_PARAM]: [otu(1, 'Aus bus', 50)]
      }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonName', pages: null },
      { type: 'Otu', pages: '29' }
    ])
  })

  it('keeps a pill without pages when it has topics of its own', async () => {
    const request = makeRequest({
      citations: [
        citation('Otu', 1, { pages: '29' }),
        citation('Otu', 1, { topics: ['Notes'] })
      ],
      otus: { [OTU_PARAM]: [otu(1, 'Aus bus', 50)] }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'Otu', pages: '29' },
      {
        type: 'Otu',
        pages: null,
        topics: [{ id: 1, name: 'Notes', definition: 'About Notes' }]
      }
    ])
  })

  it('keeps the topics of a citation with its own pill', async () => {
    const request = makeRequest({
      citations: [
        citation('Otu', 1, { pages: '14', topics: ['Distribution', 'Notes'] }),
        citation('Otu', 1, { pages: '20' }),
        citation('TaxonName', 50, { pages: '14' })
      ],
      otus: {
        [NAME_PARAM]: [otu(1, 'Aus bus', 50)],
        [OTU_PARAM]: [otu(1, 'Aus bus', 50)]
      }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonName', pages: '14' },
      {
        type: 'Otu',
        pages: '14',
        topics: [
          { id: 1, name: 'Distribution', definition: 'About Distribution' },
          { id: 2, name: 'Notes', definition: 'About Notes' }
        ]
      },
      { type: 'Otu', pages: '20' }
    ])
  })

  it('links a cited synonym without an OTU to the OTU of its valid name', async () => {
    const request = makeRequest({
      citations: [citation('TaxonName', 50), citation('TaxonName', 60)],
      otus: { [NAME_PARAM]: [otu(1, 'Cus dus', 60)] },
      names: [
        {
          id: 50,
          cached_html: '<i>Aus bus</i>',
          cached_author_year: 'Smith, 1900',
          cached_valid_taxon_name_id: 70
        }
      ],
      pool: [otu(9, 'Eus fus', 70)]
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(
      otus.map(({ otuId, object_tag }) => [otuId, object_tag]),
      [
        [9, '<i>Aus bus</i> Smith, 1900'],
        [1, '<span class="otu_tag">Cus dus</span>']
      ]
    )
  })

  it('puts type material, name relationships and name statuses on the row of their name', async () => {
    const request = makeRequest({
      citations: [
        citation('TaxonName', 50, { pages: '75' }),
        citation('TypeMaterial', 800, { pages: '75' }),
        citation('TaxonNameRelationship', 600, { pages: '80' }),
        citation('TaxonNameClassification', 700)
      ],
      otus: { [NAME_PARAM]: [otu(1, 'Aus bus', 50)] },
      pool: [otu(1, 'Aus bus', 50)],
      routes: {
        '/taxon_name_relationships': () => [
          { id: 600, subject_taxon_name_id: 50, object_taxon_name_id: 51 }
        ],
        '/taxon_name_classifications/700': () => ({ taxon_name_id: 50 }),
        '/collection_objects': (params) =>
          params.type_specimen_taxon_name_id === 50
            ? [
                {
                  id: 4,
                  type_material: [
                    { global_id: 'gid://taxon-works/TypeMaterial/800' }
                  ]
                }
              ]
            : []
      }
    })

    const { otus, unlinked } = await getSourceRecords(SOURCE_ID, request)

    assert.equal(otus.length, 1)
    assert.deepEqual(otus[0].citedOn, [
      { type: 'TaxonName', pages: '75' },
      { type: 'TaxonNameRelationship', pages: '80' },
      { type: 'TaxonNameClassification', pages: null },
      { type: 'TypeMaterial', pages: '75' }
    ])
    assert.deepEqual(unlinked, [])
  })

  it('counts type material it cannot tie to a name as unlinked', async () => {
    const request = makeRequest({
      citations: [citation('Otu', 1), citation('TypeMaterial', 800)],
      otus: { [OTU_PARAM]: [otu(1, 'Aus bus', 50)] },
      routes: { '/collection_objects': () => [] }
    })

    const { unlinked } = await getSourceRecords(SOURCE_ID, request)

    assert.deepEqual(unlinked, [{ type: 'TypeMaterial', count: 1 }])
  })

  it('reads every page of a long list', async () => {
    const many = Array.from({ length: 2500 }, (_, index) =>
      otu(index + 1, `Aus ${String(index).padStart(4, '0')}`)
    )
    const request = makeRequest({
      citations: [citation('AssertedDistribution', 300)],
      otus: { [DISTRIBUTION_PARAM]: many }
    })

    const { otus } = await getSourceRecords(SOURCE_ID, request)

    assert.equal(otus.length, 2500)
  })

  it('returns nothing for a source without citations', async () => {
    const request = makeRequest({})

    assert.deepEqual(await getSourceRecords(SOURCE_ID, request), {
      otus: [],
      unlinked: []
    })
    assert.equal(request.calls.length, 1)
  })
})

describe('getCitationColor', () => {
  it('groups citation types into taxonomy, biology and the rest', () => {
    assert.equal(getCitationColor('TaxonName'), 'blue')
    assert.equal(getCitationColor('TypeMaterial'), 'blue')
    assert.equal(getCitationColor('BiologicalAssociation'), 'green')
    assert.equal(getCitationColor('AssertedDistribution'), 'yellow')
    assert.equal(getCitationColor('SomethingNew'), 'yellow')
  })
})
