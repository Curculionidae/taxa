import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  otuLinkFallback,
  otuNaming,
  pickTaxonPageOtu,
  resolveOtuLinks
} from './otuLink.js'

// OTU records as /otus?extend[]=taxon_name returns them, sfg.taxonworks.org
// 2026-10-12: three OTUs on Carex L. (TaxonName 1583050), one on Arisaema.
const tag = (inner) => `<span class="otu_tag">${inner}</span>`
const genus = (id, cached) => ({ id, cached, cached_html: `<i>${cached}</i>`, cached_author_year: 'L.', rank: 'genus' })
const CAREX_TN = genus(1583050, 'Carex')
const CAREX_SP = { id: 735260, name: 'Carex sp.', taxon_name_id: 1583050, taxon_name: CAREX_TN, object_tag: tag('<i>Carex</i>&nbsp;<b>Carex sp.</b>') }
const CAREX_SPP = { id: 737529, name: 'Carex spp.', taxon_name_id: 1583050, taxon_name: CAREX_TN, object_tag: tag('<i>Carex</i>&nbsp;<b>Carex spp.</b>') }
const CAREX = { id: 1408614, name: null, taxon_name_id: 1583050, taxon_name: CAREX_TN, object_tag: tag('<i>Carex</i> L.') }
const ARISAEMA_SP = { id: 735213, name: 'Arisaema sp.', taxon_name_id: 1580296, taxon_name: genus(1580296, 'Arisaema'), object_tag: tag('<i>Arisaema</i>&nbsp;<b>Arisaema sp.</b>') }
const CYCAS_SP = { id: 735204, name: 'Cycas sp.', taxon_name_id: null, object_tag: tag('<b>Cycas sp.</b>') }
const ISATIS = {
  id: 737506,
  name: 'Isatis tinctoria',
  taxon_name_id: 1630394,
  taxon_name: { id: 1630394, cached: 'Isatis tinctoria', cached_html: '<i>Isatis tinctoria</i>', cached_author_year: 'L.', rank: 'species' },
  object_tag: tag('<i>Isatis tinctoria</i>&nbsp;<b>Isatis tinctoria</b>')
}
const ALL = [CAREX_SP, CAREX_SPP, CAREX, ARISAEMA_SP, CYCAS_SP, ISATIS]

// An association's subject/object: id, tag and label, nothing else.
const entity = (otu, object_label) => ({ id: otu.id, base_class: 'Otu', object_tag: otu.object_tag, object_label })

function stub(calls = [], rows = ALL) {
  return async (url, { params }) => {
    calls.push(params)
    const ids = (params['otu_id[]'] || []).map(String)
    const tns = (params['taxon_name_id[]'] || []).map(String)
    return {
      data: rows.filter(
        (o) => ids.includes(String(o.id)) || tns.includes(String(o.taxon_name_id))
      )
    }
  }
}

test('otuNaming: the four cases, from the OTU record', () => {
  assert.deepEqual(otuNaming(CAREX), {
    ownName: null,
    html: '<i>Carex</i> L.',
    label: { italic: 'Carex', plain: 'L.' },
    redirects: false
  })
  assert.deepEqual(otuNaming(CYCAS_SP), {
    ownName: 'Cycas sp.',
    html: 'Cycas sp.',
    label: { italic: '', plain: 'Cycas sp.' },
    redirects: false
  })
  assert.deepEqual(otuNaming(ISATIS), {
    ownName: null,
    html: '<i>Isatis tinctoria</i> L.',
    label: { italic: 'Isatis tinctoria', plain: 'L.' },
    redirects: false
  })
  assert.deepEqual(otuNaming(CAREX_SP), {
    ownName: 'Carex sp.',
    html: 'Carex sp.',
    label: { italic: '', plain: 'Carex sp.' },
    redirects: true
  })
})

test('otuNaming: a subgenus in the taxon name does not make the own name differ', () => {
  const otu = {
    id: 1,
    name: 'Hypera arator',
    taxon_name_id: 2,
    taxon_name: { cached: 'Hypera (Kippenbergia) arator', cached_html: '<i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i>', cached_author_year: '(Linnaeus, 1758)' }
  }
  assert.equal(otuNaming(otu).ownName, null)
  assert.equal(otuNaming(otu).html, '<i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i> (Linnaeus, 1758)')
})

test('otuNaming: the own name is escaped', () => {
  const otu = { id: 1, name: 'Aus <b>&', taxon_name_id: null }
  assert.equal(otuNaming(otu).html, 'Aus &lt;b&gt;&amp;')
})

test('otuNaming: without a record, read off the tag and label', () => {
  assert.deepEqual(otuNaming(entity(CAREX_SP, 'Carex L. Carex sp.')), {
    ownName: 'Carex sp.',
    html: 'Carex sp.',
    label: { italic: '', plain: 'Carex sp.' },
    redirects: true
  })
  const isatis = otuNaming(entity(ISATIS, 'Isatis tinctoria L. Isatis tinctoria'))
  assert.equal(isatis.ownName, null)
  assert.deepEqual(isatis.label, { italic: 'Isatis tinctoria', plain: 'L.' })
  assert.deepEqual(otuLinkFallback(entity(CAREX_SP, 'Carex L. Carex sp.')).otuId, 735260)
})

test('pickTaxonPageOtu: the OTU without a name of its own, lowest id first', () => {
  assert.equal(pickTaxonPageOtu([CAREX_SP, CAREX_SPP, CAREX]), CAREX)
  assert.equal(pickTaxonPageOtu([{ id: 9, name: '' }, { id: 4, name: null }]).id, 4)
  assert.equal(pickTaxonPageOtu([ARISAEMA_SP]), null)
  assert.equal(pickTaxonPageOtu(undefined), null)
})

test('an OTU whose own name differs from its taxon name links to the taxon page', async () => {
  const calls = []
  const links = await resolveOtuLinks([CAREX_SP], { request: stub(calls) })
  assert.deepEqual(links.get('735260'), {
    ownName: 'Carex sp.',
    html: 'Carex sp.',
    label: { italic: '', plain: 'Carex sp.' },
    otuId: 1408614
  })
  // a full record needs no lookup by id, only the sibling lookup
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]['taxon_name_id[]'], [1583050])
})

test('association entities are named from their fetched records', async () => {
  const calls = []
  const links = await resolveOtuLinks(
    [entity(CAREX_SPP, 'Carex L. Carex spp.'), entity(CAREX, 'Carex L.')],
    { request: stub(calls) }
  )
  assert.deepEqual(calls[0]['otu_id[]'], [737529, 1408614])
  assert.deepEqual(calls[0].extend, ['taxon_name'])
  assert.equal(links.get('737529').html, 'Carex spp.')
  assert.equal(links.get('737529').otuId, 1408614)
  assert.equal(links.get('1408614').html, '<i>Carex</i> L.')
  assert.equal(links.get('1408614').otuId, 1408614)
})

test('the only OTU on its taxon name links to itself', async () => {
  const links = await resolveOtuLinks([ARISAEMA_SP], { request: stub() })
  assert.equal(links.get('735213').otuId, 735213)
  assert.equal(links.get('735213').html, 'Arisaema sp.')
})

test('full records that are not redirected need no request at all', async () => {
  const calls = []
  const links = await resolveOtuLinks([CAREX, CYCAS_SP, ISATIS], { request: stub(calls) })
  assert.equal(links.get('1408614').otuId, 1408614)
  assert.equal(links.get('735204').otuId, 735204)
  assert.equal(links.get('737506').html, '<i>Isatis tinctoria</i> L.')
  assert.equal(calls.length, 0)
})

test('a resolved OTU is not fetched again, and concurrent callers share one lookup', async () => {
  const tn = genus(91, 'Bus')
  const row = { id: 910001, name: 'Bus sp.', taxon_name_id: 91, taxon_name: tn, object_tag: tag('<i>Bus</i>&nbsp;<b>Bus sp.</b>') }
  const page = { id: 910000, name: null, taxon_name_id: 91, taxon_name: tn }
  const calls = []
  const request = stub(calls, [row, page])
  const e = entity(row, 'Bus L. Bus sp.')
  const [a, b] = await Promise.all([
    resolveOtuLinks([e], { request }),
    resolveOtuLinks([e], { request })
  ])
  assert.equal(a.get('910001').otuId, 910000)
  assert.equal(b.get('910001').otuId, 910000)
  assert.equal(calls.length, 2) // one record lookup, one sibling lookup
  await resolveOtuLinks([e], { request })
  assert.equal(calls.length, 2)
})

test('a full page of siblings is followed to the next page', async () => {
  const row = { id: 920001, name: 'Cus sp.', taxon_name_id: 92, taxon_name: genus(92, 'Cus') }
  const named = Array.from({ length: 500 }, (_, i) => ({ id: 920100 + i, name: 'x', taxon_name_id: 92 }))
  const pages = [named, [{ id: 929999, name: null, taxon_name_id: 92 }]]
  const request = async (url, { params }) => ({ data: pages[params.page - 1] || [] })
  const links = await resolveOtuLinks([row], { request })
  assert.equal(links.get('920001').otuId, 929999)
})

test('a failed record lookup names the OTU from its tag, is logged, and is retried', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const tn = genus(77, 'Aus')
  const row = { id: 900001, name: 'Aus sp.', taxon_name_id: 77, taxon_name: tn, object_tag: tag('<i>Aus</i>&nbsp;<b>Aus sp.</b>') }
  const page = { id: 900000, name: null, taxon_name_id: 77, taxon_name: tn }
  const e = entity(row, 'Aus L. Aus sp.')
  let fail = true
  const request = async (url, { params }) => {
    if (fail) return { data: { error: 'nope' } }
    return stub([], [row, page])(url, { params })
  }
  const first = (await resolveOtuLinks([e], { request })).get('900001')
  assert.equal(first.html, 'Aus sp.')
  assert.equal(first.otuId, 900001)
  assert.equal(warn.mock.callCount(), 1)
  fail = false
  assert.equal((await resolveOtuLinks([e], { request })).get('900001').otuId, 900000)
})

test('an OTU the answer does not hold is asked again on the next call', async () => {
  const tn = genus(93, 'Dus')
  const row = { id: 930001, name: null, taxon_name_id: 93, taxon_name: tn, object_tag: tag('<i>Dus</i> L.') }
  const e = entity(row, 'Dus L.')
  const calls = []
  const rows = []
  const request = stub(calls, rows)
  await resolveOtuLinks([e], { request })
  rows.push(row)
  const link = (await resolveOtuLinks([e], { request })).get('930001')
  assert.equal(calls.length, 2)
  assert.equal(link.html, '<i>Dus</i> L.')
})

test('a record whose taxon_name lacks the name fields is not taken as the record', async () => {
  const tn = genus(94, 'Eus')
  const row = { id: 940001, name: null, taxon_name_id: 94, taxon_name: tn }
  const thin = { id: 940001, name: null, taxon_name_id: 94, taxon_name: { id: 94 }, object_tag: tag('<i>Eus</i> L.') }
  const calls = []
  const link = (await resolveOtuLinks([thin], { request: stub(calls, [row]) })).get('940001')
  assert.equal(calls.length, 1)
  assert.equal(link.html, '<i>Eus</i> L.')
})

test('without the record, the taxon page is still found by the taxon_name_id passed in', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const page = { id: 950000, name: null, taxon_name_id: 95 }
  const e = { id: 950001, taxon_name_id: 95, object_tag: tag('<i>Fus</i>&nbsp;<b>Fus sp.</b>'), object_label: 'Fus L. Fus sp.' }
  const request = async (url, { params }) => {
    if (params['otu_id[]']) return { data: { error: 'nope' } }
    return stub([], [page])(url, { params })
  }
  const link = (await resolveOtuLinks([e], { request })).get('950001')
  assert.equal(link.html, 'Fus sp.')
  assert.equal(link.otuId, 950000)
})
