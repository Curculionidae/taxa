import { test } from 'node:test'
import assert from 'node:assert/strict'
import { typeStatusName, pickTaxonName, resolveTypeName, typeRow, typeNameKey, isUndeterminedType } from './typeStatus.js'

test('typeStatusName: status, the name as printed (subgenus and var. kept), the authorship', () => {
  assert.deepEqual(typeStatusName('paratype of Phaeopholus vietnamensis Legalov, 2026'),
    { status: 'paratype', name: 'Phaeopholus vietnamensis', author: 'Legalov, 2026' })
  assert.deepEqual(typeStatusName('syntypes of Seneciobius (Costaseneciobius) regularis var. vicinus Hustache, 1939'),
    { status: 'syntypes', name: 'Seneciobius (Costaseneciobius) regularis var. vicinus', author: 'Hustache, 1939' })
  assert.deepEqual(typeStatusName('holotype of Aus (Bus) cus (Smith, 1900)'),
    { status: 'holotype', name: 'Aus (Bus) cus', author: '(Smith, 1900)' })
  assert.deepEqual(typeStatusName('lectotype of Anthonomus xanthocnemus var. picipes'),
    { status: 'lectotype', name: 'Anthonomus xanthocnemus var. picipes', author: '' })
  assert.equal(typeStatusName('one of the syntypes of Aus bus Author, 1900').name, 'Aus bus')
  // Author particles start the authorship, not the name (shared splitter).
  assert.deepEqual(typeStatusName('holotype of Otiorhynchus bus de Marseul, 1872'),
    { status: 'holotype', name: 'Otiorhynchus bus', author: 'de Marseul, 1872' })
  assert.equal(typeStatusName('syntype of Aus bus von Heyden, 1880').author, 'von Heyden, 1880')
  assert.equal(typeStatusName('holotype of Polydrosus [sic] (Tylodrusus) constellatus Voss, 1959').name, 'Polydrosus [sic] (Tylodrusus) constellatus')
  assert.equal(typeStatusName('holotype'), null)
  assert.equal(typeStatusName(''), null)
  assert.equal(typeStatusName('holotype of Aus bus X, 1900; paratype of Aus cus Y, 1901'), null)
  assert.equal(typeStatusName('holotype of Aus bus X, 1900 | paratype of Aus cus Y, 1901'), null)
  // [sic] stays in the name: TaxonWorks' exact search finds it only so.
  assert.deepEqual(typeStatusName('holotype of Polydrosus [sic] (Tylodrusus) constellatus Voss, 1959'),
    { status: 'holotype', name: 'Polydrosus [sic] (Tylodrusus) constellatus', author: 'Voss, 1959' })
  // The same status twice counts once.
  assert.deepEqual(typeStatusName('holotype of Pachyrhynchus rukmaneae Barševskis, 2016 | holotype of Pachyrhynchus rukmaneae Barševskis, 2016'),
    { status: 'holotype', name: 'Pachyrhynchus rukmaneae', author: 'Barševskis, 2016' })
})

test('pickTaxonName: Combination rows dropped, one valid name or null', () => {
  const species = { id: 1655628, cached: 'Listronotus novellus', cached_author_year: '(Blatchley, 1916)', rank: 'species', cached_valid_taxon_name_id: 1655628 }
  const combination = { ...species, id: 1655629, rank: null }
  assert.equal(pickTaxonName([species, combination]).id, 1655628)
  assert.equal(pickTaxonName([species, { ...species, id: 1, cached_valid_taxon_name_id: 1 }]), null)
  assert.equal(pickTaxonName([]), null)
  assert.equal(pickTaxonName(null), null)
})

test('pickTaxonName: the same number of epithets, then the same author (homonyms)', () => {
  const mendax = { id: 824220, cached: 'Otiorhynchus (Cryphiphoroides) mendax', cached_author_year: 'Apfelbeck, 1919', rank: 'species', cached_valid_taxon_name_id: 824220 }
  const nominotypical = { id: 836673, cached: 'Otiorhynchus (Cryphiphoroides) mendax mendax', cached_author_year: 'Apfelbeck, 1919', rank: 'subspecies', cached_valid_taxon_name_id: 836673 }
  assert.equal(pickTaxonName([mendax, nominotypical], typeStatusName('holotype of Otiorhynchus mendax Apfelbeck, 1919')).id, 824220)
  const fabricius = { id: 816616, cached: 'Cratopus (Cratopus) brunnipes', cached_author_year: '(Fabricius, 1798)', rank: 'species', cached_valid_taxon_name_id: 816616 }
  const olivier = { id: 829605, cached: 'Exomias brunnipes', cached_author_year: '(Olivier, 1807)', rank: 'species', cached_valid_taxon_name_id: 836815 }
  assert.equal(pickTaxonName([fabricius, olivier], typeStatusName('lectotype of Curculio brunnipes Fabricius, 1798')).id, 816616)
  assert.equal(pickTaxonName([fabricius, olivier], typeStatusName('lectotype of Curculio brunnipes Linnaeus, 1758')), null)
})

// A stub get: answers by path (and the name param for /taxon_names), records the calls.
function stubGet(answers) {
  const calls = []
  const get = async (path, params = {}) => {
    calls.push({ path, params })
    const key = path === '/taxon_names' ? `${path}?${params.name}` : path
    if (!(key in answers)) throw new Error(`unexpected ${key}`)
    return answers[key]
  }
  get.calls = calls
  return get
}

test('resolveTypeName: exact name search, the valid name, its one OTU', async () => {
  const novellus = { id: 1655628, cached: 'Listronotus novellus', cached_author_year: '(Blatchley, 1916)', rank: 'species', cached_valid_taxon_name_id: 1655628 }
  const get = stubGet({
    '/taxon_names?Hyperodes novellus': [novellus, { ...novellus, id: 1655629, rank: null }],
    '/otus': [{ id: 700 }]
  })
  const result = await resolveTypeName(typeStatusName('lectotype of Hyperodes novellus Blatchley, 1916'), get)
  assert.deepEqual(get.calls[0], { path: '/taxon_names', params: { name: 'Hyperodes novellus', name_exact: true } })
  assert.equal(get.calls.length, 2)
  assert.deepEqual(get.calls[1], { path: '/otus', params: { taxon_name_id: [1655628] } })
  assert.deepEqual(result, { taxonName: novellus, valid: novellus, otuId: 700 })
})

test('resolveTypeName: a synonym asks for its valid name', async () => {
  const synonym = { id: 1655605, cached: 'Dorytomus alaskanus', cached_author_year: 'Casey, 1892', rank: 'species', cached_valid_taxon_name_id: 1655603 }
  const valid = { id: 1655603, cached: 'Dorytomus hirtus', cached_author_year: 'LeConte, 1876', rank: 'species', cached_valid_taxon_name_id: 1655603 }
  const get = stubGet({ '/taxon_names?Dorytomus alaskanus': [synonym], '/taxon_names/1655603': valid, '/otus': [{ id: 9 }] })
  const result = await resolveTypeName(typeStatusName('syntypes of Dorytomus alaskanus Casey, 1892'), get)
  assert.equal(result.valid.cached, 'Dorytomus hirtus')
  assert.equal(result.taxonName.id, 1655605)
  assert.equal(result.otuId, 9)
})

test('resolveTypeName: errors', async () => {
  const name = typeStatusName('holotype of Aus bus X, 1900')
  const aus = { id: 1, cached: 'Aus bus', cached_author_year: 'X, 1900', rank: 'species', cached_valid_taxon_name_id: 1 }
  assert.deepEqual(await resolveTypeName(name, stubGet({ '/taxon_names?Aus bus': [] })), { error: 'type status name not found in TaxonWorks' })
  assert.deepEqual(await resolveTypeName(name, stubGet({ '/taxon_names?Aus bus': [aus, { ...aus, id: 2, cached_valid_taxon_name_id: 2 }] })),
    { error: 'type status name is ambiguous in TaxonWorks' })
  assert.deepEqual(await resolveTypeName(name, stubGet({ '/taxon_names?Aus bus': [aus], '/otus': [] })), { error: 'no OTU' })
  // Several unnamed OTUs on one name (a duplicate in TaxonWorks): the lowest id;
  // a named OTU (a concept of its own) is not taken when an unnamed one exists.
  assert.equal((await resolveTypeName(name, stubGet({ '/taxon_names?Aus bus': [aus], '/otus': [{ id: 7 }, { id: 2 }] }))).otuId, 2)
  assert.equal((await resolveTypeName(name, stubGet({ '/taxon_names?Aus bus': [aus], '/otus': [{ id: 1, name: 'Aus bus sensu X' }, { id: 4 }] }))).otuId, 4)
})

test('resolveTypeName: a client error of TaxonWorks is a result, not an exception', async () => {
  const name = typeStatusName('holotype of Aus bus X, 1900')
  const synonym = { id: 1, cached: 'Aus bus', cached_author_year: 'X, 1900', rank: 'species', cached_valid_taxon_name_id: 5 }
  assert.deepEqual(await resolveTypeName(name, stubGet({ '/taxon_names?Aus bus': { error: '403 /taxon_names' } })),
    { error: 'TaxonWorks lookup failed (403 /taxon_names)' })
  assert.deepEqual(await resolveTypeName(name, stubGet({ '/taxon_names?Aus bus': [synonym], '/taxon_names/5': { error: '404 /taxon_names/5' } })),
    { error: 'TaxonWorks lookup failed (404 /taxon_names/5)' })
  assert.deepEqual(await resolveTypeName(name, stubGet({ '/taxon_names?Aus bus': [{ ...synonym, cached_valid_taxon_name_id: 1 }], '/otus': { error: '404 /otus' } })),
    { error: 'TaxonWorks lookup failed (404 /otus)' })
})

test('isUndeterminedType: a collection object with a type status and no OTU', () => {
  const co = { dwc_occurrence_object_type: 'CollectionObject', typeStatus: 'holotype of Aus bus X, 1900' }
  assert.equal(isUndeterminedType(co), true)
  assert.equal(isUndeterminedType({ ...co, otu_id: '7' }), false)
  assert.equal(isUndeterminedType({ ...co, typeStatus: '  ' }), false)
  assert.equal(isUndeterminedType({ ...co, dwc_occurrence_object_type: 'FieldOccurrence' }), false)
})

test('typeRow: an undetermined type takes the valid name, rank, OTU and classification', () => {
  const row = { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: '2876460', otu_id: '', scientificName: '',
    taxonRank: '', typeStatus: 'paratype of Phaeopholus vietnamensis Legalov, 2026', country: 'Vietnam' }
  const valid = { id: 1662470, cached: 'Phaeopholus vietnamensis', cached_author_year: 'Legalov, 2026', rank: 'species', cached_valid_taxon_name_id: 1662470 }
  const typeNames = { 'Phaeopholus vietnamensis Legalov, 2026': { taxonName: valid, valid, otuId: 1475795 } }
  const otuParents = { 1475795: { Curculionoidea: {}, Curculionidae: {}, Phaeopholus: {} } }
  const out = typeRow(row, typeNames, otuParents)
  assert.equal(out.otu_id, '1475795')
  assert.equal(out.scientificName, 'Phaeopholus vietnamensis Legalov, 2026')
  assert.equal(out.scientificNameAuthorship, 'Legalov, 2026')
  assert.equal(out.taxonRank, 'species')
  assert.equal(out.typeLabel, 'paratype, no determination')
  assert.equal(out.country, 'Vietnam')
})

test('typeRow: unresolved and unreadable types are listed with a reason; other rows unchanged', () => {
  const base = { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: '1', otu_id: '' }
  assert.deepEqual(typeRow({ ...base, typeStatus: 'holotype' }, {}, {}), { left: 'type status names no single taxon' })
  assert.deepEqual(typeRow({ ...base, typeStatus: 'holotype of Aus bus X, 1900' }, { 'Aus bus X, 1900': { error: 'type status name not found in TaxonWorks' } }, {}),
    { left: 'type status name not found in TaxonWorks' })
  const genus = { id: 5, cached: 'Aus', cached_author_year: 'X, 1900', rank: 'genus', cached_valid_taxon_name_id: 5 }
  assert.equal(typeRow({ ...base, typeStatus: 'holotype of Aus bus X, 1900' }, { 'Aus bus X, 1900': { taxonName: genus, valid: genus, otuId: 3 } }, {}).taxonRank, 'genus')
  const determined = { ...base, otu_id: '12', typeStatus: 'holotype of Aus bus X, 1900', scientificName: 'Aus bus X, 1900' }
  assert.equal(typeRow(determined, {}, {}), determined)
  const ad = { dwc_occurrence_object_type: 'AssertedDistribution', otu_id: '' }
  assert.equal(typeRow(ad, {}, {}), ad)
})

test('typeNameKey: name and authorship, so homonyms stay apart', () => {
  assert.equal(typeNameKey(typeStatusName('lectotype of Curculio brunnipes Fabricius, 1798')), 'Curculio brunnipes Fabricius, 1798')
  assert.equal(typeNameKey(typeStatusName('lectotype of Anthonomus xanthocnemus var. picipes')), 'Anthonomus xanthocnemus var. picipes')
})
