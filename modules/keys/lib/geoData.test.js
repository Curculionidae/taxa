import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ISO_NAME, NAME_ALIASES_DISPLAY, ISO_ALIAS_SPELLINGS, DIVERGENT_SPELLING_ISOS,
  GEOGRAPHY_PRESETS, EUROPEAN_RUSSIA
} from './geoData.js'

test('ISO_NAME keys are 2-letter uppercase, values non-empty', () => {
  for (const [k, v] of Object.entries(ISO_NAME)) {
    assert.match(k, /^[A-Z]{2}$/)
    assert.ok(v && typeof v === 'string')
  }
})

test('every NAME_ALIASES_DISPLAY target is a known ISO code or the euro-russia slug', () => {
  const known = new Set(Object.keys(ISO_NAME))
  for (const iso of Object.values(NAME_ALIASES_DISPLAY)) {
    assert.ok(known.has(iso), `alias target ${iso} not in ISO_NAME`)
  }
})

test('every GEOGRAPHY_PRESETS member resolves to a known country or a known slug', () => {
  const known = new Set([...Object.keys(ISO_NAME), EUROPEAN_RUSSIA.key])
  for (const g of GEOGRAPHY_PRESETS) {
    assert.ok(g.id && g.label && Array.isArray(g.members))
    for (const m of g.members) assert.ok(known.has(m), `${g.id} member ${m} unknown`)
  }
})

test('GEOGRAPHY_PRESETS ids are unique', () => {
  const ids = GEOGRAPHY_PRESETS.map((g) => g.id)
  assert.equal(new Set(ids).size, ids.length)
})

// Freezes the reconciliation between the canonical ISO_NAME label and the
// spelling the project's dwc_occurrences.country column actually stores. Each
// of these returns zero rows under its canonical name.
test('cache country spellings are reachable through the alias table', () => {
  const cases = [
    ['Macedonia', 'MK'],
    ['Ivory Coast', 'CI'],
    ['Bosnia and Herz.', 'BA'],
    ['Congo', 'CG']
  ]
  for (const [spelling, iso] of cases) {
    assert.equal(
      NAME_ALIASES_DISPLAY[spelling], iso,
      `${spelling} must alias to ${iso}`
    )
    assert.ok(
      (ISO_ALIAS_SPELLINGS[iso] || []).includes(spelling),
      `${spelling} must be listed under ISO_ALIAS_SPELLINGS.${iso}`
    )
  }
})

test('ISO_ALIAS_SPELLINGS is exactly NAME_ALIASES_DISPLAY grouped by ISO', () => {
  const flat = Object.values(ISO_ALIAS_SPELLINGS).flat()
  assert.equal(flat.length, Object.keys(NAME_ALIASES_DISPLAY).length)
  for (const [iso, spellings] of Object.entries(ISO_ALIAS_SPELLINGS)) {
    for (const s of spellings) assert.equal(NAME_ALIASES_DISPLAY[s], iso)
  }
})

// The lazy per country probe has no "European Russia" country value, so a slug
// member would always probe zero (design spec section 7).
test('GEOGRAPHY_PRESETS members are ISO codes only, no slugs', () => {
  const europe = GEOGRAPHY_PRESETS.find((g) => g.id === 'europe')
  assert.ok(europe, 'the europe preset must exist')
  assert.ok(!europe.members.includes(EUROPEAN_RUSSIA.key))
  for (const g of GEOGRAPHY_PRESETS) {
    for (const m of g.members) assert.match(m, /^[A-Z]{2}$/)
  }
})

// Every divergent-spelling ISO must be a real country that actually carries
// alias spellings to fall through to (otherwise the allow-list entry is inert).
test('DIVERGENT_SPELLING_ISOS members are known ISO codes with alias spellings', () => {
  for (const iso of DIVERGENT_SPELLING_ISOS) {
    assert.ok(ISO_NAME[iso], `${iso} must be in ISO_NAME`)
    assert.ok(
      (ISO_ALIAS_SPELLINGS[iso] || []).length > 0,
      `${iso} must have at least one alias spelling`
    )
  }
})
