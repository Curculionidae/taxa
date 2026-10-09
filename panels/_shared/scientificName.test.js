import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  escHtml,
  splitScientificName,
  scientificNameHtml,
  typeStatusHtml
} from './scientificName.js'

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

// ── Where the name ends ──

test('splitScientificName: lowercase author particles belong to the authorship', () => {
  for (const [name, italic, plain] of [
    ['Aus bus de Geer, 1775', 'Aus bus', 'de Geer, 1775'],
    ['Aus bus von Heyden, 1870', 'Aus bus', 'von Heyden, 1870'],
    ['Aus bus van der Hoeven, 1830', 'Aus bus', 'van der Hoeven, 1830'],
    ["Aus bus d'Orbigny, 1840", 'Aus bus', "d'Orbigny, 1840"],
    ['Aus bus (de Geer, 1775)', 'Aus bus', '(de Geer, 1775)'],
    ['Aus bus sensu Smith, 1900', 'Aus bus', 'sensu Smith, 1900'],
    ['Aus bus auct. non Smith', 'Aus bus', 'auct. non Smith']
  ]) {
    assert.deepEqual(splitScientificName(name), { italic, plain }, name)
  }
})

test('splitScientificName: subspecies, hyphenated and diacritic epithets', () => {
  assert.deepEqual(splitScientificName('Aus bus cus Smith, 1900'), { italic: 'Aus bus cus', plain: 'Smith, 1900' })
  assert.deepEqual(splitScientificName('Aus novae-zelandiae Smith, 1900'), { italic: 'Aus novae-zelandiae', plain: 'Smith, 1900' })
  assert.deepEqual(splitScientificName('Aus mülleri Smith'), { italic: 'Aus mülleri', plain: 'Smith' })
})

test('splitScientificName: genus alone, and genus + subgenus with no epithet', () => {
  assert.deepEqual(splitScientificName('Otiorhynchus Germar, 1822'), { italic: 'Otiorhynchus', plain: 'Germar, 1822' })
  assert.deepEqual(splitScientificName('Otiorhynchus'), { italic: 'Otiorhynchus', plain: '' })
  assert.deepEqual(splitScientificName('Hypera (Kippenbergia) Capiomont, 1868'), {
    italic: 'Hypera (Kippenbergia)',
    plain: 'Capiomont, 1868'
  })
  // A parenthesised author straight after a genus is not a subgenus
  assert.deepEqual(splitScientificName('Aus (Linnaeus, 1758)'), { italic: 'Aus', plain: '(Linnaeus, 1758)' })
})

test('splitScientificName: names above genus rank are not italic', () => {
  for (const name of [
    'Curculionidae Latreille, 1802',
    'Entiminae Schoenherr, 1823',
    'Otiorhynchini Schoenherr, 1826',
    'Curculionoidea',
    'Asteraceae',
    'Brentidae (except Nanophyinae)'
  ]) {
    assert.deepEqual(splitScientificName(name), { italic: '', plain: name }, name)
  }
  // No tell-tale suffix: only the rank can say so
  assert.deepEqual(splitScientificName('Coleoptera Linnaeus, 1758', { rank: 'order' }), {
    italic: '',
    plain: 'Coleoptera Linnaeus, 1758'
  })
  assert.deepEqual(splitScientificName('Aus bus Smith', { rank: 'species' }), { italic: 'Aus bus', plain: 'Smith' })
})

test('splitScientificName: text that is not a name is left plain', () => {
  assert.deepEqual(splitScientificName('unidentified weevil'), { italic: '', plain: 'unidentified weevil' })
  assert.deepEqual(splitScientificName('FieldOccurrence 4996; abc'), { italic: '', plain: 'FieldOccurrence 4996; abc' })
  assert.deepEqual(splitScientificName(''), { italic: '', plain: '' })
  assert.deepEqual(splitScientificName(null), { italic: '', plain: '' })
})

// ── HTML: connectors inside a name stay upright ──

test('scientificNameHtml: italic name, escaped upright authorship', () => {
  assert.equal(scientificNameHtml('Aus bus Smith & Jones, 1900'), '<em>Aus bus</em> Smith &amp; Jones, 1900')
  assert.equal(scientificNameHtml('Aus bus de Geer, 1775', { tag: 'i' }), '<i>Aus bus</i> de Geer, 1775')
  assert.equal(scientificNameHtml('Curculionidae Latreille, 1802'), 'Curculionidae Latreille, 1802')
  assert.equal(scientificNameHtml(null), '')
})

test('scientificNameHtml: rank markers and qualifiers are not italic, the epithets around them are', () => {
  assert.equal(scientificNameHtml('Aus bus subsp. cus Smith'), '<em>Aus bus</em> subsp. <em>cus</em> Smith')
  assert.equal(scientificNameHtml('Aus cf. bus'), '<em>Aus</em> cf. <em>bus</em>')
  assert.equal(scientificNameHtml('Aus sp.'), '<em>Aus</em> sp.')
  assert.equal(scientificNameHtml('Aus bus [sic] Author, 1900'), '<em>Aus bus</em> [sic] Author, 1900')
  assert.equal(scientificNameHtml('Aus × bus Smith'), '<em>Aus</em> × <em>bus</em> Smith')
  assert.equal(scientificNameHtml('† Centron moricollis Scudder, 1893'), '† <em>Centron moricollis</em> Scudder, 1893')
})

test('splitScientificName: an unrecognised rank falls back to the spelling', () => {
  assert.deepEqual(splitScientificName('Curculionidae Latreille, 1802', { rank: 'legion' }), {
    italic: '',
    plain: 'Curculionidae Latreille, 1802'
  })
  // A recognised genus-or-lower rank wins over the spelling
  assert.deepEqual(splitScientificName('Ausini Smith', { rank: 'genus' }), { italic: 'Ausini', plain: 'Smith' })
})
