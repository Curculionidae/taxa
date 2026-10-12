import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getRelationshipKind,
  getStatusKind,
  describeCitedOn
} from './citationLabels.js'

const relationship = (type) =>
  getRelationshipKind(`TaxonNameRelationship::${type}`)
const status = (type) => getStatusKind(`TaxonNameClassification::${type}`)

describe('getRelationshipKind', () => {
  it('names the kind of relationship', () => {
    assert.equal(relationship('Iczn::Invalidating::Synonym::Subjective'), 'Synonymy')
    assert.equal(relationship('Iczn::Invalidating::Synonym'), 'Synonymy')
    assert.equal(
      relationship('Iczn::Invalidating::Synonym::Objective::ReplacedHomonym'),
      'Synonymy'
    )
    assert.equal(relationship('Iczn::Invalidating::Homonym::Primary'), 'Homonymy')
    assert.equal(relationship('Iczn::Invalidating::Usage::Misspelling'), 'Misspelling')
    assert.equal(
      relationship('Iczn::Invalidating::Usage::IncorrectOriginalSpelling'),
      'Incorrect original spelling'
    )
    assert.equal(
      relationship('Typification::Genus::Subsequent::SubsequentDesignation'),
      'Type species'
    )
    assert.equal(relationship('Typification::Family'), 'Type genus')
    assert.equal(relationship('OriginalCombination::OriginalGenus'), 'Original combination')
    assert.equal(relationship('Combination::Species'), 'Combination')
    assert.equal(relationship('SourceClassifiedAs'), 'Classified as')
    assert.equal(relationship('Iczn::Invalidating::Misapplication'), 'Misapplication')
    assert.equal(relationship('Iczn::Validating::UncertainPlacement'), 'Uncertain placement')
  })

  it('falls back to the last part of a type it does not know', () => {
    assert.equal(relationship('Iczn::Invalidating'), 'Invalidating')
    assert.equal(relationship('Iczn::Some::BrandNewThing'), 'Brand new thing')
  })

  it('has nothing to say without a type', () => {
    assert.equal(getRelationshipKind(undefined), undefined)
  })
})

describe('getStatusKind', () => {
  it('names the status', () => {
    assert.equal(status('Iczn::Available::Valid'), 'Valid')
    assert.equal(status('Iczn::Available::Valid::NomenDubium'), 'Nomen dubium')
    assert.equal(status('Iczn::Available::Invalid::Homonym'), 'Homonym')
    assert.equal(status('Iczn::Unavailable::NomenNudum::NoDescription'), 'Nomen nudum')
    assert.equal(status('Iczn::Unavailable::NomenNudum'), 'Nomen nudum')
    assert.equal(
      status('Iczn::Unavailable::Suppressed::OfficialIndexOfRejectedGenericNamesInZoology'),
      'Suppressed'
    )
    assert.equal(status('Iczn::Unavailable'), 'Unavailable')
  })

  it('does not call grammar a status', () => {
    assert.equal(status('Latinized::Gender::Feminine'), 'Gender: feminine')
    assert.equal(
      status('Latinized::PartOfSpeech::Adjective'),
      'Part of speech: adjective'
    )
  })
})

describe('describeCitedOn', () => {
  it('labels a name citation by what it is', () => {
    assert.equal(describeCitedOn({ type: 'TaxonName' }).label, 'Nomenclature')
    assert.equal(
      describeCitedOn({ type: 'TaxonName', kind: 'original' }).label,
      'Original description'
    )
    assert.equal(
      describeCitedOn({ type: 'TaxonName', kind: 'misspelling' }).label,
      'Misspelling'
    )
    assert.equal(
      describeCitedOn({ type: 'TaxonName', kind: 'combination' }).label,
      'New combination'
    )
  })

  it('uses the kind of a relationship or status as the label', () => {
    assert.equal(
      describeCitedOn({ type: 'TaxonNameRelationship', kind: 'Synonymy' }).label,
      'Synonymy'
    )
    assert.equal(
      describeCitedOn({ type: 'TaxonNameRelationship' }).label,
      'Name relationship'
    )
    assert.equal(
      describeCitedOn({ type: 'TaxonNameClassification', kind: 'Valid' }).label,
      'Valid'
    )
    assert.match(
      describeCitedOn({ type: 'TaxonNameClassification', kind: 'Valid' }).help,
      /status of this name: valid/
    )
    assert.match(
      describeCitedOn({ type: 'TaxonNameClassification', kind: 'Gender: feminine' })
        .help,
      /grammar/
    )
  })

  it('labels a type TaxonWorks adds later by its class name', () => {
    const { label, help } = describeCitedOn({ type: 'FieldOccurrence' })

    assert.equal(label, 'Field occurrence')
    assert.match(help, /Field occurrence/)
  })

  it('adds the topics of the citation to the hover text', () => {
    const { help } = describeCitedOn({
      type: 'Otu',
      topics: [
        { name: 'Distribution', definition: 'Where it lives.' },
        { name: 'Notes' }
      ]
    })

    assert.match(help, /cited on the taxon itself/)
    assert.match(help, /Distribution \(Where it lives\.\)/)
    assert.match(help, /Notes/)
  })
})
