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

test('bare "Siberia" region -> null (not the country RU)', () => {
  assert.equal(
    normalizeShape({
      name: 'Siberia',
      geographic_area_type: { name: 'TDWG Level 2' },
      parent: { name: 'Asia Temperate' }
    }),
    null
  )
  assert.equal(
    normalizeShape({ name: 'Central Siberia', geographic_area_type: { name: 'TDWG Level 3' } }),
    null
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

// A GADM / Natural Earth sub-national unit can carry the exact name of an
// unrelated sovereign state. It must not be mistaken for that country: it
// carries GADM hierarchy pointers (level0_id / level1_id / level2_id) to a
// level-0 country that is not itself. Real captures from project 40's
// asserted distributions.

test('GADM municipality named like a country, parent not a country -> null', () => {
  // GeographicArea 6771: the municipality of "Albania" in Caqueta, Colombia.
  assert.equal(
    normalizeShape({
      name: 'Albania',
      geographic_area_type: { name: 'Municipality' },
      iso_3166_a2: null,
      data_origin: 'gadm',
      level0_id: 50,
      level1_id: 5832,
      level2_id: 6771,
      id: 6771,
      parent: { name: 'Caquetá' }
    }),
    null
  )
})

test('sub-national unit named like a country resolves to its real parent country', () => {
  // GeographicArea 33457: the US state of "Georgia" (Natural Earth), NOT the
  // Caucasus country GE.
  assert.deepEqual(
    normalizeShape({
      name: 'Georgia',
      geographic_area_type: { name: 'State' },
      iso_3166_a2: null,
      data_origin: 'ne_states',
      level0_id: 33412,
      level1_id: null,
      level2_id: null,
      id: 33457,
      parent: { name: 'United States of America' }
    }),
    { key: 'US', label: 'United States' }
  )
})

test('GADM shire named like a country, parent not a country -> null', () => {
  // GeographicArea 3859: the Shire of "Denmark" in Western Australia.
  assert.equal(
    normalizeShape({
      name: 'Denmark',
      geographic_area_type: { name: 'Shire' },
      iso_3166_a2: null,
      data_origin: 'gadm',
      level0_id: 15,
      level1_id: 307,
      level2_id: 3859,
      id: 3859,
      parent: { name: 'Western Australia' }
    }),
    null
  )
})

test('GADM district whose parent IS the eponymous country still resolves (step 5)', () => {
  // GeographicArea 8051: a district of Djibouti. Flagged sub-national at step 4,
  // but the parent name carries it.
  assert.deepEqual(
    normalizeShape({
      name: 'Djibouti',
      geographic_area_type: { name: 'District' },
      iso_3166_a2: null,
      data_origin: 'gadm',
      level0_id: 63,
      level1_id: 8050,
      level2_id: 8051,
      id: 8051,
      parent: { name: 'Djibouti' }
    }),
    { key: 'DJ', label: 'Djibouti' }
  )
})

test('Natural Earth country record (no iso, level0_id === id) still resolves by name', () => {
  // GeographicArea 24651 "Syria" etc.: NE country rows in this project carry no
  // iso_3166_a2 but level0_id equal to their own id. The sub-national guard
  // must not suppress them.
  assert.deepEqual(
    normalizeShape({
      name: 'Syria',
      geographic_area_type: { name: 'Country' },
      iso_3166_a2: null,
      data_origin: 'ne_countries',
      level0_id: 24651,
      level1_id: null,
      level2_id: null,
      id: 24651,
      parent: { name: 'Earth' }
    }),
    { key: 'SY', label: 'Syria' }
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
