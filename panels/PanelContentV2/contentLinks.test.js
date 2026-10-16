import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewriteContentLinks } from './contentLinks.js'

const OPTIONS = {
  otuHref: (id) => `#/otus/${id}`,
  twBase: 'https://sfg.taxonworks.org'
}

const rewrite = (html) => rewriteContentLinks(html, OPTIONS)

test('an OTU path becomes the TaxonPages OTU page', () => {
  assert.equal(
    rewrite('<p>see <a href="/otus/723793">O. civis</a>.</p>'),
    '<p>see <a href="#/otus/723793" data-content-link="otu" data-id="723793">O. civis</a>.</p>'
  )
})

test('a source path becomes a button for the Reference modal', () => {
  const out = rewrite('<a href="/sources/118099">Kojima &amp; Morimoto, 2000</a>')
  assert.match(out, /^<button type="button" class="[^"]+" data-content-link="source" data-id="118099">/)
  assert.match(out, /Kojima &amp; Morimoto, 2000<\/button>$/)
})

test('a taxon name path becomes a button', () => {
  assert.match(rewrite('<a href="/taxon_names/7">x</a>'), /data-content-link="taxon-name" data-id="7">x<\/button>/)
})

test('any other app path goes to TaxonWorks in a new tab', () => {
  assert.equal(
    rewrite('<a href="/images/12">img</a>'),
    '<a href="https://sfg.taxonworks.org/images/12" target="_blank" rel="noopener noreferrer">img</a>'
  )
})

test('an external link opens in a new tab', () => {
  assert.equal(
    rewrite('<a href="https://doi.org/10.3897/BDJ.11.e96438">DOI</a>'),
    '<a href="https://doi.org/10.3897/BDJ.11.e96438" target="_blank" rel="noopener noreferrer">DOI</a>'
  )
})

test('a bare URL becomes a link, without trailing punctuation', () => {
  assert.equal(
    rewrite('<p>https://doi.org/10.3390/d10030059.</p>'),
    '<p><a href="https://doi.org/10.3390/d10030059" target="_blank" rel="noopener noreferrer">https://doi.org/10.3390/d10030059</a>.</p>'
  )
})

test('a URL already inside a link is not linked twice', () => {
  const html = '<a href="https://example.org">https://example.org</a>'
  assert.equal(rewrite(html).match(/<a /g).length, 1)
})

test('mailto and in-page anchors are left alone', () => {
  assert.equal(rewrite('<a href="mailto:a@b.c">mail</a>'), '<a href="mailto:a@b.c">mail</a>')
  assert.equal(rewrite('<a href="#top">top</a>'), '<a href="#top">top</a>')
})

test('empty text gives an empty string', () => {
  assert.equal(rewrite(null), '')
})
