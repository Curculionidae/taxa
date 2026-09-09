import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeBiologicalAssociation } from './makeBiologicalAssociation.js'

// Real API shapes captured from /biological_associations?extend[]=object,subject
// on sfg.taxonworks.org (project 40). A CO/FO subject/object serialises its
// determination in a plain `otu_tag` span (no authorship) and its object_label
// is a catalog string, so the label cell must come from the specimen's DWC
// scientificName instead.

const FO_SUBJECT = {
  base_class: 'FieldOccurrence',
  id: 5000,
  object_tag:
    '<span class="feedback feedback-thin feedback-info">1</span>&nbsp;<span class="feedback feedback-thin">det. <span class="otu_tag"><i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i>&nbsp;<b>Hypera arator</b></span> by Jilg on 2022-7-24</span>',
  object_label:
    'FieldOccurrence 5000; 7034fcb2-1bdb-4c02-93fd-f3e54b8c4733; Germany: Brandenburg\n16248 Oderberg, Germany, 2022/07/24\nJakob Jilg'
}

const OTU_OBJECT = {
  base_class: 'Otu',
  id: 1383723,
  object_tag: '<span class="otu_tag"><i>Dianthus carthusianorum</i> L.</span>',
  object_label: 'Dianthus carthusianorum L.'
}

const baseData = {
  id: 253118,
  subject: FO_SUBJECT,
  object: OTU_OBJECT,
  biological_relationship: { name: 'collected from' }
}

const basic = { subject_otu_id: 1411454, object_otu_id: 1383723 }

test('CO/FO label uses the DWC scientificName (italic name + roman authorship), not the catalog string', () => {
  const locality = new Map([
    ['FieldOccurrence:5000', { scientificName: 'Hypera (Kippenbergia) arator (Linnaeus, 1758)' }]
  ])

  const ba = makeBiologicalAssociation(baseData, [], [], [], basic, locality)

  assert.equal(ba.subjectLabelPrefix, null)
  assert.equal(
    ba.subjectSpeciesHtml,
    '<i>Hypera (Kippenbergia) arator</i> (Linnaeus, 1758)'
  )
  // OTU link + specimen modal wiring preserved
  assert.equal(ba.subjectOtuId, 1411454)
  assert.equal(ba.subjectSpecimenType, 'FieldOccurrence')
  assert.equal(ba.subjectSpecimenId, 5000)
  // no leak of the raw "FieldOccurrence 5000; <uuid>; …" string
  assert.ok(!ba.subjectSpeciesHtml.includes('FieldOccurrence 5000'))
})

test('an AnatomicalPart wrapping a CO/FO keeps its part-name prefix and links the DWC name', () => {
  const data = {
    ...baseData,
    subject: {
      base_class: 'AnatomicalPart',
      id: 99,
      object_tag: '<span>nidus: <span class="otu_tag"><i>Hypera arator</i></span></span>',
      object_label: 'nidus: FieldOccurrence 4996; 1234abcd; Germany'
    }
  }
  const locality = new Map([
    ['FieldOccurrence:4996', { scientificName: 'Hypera (Kippenbergia) arator (Linnaeus, 1758)' }]
  ])

  const ba = makeBiologicalAssociation(data, [], [], [], basic, locality)

  assert.equal(ba.subjectLabelPrefix, 'Nidus of ')
  assert.equal(
    ba.subjectSpeciesHtml,
    '<i>Hypera (Kippenbergia) arator</i> (Linnaeus, 1758)'
  )
  assert.equal(ba.subjectSpecimenType, 'FieldOccurrence')
  assert.equal(ba.subjectSpecimenId, 4996)
})

test('OTU entities are unchanged (no specimen name in play)', () => {
  const ba = makeBiologicalAssociation(baseData, [], [], [], basic, new Map())

  // object is the Dianthus OTU — extractNameHtml has no otu_tag_taxon_name
  // span to match here, so it falls back to object_label exactly as before
  assert.equal(ba.objectLabelPrefix, null)
  assert.equal(ba.objectSpeciesHtml, 'Dianthus carthusianorum L.')
  assert.equal(ba.objectOtuId, 1383723)
  assert.equal(ba.objectSpecimenType, null)
})

test('AnatomicalPart of a taxon (no wrapped specimen) splits into a part prefix + name', () => {
  const data = {
    ...baseData,
    subject: {
      base_class: 'AnatomicalPart',
      id: 42,
      object_tag:
        '<span>larvae: <span class="otu_tag"><i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i> (Linnaeus, 1758)</span></span>',
      object_label: 'larvae: Hypera (Kippenbergia) arator (Linnaeus, 1758)'
    }
  }

  const ba = makeBiologicalAssociation(data, [], [], [], basic, new Map())

  // resolveSpecimenRef finds no CollectionObject/FieldOccurrence token, so
  // there is no specimen name and no ⓘ button; the part name is still pulled
  // off as a prefix and the ": " head dropped from the body (same shape the
  // specimen-wrapping and name-span AnatomicalPart cases already produce).
  assert.equal(ba.subjectSpecimenType, null)
  assert.equal(ba.subjectLabelPrefix, 'Larvae of ')
  assert.equal(
    ba.subjectSpeciesHtml,
    'Hypera (Kippenbergia) arator (Linnaeus, 1758)'
  )
})

test('CO/FO with no DWC record falls back to the raw label (documents the gap)', () => {
  const ba = makeBiologicalAssociation(baseData, [], [], [], basic, new Map())

  assert.equal(ba.subjectLabelPrefix, null)
  assert.equal(ba.subjectSpeciesHtml, FO_SUBJECT.object_label)
})

test('a CollectionObject and a FieldOccurrence sharing a numeric id do not collide', () => {
  // Two associations on the same page: one whose subject is CollectionObject
  // 5000, one whose subject is FieldOccurrence 5000. Keyed by id alone the
  // second would overwrite the first; keyed by type+id they stay separate.
  const locality = new Map([
    ['CollectionObject:5000', { scientificName: 'Larinus latus (Herbst, 1783)', recordedBy: 'Smith' }],
    ['FieldOccurrence:5000', { scientificName: 'Hypera arator (Linnaeus, 1758)', recordedBy: 'Jilg' }]
  ])

  const coRow = { ...baseData, subject: { ...FO_SUBJECT, base_class: 'CollectionObject', id: 5000 } }
  const foRow = { ...baseData, subject: { ...FO_SUBJECT, base_class: 'FieldOccurrence', id: 5000 } }

  const co = makeBiologicalAssociation(coRow, [], [], [], basic, locality)
  const fo = makeBiologicalAssociation(foRow, [], [], [], basic, locality)

  assert.equal(co.subjectSpeciesHtml, '<i>Larinus latus</i> (Herbst, 1783)')
  assert.equal(co.subjectCollector, 'Smith')
  assert.equal(fo.subjectSpeciesHtml, '<i>Hypera arator</i> (Linnaeus, 1758)')
  assert.equal(fo.subjectCollector, 'Jilg')
})

test('AnatomicalPart fallback (no DWC, no name span) keeps the part-name prefix and drops the catalog head', () => {
  const data = {
    ...baseData,
    subject: {
      base_class: 'AnatomicalPart',
      id: 99,
      object_tag: '<span>nidus: <span class="otu_tag">FieldOccurrence 4996</span></span>',
      object_label: 'nidus: FieldOccurrence 4996; 1234abcd-0000; Germany'
    }
  }

  const ba = makeBiologicalAssociation(data, [], [], [], basic, new Map())

  assert.equal(ba.subjectLabelPrefix, 'Nidus of ')
  assert.equal(ba.subjectSpeciesHtml, 'FieldOccurrence 4996; 1234abcd-0000; Germany')
  assert.ok(!ba.subjectSpeciesHtml.startsWith('nidus:'))
})
