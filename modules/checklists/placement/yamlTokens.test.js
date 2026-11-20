import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tokenizeYamlLine, tokenizeYaml } from './yamlTokens.js'

const kinds = (line) => tokenizeYamlLine(line).filter((t) => t.kind !== 'space').map((t) => [t.kind, t.text])

test('a rule line: dash, keys, flow map, value, comment', () => {
  assert.deepEqual(kinds('  - match: { tdwg: 12FRA }   # GA 33696 France, 867 records'), [
    ['dash', '-'], ['key', 'match'], ['colon', ':'], ['bracket', '{'], ['key', 'tdwg'], ['colon', ':'],
    ['text', '12FRA'], ['bracket', '}'], ['comment', '# GA 33696 France, 867 records']
  ])
})

test('strings, numbers, booleans and flow lists', () => {
  assert.deepEqual(kinds('    measured: "Russia 100% (2026-11-20)"'), [['key', 'measured'], ['colon', ':'], ['string', '"Russia 100% (2026-11-20)"']])
  assert.deepEqual(kinds('coastal_tolerance_degrees: 0.05'), [['key', 'coastal_tolerance_degrees'], ['colon', ':'], ['number', '0.05']])
  assert.deepEqual(kinds('      rest: true'), [['key', 'rest'], ['colon', ':'], ['boolean', 'true']])
  assert.deepEqual(kinds('    box: [-55, 1.8, -51, 6.2]'), [
    ['key', 'box'], ['colon', ':'], ['bracket', '['], ['number', '-55'], ['bracket', ','], ['number', '1.8'],
    ['bracket', ','], ['number', '-51'], ['bracket', ','], ['number', '6.2'], ['bracket', ']']
  ])
  assert.deepEqual(kinds('  - ["Virgin Islands, U.S.", U.S. Virgin Is.]'), [
    ['dash', '-'], ['bracket', '['], ['string', '"Virgin Islands, U.S."'], ['bracket', ','], ['text', 'U.S. Virgin Is.'], ['bracket', ']']
  ])
})

test('outside a flow, commas and colons inside a value stay text; # inside a word or quotes is no comment', () => {
  assert.deepEqual(kinds('    why: approximately; TDWG France also covers Jersey and Guernsey'), [
    ['key', 'why'], ['colon', ':'], ['text', 'approximately; TDWG France also covers Jersey and Guernsey']
  ])
  assert.deepEqual(kinds('    why: a, b [c]'), [['key', 'why'], ['colon', ':'], ['text', 'a, b [c]']])
  assert.deepEqual(kinds('    not_placeable: "x # y"'), [['key', 'not_placeable'], ['colon', ':'], ['string', '"x # y"']])
  assert.deepEqual(kinds('  - match: { gazetteer_prefix: "TAAF:" }'), [
    ['dash', '-'], ['key', 'match'], ['colon', ':'], ['bracket', '{'], ['key', 'gazetteer_prefix'], ['colon', ':'],
    ['string', '"TAAF:"'], ['bracket', '}']
  ])
  assert.deepEqual(kinds("  - [\"Côte d'Ivoire\", Ivory Coast]").map(([kind]) => kind), ['dash', 'bracket', 'string', 'bracket', 'text', 'bracket'])
})

test('every line of the real rules file comes back unchanged, with no endless loop', () => {
  const text = readFileSync(new URL('../rules/placement.yml', import.meta.url), 'utf8')
  const lines = tokenizeYaml(text)
  assert.equal(lines.length, text.replace(/\n$/, '').split('\n').length)
  lines.forEach((tokens, index) => assert.equal(tokens.map((t) => t.text).join(''), text.replace(/\n$/, '').split('\n')[index], `line ${index + 1}`))
  assert.ok(lines.flat().some((t) => t.kind === 'comment') && lines.flat().some((t) => t.kind === 'key'))
})
