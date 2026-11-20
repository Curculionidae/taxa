import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  lookupLive, recordFromDwc, cacheStatus, plainLabel, fromDistribution, fromDwcRow, placeLive, leftOutReason,
  fetchOtuDistributions, fetchDistributionsByIds, fetchOtuSpecimens, otuLeftOut, recordLeftOut
} from './live.js'
import { compileRules } from './rules.js'
import { toArea } from './areas.js'
import { deriveChecklists } from './checklists.js'
import { createContext, placeRecord } from './engine.js'
import { formatExplanation } from './format.js'
import * as fx from './fixtures.js'

// A small engine context from the real rules file and fixture areas.
function fixtures() {
  const rules = compileRules(readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8'))
  const areas = [fx.ga77, fx.ga8837, fx.ga32253].map((shape) => toArea('GeographicArea', shape))
  const { checklists } = deriveChecklists(areas, rules, new Map(), new Map())
  return { checklists, rules }
}

// AD 556796 as TaxonWorks returns it (GET /asserted_distributions/556796
// with extend[]=asserted_distribution_shape, 2026-11-20, citations left out).
const AD_556796 = {
  id: 556796,
  asserted_distribution_object_id: 717696,
  asserted_distribution_object_type: 'Otu',
  asserted_distribution_shape_id: 8837,
  asserted_distribution_shape_type: 'GeographicArea',
  is_absent: null,
  asserted_distribution_object: {
    type: 'Otu',
    id: 717696,
    object_tag: '<span class="otu_tag"><span class="otu_tag_taxon_name"><i>Phaedropus candidus</i> (Fabricius, 1775)</span></span>',
    taxon_name: 'Phaedropus candidus'
  },
  asserted_distribution_shape: {
    type: 'GeographicArea', id: 8837, name: 'Cayenne', level0_id: null, level1_id: null, level2_id: null,
    parent_id: 78, iso_3166_a2: null, tdwgID: null, data_origin: 'gadm',
    geographic_area_type: { id: 2, name: 'Unknown' }, parent: { name: 'French Guiana' }
  }
}

// A stub of makeAPIRequest: answers by URL, records the calls.
function stub(answers) {
  const calls = []
  return {
    calls,
    get: async (url, config = {}) => {
      calls.push({ url, params: config.params })
      const answer = answers[url]
      if (answer instanceof Error) throw answer
      if (answer === undefined) throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } })
      return { data: answer }
    }
  }
}

test('lookupLive: AD 556796 gives its area GA 8837 and the OTU name as label', async () => {
  const request = stub({ '/asserted_distributions/556796': AD_556796 })
  const result = await lookupLive({ kind: 'AD', id: 556796 }, request)
  assert.equal(result.area.key, 'GA 8837')
  assert.equal(result.area.parentName, 'French Guiana')
  assert.deepEqual(result.subject, { kind: 'AD', id: 556796, label: 'Phaedropus candidus (Fabricius, 1775)', area: result.area })
  assert.deepEqual(result.record, { type: 'AssertedDistribution', id: 556796 })
  assert.equal(result.otuId, 717696)
  assert.deepEqual(request.calls[0].params, { extend: ['asserted_distribution_shape'] })
})

test('lookupLive: an AD without a readable object is labelled AD <id>', async () => {
  const ad = { ...AD_556796, asserted_distribution_object: null }
  const result = await lookupLive({ kind: 'AD', id: 556796 }, stub({ '/asserted_distributions/556796': ad }))
  assert.equal(result.subject.label, 'AD 556796')
})

test('lookupLive: 404 says TaxonWorks has no such record', async () => {
  assert.deepEqual(await lookupLive({ kind: 'AD', id: 999999 }, stub({})), { error: 'TaxonWorks has no AD 999999' })
  assert.deepEqual(await lookupLive({ kind: 'CO', id: 5 }, stub({})), { error: 'TaxonWorks has no CO 5' })
})

test('lookupLive: a network failure gives a plain message', async () => {
  const request = stub({ '/collection_objects/5/dwc': new Error('Network Error') })
  assert.deepEqual(await lookupLive({ kind: 'CO', id: 5 }, request), { error: 'could not reach TaxonWorks: Network Error' })
})

test('lookupLive: CO by its DwC record, labelled with scientificName', async () => {
  const dwc = {
    scientificName: 'Dorytomus longimanus (Forster, 1771)', country: 'Ukraine', stateProvince: 'Kiev City',
    county: "Dniprovs'kyi", verbatimLocality: 'Kyiv', locality: null, decimalLatitude: 50.44, decimalLongitude: 30.57
  }
  const result = await lookupLive({ kind: 'CO', id: 1385165 }, stub({ '/collection_objects/1385165/dwc': dwc }))
  assert.deepEqual(result.subject, { kind: 'CO', id: 1385165, label: 'Dorytomus longimanus (Forster, 1771)' })
  assert.deepEqual(result.record, {
    type: 'CollectionObject', id: 1385165, country: 'Ukraine', stateProvince: 'Kiev City', county: "Dniprovs'kyi",
    locality: 'Kyiv', lat: 50.44, lng: 30.57
  })
  assert.equal(result.dwc, dwc)
})

test('lookupLive: FO through /field_occurrences/:id/dwc', async () => {
  const result = await lookupLive({ kind: 'FO', id: 7 }, stub({ '/field_occurrences/7/dwc': { scientificName: 'Aus bus', country: 'Chile' } }))
  assert.equal(result.record.type, 'FieldOccurrence')
  assert.equal(result.subject.label, 'Aus bus')
})

test('lookupLive: GZ through any distribution on it', async () => {
  const gz = {
    ...AD_556796,
    asserted_distribution_shape_type: 'Gazetteer',
    asserted_distribution_shape: { id: 10453, name: "Hawai'i: Kaua'i", iso_3166_a2: 'US' }
  }
  const request = stub({ '/asserted_distributions': [gz] })
  const result = await lookupLive({ kind: 'GZ', id: 10453 }, request)
  assert.equal(result.area.key, 'GZ 10453')
  assert.deepEqual(result.subject, { kind: 'GZ', id: 10453, label: "Hawai'i: Kaua'i", area: result.area })
  assert.deepEqual(request.calls[0].params, {
    geo_shape_id: [10453], geo_shape_type: ['Gazetteer'], per: 1, extend: ['asserted_distribution_shape']
  })
})

test('lookupLive: a GA no distribution uses is "used by no record", with children for a parent stub', async () => {
  const request = stub({ '/asserted_distributions': [] })
  assert.deepEqual(await lookupLive({ kind: 'GA', id: 5 }, request), { error: 'used by no record' })
  const areas = [
    { key: 'GA 8837', name: 'Cayenne', parentId: 78 },
    { key: 'GA 8838', name: 'Saint-Laurent-du-Maroni', parentId: 78 },
    { key: 'GA 78', name: 'French Guiana', parentId: null, records: 0, placement: null }
  ]
  assert.deepEqual(await lookupLive({ kind: 'GA', id: 78 }, request, { areas }), {
    error: 'used by no record',
    stub: { name: 'French Guiana', children: [{ key: 'GA 8837', name: 'Cayenne' }, { key: 'GA 8838', name: 'Saint-Laurent-du-Maroni' }] }
  })
})

test('recordFromDwc: the build\'s RecordInput from DwC fields, verbatimLocality first', () => {
  assert.deepEqual(recordFromDwc('FieldOccurrence', 3, { locality: 'near a river', decimalLatitude: '', decimalLongitude: null }), {
    type: 'FieldOccurrence', id: 3, country: undefined, stateProvince: undefined, county: undefined,
    locality: 'near a river', lat: '', lng: null
  })
})

test('plainLabel: tags removed, entities decoded', () => {
  assert.equal(plainLabel('<i>Aus</i> &amp; <b>bus</b> L&#39;H.'), "Aus & bus L'H.")
})

const COUNTRY_RECORDS = [
  { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: '1385165', country: 'Ukraine', state: 'Kyiv' },
  { dwc_occurrence_object_type: 'AssertedDistribution', dwc_occurrence_object_id: '556796', country: 'French Guiana' }
]
const UNPLACED = { 'locality text only': [['CO', 12], ['FO', 4]] }

test('cacheStatus: listed in the checklist file of the result', () => {
  assert.deepEqual(cacheStatus({ kind: 'CO', id: 1385165 }, { checklistName: 'Ukraine', records: COUNTRY_RECORDS, unplaced: UNPLACED }), {
    listed: true, text: 'listed in Ukraine (state Kyiv)'
  })
  assert.deepEqual(cacheStatus({ kind: 'AD', id: 556796 }, { checklistName: 'French Guiana', records: COUNTRY_RECORDS, unplaced: UNPLACED }), {
    listed: true, text: 'listed in French Guiana'
  })
})

test('cacheStatus: unplaced in the cache, with the reason', () => {
  assert.deepEqual(cacheStatus({ kind: 'FO', id: 4 }, { checklistName: null, records: null, unplaced: UNPLACED }), {
    listed: false, text: 'not listed: locality text only'
  })
})

test('cacheStatus: outside the scope of the checklists, from the DwC fields', () => {
  const status = (dwc, kind = 'CO') => cacheStatus({ kind, id: 1, dwc }, { checklistName: 'Ukraine', records: [], unplaced: {} }).text
  assert.equal(status({ taxonRank: 'genus', superfamily: 'Curculionoidea' }), 'not listed: rank genus')
  assert.equal(status({ taxonRank: 'species', superfamily: 'Chrysomeloidea' }), 'not listed: not in Curculionoidea (Chrysomeloidea)')
  assert.equal(status({ taxonRank: 'species', superfamily: 'Curculionoidea', occurrenceStatus: 'absent' }), 'not listed: recorded as absent')
  assert.equal(status({ taxonRank: 'species', superfamily: 'Curculionoidea' }), 'not listed in the cache')
  // Field occurrences carry no superfamily: nothing to tell from.
  assert.equal(status({ taxonRank: 'species' }, 'FO'), 'not listed in the cache')
  assert.equal(cacheStatus({ kind: 'AD', id: 1, absent: true }, { checklistName: null, records: null, unplaced: {} }).text,
    'not listed: distribution is absent')
})

test('lookupLive: an AD without area gives the build text "distribution has no area"', async () => {
  const ad = { ...AD_556796, asserted_distribution_shape: null, asserted_distribution_shape_id: null }
  const live = await lookupLive({ kind: 'AD', id: 556796 }, stub({ '/asserted_distributions/556796': ad }))
  assert.equal(live.error, undefined)
  assert.equal(live.area, undefined)
  assert.deepEqual(live.subject, { kind: 'AD', id: 556796, label: 'Phaedropus candidus (Fabricius, 1775)' })
  const placement = await placeLive(live, null)
  assert.equal(formatExplanation(live.subject, placement),
    'AD 556796  Phaedropus candidus (Fabricius, 1775)\n  result    not placeable: distribution has no area')
})

test('fromDistribution and placeLive place an AD with its area as placeRecord does', async () => {
  const { checklists, rules } = fixtures()
  const ctx = createContext({ checklists, rules })
  const live = fromDistribution(AD_556796)
  assert.equal(live.area.key, 'GA 8837')
  assert.equal(live.absent, false)
  assert.deepEqual(await placeLive(live, ctx), await placeRecord(live.record, ctx, live.area))
  assert.equal(fromDistribution({ ...AD_556796, is_absent: true }).absent, true)
})

test('fromDwcRow: kind, id and RecordInput from a DwC row', () => {
  const live = fromDwcRow({ dwc_occurrence_object_type: 'FieldOccurrence', dwc_occurrence_object_id: '7', scientificName: 'Aus bus', country: 'France', verbatimLocality: 'x' })
  assert.deepEqual(live.subject, { kind: 'FO', id: 7, label: 'Aus bus' })
  assert.equal(live.record.type, 'FieldOccurrence')
  assert.equal(live.record.country, 'France')
})

test('leftOutReason: rank, absent, superfamily, else null', () => {
  assert.equal(leftOutReason({ taxonRank: 'genus' }), 'rank genus')
  assert.equal(leftOutReason({ taxonRank: 'species', occurrenceStatus: 'Absent' }), 'recorded as absent')
  assert.equal(leftOutReason({ taxonRank: 'species', superfamily: 'Chrysomeloidea' }), 'not in Curculionoidea (Chrysomeloidea)')
  assert.equal(leftOutReason({ taxonRank: 'subspecies', superfamily: 'Curculionoidea' }), null)
})

// A paging stub: answers /asserted_distributions page by page, with headers.
function pagedStub(all, per) {
  const calls = []
  return {
    calls,
    get: async (url, { params }) => {
      calls.push({ url, params })
      const start = (params.page - 1) * per
      const pages = Math.ceil(all.length / per)
      return { data: all.slice(start, start + per), headers: { 'pagination-total': String(all.length), 'pagination-total-pages': String(pages) } }
    }
  }
}

test('fetchOtuDistributions: pages until done and reports progress', async () => {
  const all = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }))
  const request = pagedStub(all, 2)
  const progress = []
  const result = await fetchOtuDistributions(735022, request, { per: 2, onProgress: (loaded, total) => progress.push([loaded, total]) })
  assert.deepEqual(result.map((ad) => ad.id), [1, 2, 3, 4, 5])
  assert.deepEqual(progress, [[2, 5], [4, 5], [5, 5]])
  assert.deepEqual(request.calls[0].params, { otu_id: [735022], extend: ['asserted_distribution_shape'], per: 2, page: 1 })
  // exactly full pages: stops at pagination-total-pages
  assert.equal((await fetchOtuDistributions(1, pagedStub(all.slice(0, 4), 2), { per: 2 })).length, 4)
})

test('fetchDistributionsByIds: batches of 50, by id', async () => {
  const calls = []
  const request = { get: async (url, { params }) => { calls.push(params); return { data: params.asserted_distribution_id.map((id) => ({ id })) } } }
  const ids = Array.from({ length: 120 }, (_, i) => i + 1)
  const byId = await fetchDistributionsByIds(ids, request)
  assert.equal(byId.size, 120)
  assert.deepEqual(calls.map((params) => params.asserted_distribution_id.length), [50, 50, 20])
  assert.deepEqual(calls[0].extend, ['asserted_distribution_shape'])
})

test('fetchOtuSpecimens: by taxon name and kind, own OTU only, CSV when paged', async () => {
  const calls = []
  const rows = {
    CollectionObject: [
      { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: 1, otu_id: 735022 },
      { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: 2, otu_id: 999 }
    ],
    FieldOccurrence: []
  }
  const csv = 'id\tdwc_occurrence_object_type\tdwc_occurrence_object_id\totu_id\n1\tFieldOccurrence\t5\t735022\n2\tFieldOccurrence\t6\t1\n'
  const request = {
    get: async (url, config) => {
      calls.push({ url, params: config.params })
      if (url === '/dwc_occurrences.csv') return { data: csv }
      const type = config.params.dwc_occurrence_object_type
      return { data: rows[type], headers: { 'pagination-total-pages': type === 'FieldOccurrence' ? '3' : '1' } }
    }
  }
  const found = await fetchOtuSpecimens({ id: 735022, taxonNameId: 836248 }, request)
  assert.deepEqual(found.map((row) => `${row.dwc_occurrence_object_type} ${row.dwc_occurrence_object_id}`), ['CollectionObject 1', 'FieldOccurrence 5'])
  assert.deepEqual(calls[0].params, { taxon_name_id: [836248], dwc_occurrence_object_type: 'CollectionObject', per: 500 })
  assert.deepEqual(calls.map((call) => call.url), ['/dwc_occurrences', '/dwc_occurrences', '/dwc_occurrences.csv'])
  assert.deepEqual(await fetchOtuSpecimens({ id: 1, taxonNameId: null }, request), [])
})

test('otuLeftOut: the OTU of the distributions must be a species or subspecies of Curculionoidea', () => {
  assert.equal(otuLeftOut({ rank: 'family', parentNames: ['Root', 'Curculionoidea'] }), 'rank family')
  assert.equal(otuLeftOut({ rank: null, parentNames: [] }), 'rank none')
  assert.equal(otuLeftOut({ rank: 'species', parentNames: ['Root', 'Plantae'] }), 'not in Curculionoidea')
  assert.equal(otuLeftOut({ rank: 'subspecies', parentNames: ['Root', 'Curculionoidea', 'Curculionidae'] }), null)
})

test('recordLeftOut: own DwC reason, absent, else the OTU reason (host plant specimen)', () => {
  const plant = otuLeftOut({ rank: 'species', parentNames: ['Root', 'Plantae'] })
  // A host plant specimen: species rank, no superfamily in its DwC row.
  assert.equal(recordLeftOut({ dwc: { taxonRank: 'species', superfamily: '' } }, plant), 'not in Curculionoidea')
  assert.equal(recordLeftOut({ dwc: { taxonRank: 'genus' } }, plant), 'rank genus')
  assert.equal(recordLeftOut({ dwc: { taxonRank: 'species', superfamily: '' } }, null), null)
  assert.equal(recordLeftOut({ absent: true }, null), 'absent')
  assert.equal(recordLeftOut({ absent: false }, 'rank family'), 'rank family')
  assert.equal(recordLeftOut({}, null), null)
})
