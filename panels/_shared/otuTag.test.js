import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractOtuTagSpan } from './otuTag.js'

test('extractOtuTagSpan: extracts inner HTML of an otu_tag_taxon_name span', () => {
  const tag = '<span class="otu_tag_taxon_name" title="x"><i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i> (Linnaeus, 1758)</span> <span>&#10003;</span>'
  assert.equal(
    extractOtuTagSpan(tag),
    '<i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i> (Linnaeus, 1758)'
  )
})

test('extractOtuTagSpan: extracts inner HTML of an otu_tag_otu_name span', () => {
  const tag = '<span class="otu_tag_otu_name">Brentidae (except Nanophyinae)</span>'
  assert.equal(extractOtuTagSpan(tag), 'Brentidae (except Nanophyinae)')
})

test('extractOtuTagSpan: excludes a trailing valid-name marker outside the span', () => {
  const tag = '<span class="otu_tag_taxon_name"><i>Dianthus carthusianorum</i> L.</span>&#10003;'
  assert.equal(extractOtuTagSpan(tag), '<i>Dianthus carthusianorum</i> L.')
})

test('extractOtuTagSpan: no matching span -> null', () => {
  assert.equal(extractOtuTagSpan('<span class="something_else">x</span>'), null)
})

test('extractOtuTagSpan: null/empty input -> null', () => {
  assert.equal(extractOtuTagSpan(null), null)
  assert.equal(extractOtuTagSpan(''), null)
})
