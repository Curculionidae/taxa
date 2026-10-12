import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractOtuTagSpan,
  identifiedAsNameHtml,
  otuOwnName,
  otuDisplayNameHtml,
  otuDistinctOwnName,
  otuLinksToTaxonPage,
  otuTaxonLabel,
  repeatsTypeStatusName
} from './otuTag.js'

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

test('otuOwnName: the bold OTU name of an OTU that also has a taxon name', () => {
  assert.equal(otuOwnName('<span class="otu_tag"><i>Carex</i>&nbsp;<b>Carex sp.</b></span>'), 'Carex sp.')
})

test('otuOwnName: synonym OTU repeats the name after "now", first one is taken', () => {
  const tag = '<span class="otu_tag"><i>Knautia sylvatica</i> (L.) Duby&nbsp;<b>Knautia silvatica</b> <em>now</em> <i>Knautia drymeja</i> Heuff.&nbsp;<b>Knautia silvatica</b></span>'
  assert.equal(otuOwnName(tag), 'Knautia silvatica')
})

test('otuOwnName: taxon name only, or no tag -> null', () => {
  assert.equal(otuOwnName('<span class="otu_tag"><i>Pseudostenapion simum</i> (Germar, 1817)</span>'), null)
  assert.equal(otuOwnName(null), null)
})

// Live tag shapes from sfg.taxonworks.org, 2026-10-12.
const CAREX = '<span class="otu_tag"><i>Carex</i>&nbsp;<b>Carex sp.</b></span>'
const CYCAS = '<span class="otu_tag"><b>Cycas sp.</b></span>'
const KNAUTIA = '<span class="otu_tag"><i>Knautia sylvatica</i> (L.) Duby&nbsp;<b>Knautia silvatica</b> <em>now</em> <i>Knautia drymeja</i> Heuff.&nbsp;<b>Knautia silvatica</b></span>'

test('extractOtuTagSpan: reads the plain otu_tag span TaxonWorks sends now', () => {
  assert.equal(
    extractOtuTagSpan('<span class="otu_tag"><i>Eudiagogus rosenschoeldi</i> Fåhraeus, 1840</span>'),
    '<i>Eudiagogus rosenschoeldi</i> Fåhraeus, 1840'
  )
  assert.equal(extractOtuTagSpan(CAREX), '<i>Carex</i>&nbsp;<b>Carex sp.</b>')
})

test('extractOtuTagSpan: the determination inside a specimen tag', () => {
  const tag = '<span class="feedback">1</span>&nbsp;<span class="feedback">det. <span class="otu_tag"><i>Bagous subruber</i> Reitter, 1890</span> by Meregalli</span>'
  assert.equal(extractOtuTagSpan(tag), '<i>Bagous subruber</i> Reitter, 1890')
})

test('extractOtuTagSpan: an inner otu_tag_taxon_name span still wins over the outer otu_tag', () => {
  const tag = '<span class="otu_tag"><span class="otu_tag_taxon_name" title="x"><i>Aus bus</i> Smith</span> &#10003;</span>'
  assert.equal(extractOtuTagSpan(tag), '<i>Aus bus</i> Smith')
})

const ISATIS = '<span class="otu_tag"><i>Isatis tinctoria</i>&nbsp;<b>Isatis tinctoria</b></span>'
const HYPERA = '<i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i>&nbsp;<b>Hypera arator</b>'
const GENUS = '<span class="otu_tag"><i>Carex</i> L.</span>'

test('own name that differs from the taxon name: shown alone, links to the taxon page', () => {
  assert.equal(otuDistinctOwnName(CAREX), 'Carex sp.')
  assert.equal(otuDisplayNameHtml(CAREX), 'Carex sp.')
  assert.equal(otuDisplayNameHtml('<i>Carex</i>&nbsp;<b>Carex sp.</b>'), 'Carex sp.')
  assert.equal(otuLinksToTaxonPage(CAREX), true)
  assert.equal(otuDisplayNameHtml(KNAUTIA), 'Knautia silvatica')
  assert.equal(otuLinksToTaxonPage(KNAUTIA), true)
})

test('own name that repeats the taxon name: the taxon name, own link', () => {
  assert.equal(otuDistinctOwnName(ISATIS), null)
  assert.equal(otuDisplayNameHtml(ISATIS), '<span class="otu_tag"><i>Isatis tinctoria</i></span>')
  assert.equal(otuLinksToTaxonPage(ISATIS), false)
  // a subgenus in the taxon name does not make it another name
  assert.equal(otuDistinctOwnName(HYPERA), null)
  assert.equal(otuDisplayNameHtml(HYPERA), '<i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i>')
})

test('a higher taxon repeats when the taxon name starts with the own name', () => {
  const same = '<span class="otu_tag">Brentidae Billberg, 1820&nbsp;<b>Brentidae</b></span>'
  const differs = '<span class="otu_tag">Brentidae Billberg, 1820&nbsp;<b>Brentidae (except Nanophyinae)</b></span>'
  assert.equal(otuDistinctOwnName(same), null)
  assert.equal(otuDistinctOwnName(differs), 'Brentidae (except Nanophyinae)')
  assert.equal(otuLinksToTaxonPage(differs), true)
})

test('own name only: that name, escaped plain text, own link', () => {
  assert.equal(otuDistinctOwnName(CYCAS), 'Cycas sp.')
  assert.equal(otuDisplayNameHtml(CYCAS), 'Cycas sp.')
  assert.equal(otuLinksToTaxonPage(CYCAS), false)
  assert.equal(otuDisplayNameHtml('<b>Aus &amp; <i>bus</i> &lt;x&gt;</b>'), 'Aus &amp; bus &lt;x&gt;')
})

test('taxon name only is untouched', () => {
  assert.equal(otuDistinctOwnName(GENUS), null)
  assert.equal(otuDisplayNameHtml(GENUS), GENUS)
  assert.equal(otuLinksToTaxonPage(GENUS), false)
  assert.equal(otuDisplayNameHtml(null), null)
  assert.equal(otuLinksToTaxonPage(null), false)
})

test('otuTaxonLabel: cuts a trailing own name off the label', () => {
  assert.equal(otuTaxonLabel('Isatis tinctoria L. Isatis tinctoria', ISATIS), 'Isatis tinctoria L.')
  assert.equal(otuTaxonLabel('Carex L.', GENUS), 'Carex L.')
  assert.equal(otuTaxonLabel('Cycas sp.', CYCAS), 'Cycas sp.')
  assert.equal(otuTaxonLabel(null, null), '')
})

test('identifiedAsNameHtml: the own name of a synonym OTU is not part of the old name', () => {
  assert.equal(identifiedAsNameHtml(KNAUTIA), '<i>Knautia sylvatica</i> (L.) Duby')
})
