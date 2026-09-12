import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escHtml, splitScientificName, typeStatusHtml } from './scientificName.js'

test('escHtml: escapes &, <, > and is null/undefined-safe', () => {
  assert.equal(escHtml('A & B <em>x</em>'), 'A &amp; B &lt;em&gt;x&lt;/em&gt;')
  assert.equal(escHtml(null), '')
  assert.equal(escHtml(undefined), '')
  assert.equal(escHtml(''), '')
})

test('splitScientificName: plain "Genus species Author, Year"', () => {
  assert.deepEqual(splitScientificName('Larinus latus Herbst, 1783'), {
    italic: 'Larinus latus',
    plain: 'Herbst, 1783'
  })
})

test('splitScientificName: subgenus in parens stays in the italic part', () => {
  assert.deepEqual(splitScientificName('Hypera (Kippenbergia) arator (Linnaeus, 1758)'), {
    italic: 'Hypera (Kippenbergia) arator',
    plain: '(Linnaeus, 1758)'
  })
})

test('splitScientificName: bracketed qualifier stays in the italic part', () => {
  assert.deepEqual(splitScientificName('Aus bus [sic] Author, 1900'), {
    italic: 'Aus bus [sic]',
    plain: 'Author, 1900'
  })
})

test('typeStatusHtml: splits on the LAST " of ", not the first', () => {
  // Regression case: "one of the syntypes of ..." has an earlier " of " that
  // must not be mistaken for the name/status boundary.
  assert.equal(
    typeStatusHtml('one of the syntypes of Aus bus Author, 1900'),
    'one of the syntypes of <em>Aus bus</em> Author, 1900'
  )
})

test('typeStatusHtml: simple "holotype of Genus species Author, Year"', () => {
  assert.equal(
    typeStatusHtml('holotype of Bothynoderus communis Motschulsky, 1860'),
    'holotype of <em>Bothynoderus communis</em> Motschulsky, 1860'
  )
})

test('typeStatusHtml: custom wrapping tag', () => {
  assert.equal(
    typeStatusHtml('holotype of Aus bus Author, 1900', { tag: 'i' }),
    'holotype of <i>Aus bus</i> Author, 1900'
  )
})

test('typeStatusHtml: no " of " -> escaped as-is', () => {
  assert.equal(typeStatusHtml('paratype'), 'paratype')
})

test('typeStatusHtml: empty/null -> empty string', () => {
  assert.equal(typeStatusHtml(''), '')
  assert.equal(typeStatusHtml(null), '')
})
