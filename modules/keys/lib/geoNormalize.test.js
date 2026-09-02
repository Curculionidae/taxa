import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeShape,
  normalizeCountryString,
  nameToIso
} from './geoNormalize.js'

// Shapes below are trimmed captures of real
// /asserted_distributions?otu_id[]=732686 asserted_distribution_shape objects.

test('country shape with iso_3166_a2 -> that ISO2', () => {
  assert.deepEqual(
    normalizeShape({
      name: 'Ukraine',
      type: 'GeographicArea',
      iso_3166_a2: 'UA',
      geographic_area_type: { name: 'Country' },
      parent: { name: 'Earth' }
    }),
    { key: 'UA', label: 'Ukraine' }
  )
})

test('TDWG Level 2 region -> null (not resolvable to a territory)', () => {
  assert.equal(
    normalizeShape({
      name: 'Caucasus',
      type: 'GeographicArea',
      iso_3166_a2: null,
      geographic_area_type: { name: 'TDWG Level 2' },
      parent: { name: 'Asia Temperate' }
    }),
    null
  )
  assert.equal(
    normalizeShape({
      name: 'Eastern Europe',
      geographic_area_type: { name: 'TDWG Level 2' },
      parent: { name: 'Europe' }
    }),
    null
  )
})

test('"European Russia" gazetteer (carries iso RU) -> russia-european, not RU', () => {
  assert.deepEqual(
    normalizeShape({
      name: 'European Russia',
      type: 'Gazetteer',
      iso_3166_a2: 'RU',
      geographic_area_type: null,
      parent: null
    }),
    { key: 'russia-european', label: 'European Russia' }
  )
})

test('TDWG Level 3 "Central European Russia" (no iso) -> russia-european', () => {
  assert.deepEqual(
    normalizeShape({
      name: 'Central European Russia',
      iso_3166_a2: null,
      geographic_area_type: { name: 'TDWG Level 3' },
      parent: { name: 'Eastern Europe' }
    }),
    { key: 'russia-european', label: 'European Russia' }
  )
})

test('Asian Russia subregion -> its own slug key, kept out of Europe', () => {
  assert.deepEqual(
    normalizeShape({
      name: 'West Siberia',
      geographic_area_type: { name: 'TDWG Level 3' },
      parent: { name: 'Siberia' }
    }),
    { key: 'west-siberia', label: 'West Siberia' }
  )
})

test('bare "Russia" country shape -> RU', () => {
  assert.deepEqual(
    normalizeShape({
      name: 'Russia',
      type: 'GeographicArea',
      iso_3166_a2: null,
      geographic_area_type: { name: 'Country' },
      parent: { name: 'Earth' }
    }),
    { key: 'RU', label: 'Russia' }
  )
})

test('TDWG Level 4 with no iso resolves via parent country name', () => {
  assert.deepEqual(
    normalizeShape({
      name: 'Austria',
      geographic_area_type: { name: 'TDWG Level 4' },
      iso_3166_a2: null,
      parent: { name: 'Austria' },
      level0_id: null
    }),
    { key: 'AT', label: 'Austria' }
  )
})

test('subdivision shape ("Unknown" type) resolves via parent country name', () => {
  assert.deepEqual(
    normalizeShape({
      name: 'Baden-Württemberg',
      geographic_area_type: { name: 'Unknown' },
      iso_3166_a2: null,
      parent: { name: 'Germany' },
      level0_id: 84
    }),
    { key: 'DE', label: 'Germany' }
  )
})

test('TDWG Level 3 whose name is itself a country resolves by name', () => {
  assert.deepEqual(
    normalizeShape({
      name: 'Italy',
      geographic_area_type: { name: 'TDWG Level 3' },
      iso_3166_a2: null,
      parent: { name: 'Southeastern Europe' }
    }),
    { key: 'IT', label: 'Italy' }
  )
})

test('gazetteer with no iso and a non-country name -> null', () => {
  assert.equal(
    normalizeShape({
      name: 'Illyria',
      type: 'Gazetteer',
      iso_3166_a2: null,
      geographic_area_type: null,
      parent: null
    }),
    null
  )
})

test('missing / empty shape -> null', () => {
  assert.equal(normalizeShape(null), null)
  assert.equal(normalizeShape({}), null)
  assert.equal(normalizeShape({ name: '' }), null)
})

test('normalizeCountryString: aliases and direct names', () => {
  assert.deepEqual(normalizeCountryString('United States'), {
    key: 'US',
    label: 'United States'
  })
  assert.deepEqual(normalizeCountryString('England'), {
    key: 'GB',
    label: 'United Kingdom'
  })
  assert.deepEqual(normalizeCountryString('Czechia'), {
    key: 'CZ',
    label: 'Czech Republic'
  })
  assert.deepEqual(normalizeCountryString('Germany'), {
    key: 'DE',
    label: 'Germany'
  })
})

test('normalizeCountryString: bare "Russia" -> RU (no European guess for specimens)', () => {
  assert.deepEqual(normalizeCountryString('Russia'), { key: 'RU', label: 'Russia' })
})

test('normalizeCountryString: unknown / empty -> null', () => {
  assert.equal(normalizeCountryString(''), null)
  assert.equal(normalizeCountryString(null), null)
  assert.equal(normalizeCountryString('Atlantis'), null)
})

test('nameToIso is case- and whitespace-insensitive', () => {
  assert.equal(nameToIso('  ukraine '), 'UA')
  assert.equal(nameToIso('SPAIN'), 'ES')
  assert.equal(nameToIso('nowhere'), null)
})
