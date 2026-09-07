import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ISO_NAME, NAME_ALIASES_DISPLAY, GEOGRAPHY_PRESETS, EUROPEAN_RUSSIA
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
