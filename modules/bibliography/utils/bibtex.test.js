import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toBibtex } from './bibtex.js'

const source = (fields) => ({
  id: 1,
  bibtex_type: 'article',
  author: 'Meregalli, M.',
  year: 2009,
  title: 'A title',
  ...fields
})

describe('toBibtex', () => {
  it('writes one entry with its fields', () => {
    const bib = toBibtex([
      source({
        journal: 'Zootaxa',
        volume: '2011',
        pages: '1–37',
        month: 'feb',
        doi: '10.1/x_y'
      })
    ])

    assert.equal(
      bib,
      [
        '@article{Meregalli2009,',
        '  author = {Meregalli, M.},',
        '  title = {A title},',
        '  journal = {Zootaxa},',
        '  volume = {2011},',
        '  pages = {1–37},',
        '  year = {2009},',
        '  month = feb,',
        '  doi = {10.1/x_y}',
        '}',
        ''
      ].join('\n')
    )
  })

  it('turns italics into \\textit and escapes special characters', () => {
    const bib = toBibtex([
      source({
        title: 'Revision of <i>Pachycerus</i> &amp; allies: 50% done',
        publisher: 'Norstedt & Söner'
      })
    ])

    assert.match(
      bib,
      /title = \{Revision of \\textit\{Pachycerus\} \\& allies: 50\\% done\}/
    )
    assert.match(bib, /publisher = \{Norstedt \\& Söner\}/)
  })

  it('builds keys from the first author, the year and the year suffix', () => {
    const bib = toBibtex([
      source({ id: 1, author: 'Van Dyke, Edwin Cooper and Löbl, I.' }),
      source({ id: 2, author: 'Fåhraeus, O.I.', year: 1840, year_suffix: 'b' })
    ])

    assert.match(bib, /@article\{VanDyke2009,/)
    assert.match(bib, /@article\{Fahraeus1840b,/)
  })

  it('keeps keys unique', () => {
    const bib = toBibtex([
      source({ id: 1 }),
      source({ id: 2 }),
      source({ id: 3, author: 'MEREGALLI, M.' })
    ])

    assert.deepEqual(
      [...bib.matchAll(/@article\{([^,]+),/g)].map((m) => m[1]),
      ['Meregalli2009', 'Meregalli2009_2', 'MEREGALLI2009_3']
    )
  })

  it('uses the stored key when there is one, and the id when nothing else', () => {
    const bib = toBibtex([
      source({ id: 1, key: 'my:key' }),
      source({ id: 22, author: null, year: null })
    ])

    assert.match(bib, /@article\{my:key,/)
    assert.match(bib, /@article\{source22,/)
  })

  it('ignores a stored key that BibTeX cannot read', () => {
    const bib = toBibtex([source({ key: 'Aus, Bus, new species' })])

    assert.match(bib, /@article\{Meregalli2009,/)
  })

  it('keeps a comma separated author list as one literal name', () => {
    const bib = toBibtex([
      source({ author: 'Kojima, H, Lyal, CHC' }),
      source({ id: 2, author: 'Löbl, Ivan and Smetana, Ales' }),
      source({ id: 3, author: 'Kim, C.H. and And J.l., Kim' })
    ])

    assert.match(bib, /author = \{\{Kojima, H, Lyal, CHC\}\},/)
    assert.match(bib, /author = \{Löbl, Ivan and Smetana, Ales\},/)
    assert.match(bib, /author = \{\{Kim, C\.H\. and And J\.l\., Kim\}\},/)
  })

  it('exports a verbatim source as misc with its text as a note', () => {
    const bib = toBibtex([
      {
        id: 5,
        bibtex_type: null,
        verbatim: 'Labram, J.D. (1840). Singulorum generum.'
      }
    ])

    assert.match(bib, /@misc\{source5,\n {2}note = \{Labram, J\.D\. \(1840\)\. Singulorum generum\.\}\n\}/)
  })
})
