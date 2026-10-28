import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advancedParticipant } from './advancedAssociations.js'

// OTU 736069: Dorycnium suffruticosum Vill., filed under Lotus as TaxonWorks
// wants a synonym, so its `cached` reads "Lotus suffruticosus" (see
// publishedTaxonName in makeBiologicalAssociation.js).
const lotus = {
  id: 1630374, nomenclatural_code: 'icn', cached: 'Lotus dorycnium', cached_html: '<i>Lotus dorycnium</i>',
  cached_author_year: 'L.', cached_valid_taxon_name_id: 1630374
}
const synonym = {
  id: 1630373, type: 'Protonym', nomenclatural_code: 'icn', cached: 'Lotus suffruticosus',
  cached_html: '<i>Lotus suffruticosus</i>', cached_author_year: 'Vill.',
  cached_original_combination: 'Dorycnium suffruticosum',
  cached_original_combination_html: '<i>Dorycnium suffruticosum</i>', cached_valid_taxon_name_id: 1630374
}
const otu = { id: 736069, name: 'Dorycnium suffruticosum', taxon_name_id: 1630373, taxon_name: synonym,
  accepted_otu_id: 1447207, accepted_taxon_name: lotus }
const row = { id: 320169, object: { type: 'Otu', id: 736069, label: 'Lotus suffruticosus Vill.' }, object_otu_id: 736069 }
const taxa = { otuById: new Map([['736069', otu]]), dwcBySpecimen: new Map() }
const classification = new Map([
  ['1630373', { family: 'Fabaceae', genusOtuId: 1447000 }],
  ['1630374', { family: 'Fabaceae', genusOtuId: 1447000 }]
])

test('original names show a plant synonym as published, without the link of the genus it is filed under', () => {
  const original = advancedParticipant(row, 'object', taxa, true, classification, true)
  assert.equal(original.genus, 'Dorycnium')
  assert.equal(original.species, 'Dorycnium suffruticosum Vill. now Lotus dorycnium L.')
  assert.equal(original.genusNames[0].otuId, null)
  assert.equal(original.speciesNames[1].otuId, 1447207)
})

test('current names stay the accepted name, linked as before', () => {
  const current = advancedParticipant(row, 'object', taxa, false, classification, true)
  assert.equal(current.genus, 'Lotus')
  assert.equal(current.species, 'dorycnium L.')
  assert.equal(current.genusNames[0].otuId, 1447000)
})
