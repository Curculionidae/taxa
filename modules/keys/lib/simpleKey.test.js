import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citationFullText, primarySource, looksLikeSimpleKey } from './simpleKey.js'

test('citationFullText prefers the source text', () => {
  assert.equal(citationFullText({ source: { cached: 'A' }, citation_source_body: 'B' }), 'A')
  assert.equal(citationFullText({ citation_source_body: 'B' }), 'B')
  assert.equal(citationFullText(null), '')
})

test('primarySource: origin citation first, root citation only for simple keys', () => {
  assert.equal(primarySource({ originCitation: 'O', isSimpleKey: true, rootCitations: ['R'] }), 'O')
  assert.equal(primarySource({ originCitation: null, isSimpleKey: true, rootCitations: ['', 'R'] }), 'R')
  assert.equal(primarySource({ originCitation: null, isSimpleKey: false, rootCitations: ['R'] }), null)
  assert.equal(primarySource({ originCitation: null, isSimpleKey: true }), null)
})

test('looksLikeSimpleKey: root with flat OTU children', () => {
  const leads = {
    35019: { text: 'Key', parent_id: null, target_type: 'internal' },
    35020: { text: null, parent_id: 35019, target_type: '/api/v1/otus', target_id: 1 },
    35021: { text: null, parent_id: 35019, target_type: '/api/v1/otus', target_id: 2 }
  }
  assert.equal(looksLikeSimpleKey(leads), true)
})

test('looksLikeSimpleKey: a couplet key is not simple', () => {
  const leads = {
    1: { text: 'Key', parent_id: null, target_type: 'internal' },
    2: { text: 'Elytra red', parent_id: 1, target_type: '/api/v1/otus', target_id: 1 },
    3: { text: 'Elytra black', parent_id: 1, target_type: 'internal' },
    4: { text: 'Large', parent_id: 3, target_type: '/api/v1/otus', target_id: 2 }
  }
  assert.equal(looksLikeSimpleKey(leads), false)
  assert.equal(looksLikeSimpleKey({ 1: { text: 'Key', parent_id: null } }), false)
  assert.equal(looksLikeSimpleKey(null), false)
})
