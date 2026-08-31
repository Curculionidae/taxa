import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSurname,
  parseAuthorYear,
  matchKey,
  matchTier,
  keysMatch
} from './gbifNameMatch.js'

test('normalizeSurname strips initials, particles, glued initials, year', () => {
  assert.equal(normalizeSurname('Herbst'), 'herbst')
  assert.equal(normalizeSurname('J.F.W.Herbst, 1783'), 'herbst')
  assert.equal(normalizeSurname('Herbst, J.F.W.'), 'herbst')
  assert.equal(normalizeSurname('(P.Rossi, 1790)'), 'rossi')
  assert.equal(normalizeSurname('de Motschulsky, 1866'), 'motschulsky')
  assert.equal(normalizeSurname('Gyllenhal & Schoenherr'), 'gyllenhal')
  assert.equal(normalizeSurname('Olivier, 1807, auct. non Olivier'), 'olivier')
  assert.equal(normalizeSurname(''), '')
  assert.equal(normalizeSurname(undefined), '')
})

test('parseAuthorYear extracts a 4-digit year and the surname', () => {
  assert.deepEqual(parseAuthorYear('Larinus latus (Herbst, 1783)'), {
    surname: 'herbst',
    year: 1783
  })
  assert.deepEqual(parseAuthorYear('Larinus subcostatus Brullé, 1832'), {
    surname: 'brullé',
    year: 1832
  })
  assert.equal(parseAuthorYear('Lixus longirostris').year, null)
})

test('matchKey is genus independent', () => {
  assert.equal(
    matchKey('Larinus latus (Herbst, 1783)'),
    matchKey('Curculio latus Herbst, 1783')
  )
  assert.equal(matchKey('Larinus latus', { author: '(Herbst, 1783)' }), 'latus|herbst|1783')
})

test('matchKey keeps homonyms apart', () => {
  assert.notEqual(
    matchKey('Lixus cardui (Rossi, 1790)'),
    matchKey('Lixus cardui Aurivillius, 1921')
  )
})

test('matchTier: homotypic when the original combination is in the CoL name set', () => {
  const tw = matchKey('Larinus latus', { author: '(Herbst, 1783)' })
  const col = matchKey('Larinus latus (Herbst, J.F.W., 1783)')
  assert.equal(
    matchTier(tw, col, {
      twOriginalCombination: 'Curculio latus Herbst, 1783',
      colNameStrings: [
        'Larinus latus (Herbst, J.F.W., 1783)',
        'Curculio latus Herbst, J.F.W., 1783'
      ]
    }),
    'homotypic'
  )
})

test('matchTier: probable on epithet + surname + year, one year tolerance', () => {
  const tw = matchKey('Larinus mutabilis', { author: 'Host, 1789' })
  const col = matchKey('Curculio mutabilis Host, N., 1790')
  assert.equal(matchTier(tw, col, {}), 'probable')
})

test('matchTier: weak when only the epithet stem matches', () => {
  const tw = matchKey('Larinus gibbosus', { author: 'Fabricius, 1801' })
  const col = matchKey('Larinus gibbosa Germar, 1824')
  assert.equal(matchTier(tw, col, {}), 'weak')
})

test('matchTier: none when nothing matches', () => {
  assert.equal(matchTier('latus|herbst|1783', 'cardui|rossi|1790', {}), 'none')
})

test('keysMatch: exact, within one year, missing year, and mismatches', () => {
  assert.equal(keysMatch('latus|herbst|1783', 'latus|herbst|1783'), true)
  assert.equal(keysMatch('mutabilis|host|1789', 'mutabilis|host|1790'), true)
  assert.equal(keysMatch('mutabilis|host|1789', 'mutabilis|host|1795'), false)
  assert.equal(keysMatch('latus|herbst|', 'latus|herbst|1783'), true)
  assert.equal(keysMatch('cardui|rossi|1790', 'cardui|aurivillius|1921'), false)
  assert.equal(keysMatch('latus|herbst|1783', 'cardui|rossi|1790'), false)
})
