import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractOtuTagSpan, identifiedAsNameHtml, repeatsTypeStatusName } from './otuTag.js'

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

test('identifiedAsNameHtml: name before the "now" marker of a synonym OTU tag, TaxonWorks italics kept', () => {
  const tag = '<span class="otu_tag"><i>Otiorhynchus</i> (<i>Arammichnus</i>) <i>dieckmanni</i> Magnano, 1979 <em>now</em> <i>Otiorhynchus</i> (<i>Arammichnus</i>) <i>indefinitus</i> Reitter, 1912</span>'
  assert.equal(
    identifiedAsNameHtml(tag),
    '<i>Otiorhynchus</i> (<i>Arammichnus</i>) <i>dieckmanni</i> Magnano, 1979'
  )
})

test('identifiedAsNameHtml: lowercase author particle stays outside the italics', () => {
  const tag = '<span class="otu_tag"><i>Aus bus</i> de Geer, 1775 <em>now</em> <i>Aus cus</i> Roe, 1800</span>'
  assert.equal(identifiedAsNameHtml(tag), '<i>Aus bus</i> de Geer, 1775')
})

test('identifiedAsNameHtml: entities pass through untouched, named and numeric', () => {
  const tag = '<span class="otu_tag"><i>Aus &#215;bus</i> Smith &amp; Jones, 1900 <em>now</em> <i>Aus cus</i> Roe, 1800</span>'
  assert.equal(identifiedAsNameHtml(tag), '<i>Aus &#215;bus</i> Smith &amp; Jones, 1900')
})

test('identifiedAsNameHtml: any tag other than <i> is dropped', () => {
  const tag = '<span class="otu_tag"><i>Aus bus</i> <a href="x" onclick="y">Smith</a><script>z</script>, 1900 <em>now</em> <i>Aus cus</i></span>'
  assert.equal(identifiedAsNameHtml(tag), '<i>Aus bus</i> Smithz, 1900')
})

test('identifiedAsNameHtml: valid-name OTU (no "now" marker) -> null', () => {
  const tag = '<span class="otu_tag"><i>Otiorhynchus</i> (<i>Arammichnus</i>) <i>indefinitus</i> Reitter, 1912</span>'
  assert.equal(identifiedAsNameHtml(tag), null)
})

test('identifiedAsNameHtml: null/empty input -> null', () => {
  assert.equal(identifiedAsNameHtml(null), null)
  assert.equal(identifiedAsNameHtml(''), null)
})

test('identifiedAsNameHtml: an OTU with its own name contributes only the taxon name', () => {
  const tag = '<span class="otu_tag"><span class="otu_tag_otu_name">my otu</span>: <span class="otu_tag_taxon_name"><i>Aus bus</i> Smith <em>now</em> <i>Aus cus</i> Roe</span></span>'
  assert.equal(identifiedAsNameHtml(tag), '<i>Aus bus</i> Smith')
})

test('repeatsTypeStatusName: identified-as name equals the type status name', () => {
  assert.equal(
    repeatsTypeStatusName(
      '<i>Afghanocleonus kabakovi</i> Ter-Minassian, 1976',
      'paratype of Afghanocleonus kabakovi Ter-Minassian, 1976'
    ),
    true
  )
})

test('repeatsTypeStatusName: entities and spacing do not break the match', () => {
  assert.equal(
    repeatsTypeStatusName('<i>Aus bus</i> Smith &amp; Jones,  1900', 'holotype of Aus bus Smith & Jones, 1900'),
    true
  )
})

test('repeatsTypeStatusName: a different name is not a repeat', () => {
  assert.equal(repeatsTypeStatusName('<i>Aus cus</i> Jones, 1950', 'paratype of Aus bus Smith, 1900'), false)
})

test('repeatsTypeStatusName: bare type status names no taxon', () => {
  assert.equal(repeatsTypeStatusName('<i>Aus bus</i> Smith, 1900', 'paratype'), false)
})

test('repeatsTypeStatusName: nothing identified-as, or no type status -> false', () => {
  assert.equal(repeatsTypeStatusName(null, 'paratype of Aus bus Smith, 1900'), false)
  assert.equal(repeatsTypeStatusName('<i>Aus bus</i> Smith, 1900', null), false)
})
