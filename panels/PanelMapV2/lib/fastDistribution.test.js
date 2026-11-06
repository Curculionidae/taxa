import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadFastDistribution, stripTags } from './fastDistribution.js'

const SQUARE = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }

const otu = (id, tag) => ({ id, object_tag: tag ?? `<i>Aus</i> ${id}` })
const ad = (id, otuId, extra = {}) => ({
  id,
  asserted_distribution_object_type: 'Otu',
  asserted_distribution_object_id: otuId,
  asserted_distribution_shape_type: 'GeographicArea',
  asserted_distribution_shape_id: 7,
  asserted_distribution_shape: { name: 'Germany' },
  is_absent: null,
  ...extra
})
const coRow = (id, otuId, extra = {}) => ({
  dwc_occurrence_object_type: 'CollectionObject',
  dwc_occurrence_object_id: id,
  otu_id: otuId,
  decimalLatitude: '50',
  decimalLongitude: '10',
  ...extra
})

// A fake TaxonWorks: `routes` maps a path to a function of the params.
function fakeGet(routes) {
  return async (path, params = []) => {
    const route = routes[path]

    if (!route) throw new Error(`unexpected ${path}`)

    return route(new URLSearchParams(params))
  }
}

const page = (data, pages = 1) => ({ data, headers: { 'pagination-total-pages': String(pages) } })

function load(routes, options = {}) {
  return loadFastDistribution({
    otuId: 1,
    taxonNameId: 10,
    isSynonym: false,
    get: fakeGet(routes),
    loadShape: async () => SQUARE,
    ...options
  })
}

test('stripTags decodes numeric and named entities', () => {
  assert.equal(stripTags('<i>Aus</i>&nbsp;bus &#10060; O&#x27;Brien &amp; Co'), "Aus bus ❌ O'Brien & Co")
})

test('a specimen whose first copy is outside the OTU set still shows', async () => {
  const features = await load({
    '/otus': () => page([otu(1)]),
    '/asserted_distributions': () => page([]),
    '/otus/1/inventory/dwc.json': () => ({ data: [coRow(5, 99), coRow(5, 1)] })
  })

  assert.deepEqual(features.map((f) => [f.properties.base.id, f.properties.target.id]), [[5, 1]])
})

test('an association distribution targets the side that is an OTU of the page', async () => {
  const features = await load({
    '/otus': () => page([otu(1)]),
    '/asserted_distributions': () =>
      page([ad(3, 40, { asserted_distribution_object_type: 'BiologicalAssociation' })]),
    // The subject is a collection object whose id happens to be 1.
    '/biological_associations': () =>
      page([
        {
          id: 40,
          object_label: 'Aus 1 collected from Plantus',
          biological_association_subject_type: 'CollectionObject',
          biological_association_subject_id: 1,
          biological_association_object_type: 'Otu',
          biological_association_object_id: 1
        }
      ]),
    '/otus/1/inventory/dwc.json': () => ({ data: [] })
  })

  assert.equal(features[0].properties.target.id, 1)
  assert.equal(features[0].properties.base.label, 'Aus 1 collected from Plantus in Germany [Geographic Area]')
})

test('an association with no side among the page OTUs declines', async () => {
  const features = await load({
    '/otus': () => page([otu(1)]),
    '/asserted_distributions': () =>
      page([ad(3, 40, { asserted_distribution_object_type: 'BiologicalAssociation' })]),
    '/biological_associations': () =>
      page([
        {
          id: 40,
          object_label: 'x',
          biological_association_subject_type: 'CollectionObject',
          biological_association_subject_id: 8,
          biological_association_object_type: 'Otu',
          biological_association_object_id: 9
        }
      ]),
    '/otus/1/inventory/dwc.json': () => ({ data: [] })
  })

  assert.equal(features, null)
})

test('pages follow the page count, not a full last page', async () => {
  // The server returns 2 rows a page (fewer than asked for) over 3 pages.
  const all = [ad(1, 1), ad(2, 1), ad(3, 1), ad(4, 1), ad(5, 1)]
  const features = await load({
    '/otus': () => page([otu(1)]),
    '/asserted_distributions': (params) => {
      const n = Number(params.get('page'))

      return page(all.slice((n - 1) * 2, n * 2), 3)
    },
    '/otus/1/inventory/dwc.json': () => ({ data: [] })
  })

  assert.deepEqual(features.map((f) => f.properties.base.id), [1, 2, 3, 4, 5])
})

test('a field occurrence without a georeference declines', async () => {
  const features = await load({
    '/otus': () => page([otu(1)]),
    '/asserted_distributions': () => page([]),
    '/otus/1/inventory/dwc.json': () => ({
      data: [coRow(5, 1, { dwc_occurrence_object_type: 'FieldOccurrence', decimalLatitude: null })]
    })
  })

  assert.equal(features, null)
})

test('a shape that fails to load declines; an area without a shape is left out', async () => {
  const routes = {
    '/otus': () => page([otu(1)]),
    '/asserted_distributions': () => page([ad(1, 1)]),
    '/otus/1/inventory/dwc.json': () => ({ data: [] })
  }

  assert.equal(await load(routes, { loadShape: async () => { throw new Error('offline') } }), null)
  assert.deepEqual(await load(routes, { loadShape: async () => null }), [])
})
