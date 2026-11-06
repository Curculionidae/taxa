import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getAllPages } from './pagedGet.js'

// pages: array of row arrays; answers with the pagination header TaxonWorks sends
function pagedApi(pages) {
  const asked = []
  const get = async (url, { params }) => {
    asked.push(params.page)
    return {
      data: pages[params.page - 1] || [],
      headers: { 'pagination-total-pages': String(pages.length) }
    }
  }
  return { get, asked }
}

test('getAllPages: follows pagination-total-pages and keeps the row order', async () => {
  const { get, asked } = pagedApi([[{ id: 1 }, { id: 2 }], [{ id: 3 }]])
  const rows = await getAllPages(get, '/taxon_names', { name: 'ater' }, { per: 2 })
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3])
  assert.deepEqual(asked, [1, 2])
})

test('getAllPages: one request when there is no pagination header', async () => {
  let calls = 0
  const get = async () => { calls++; return { data: [{ id: 1 }] } }
  assert.deepEqual(await getAllPages(get, '/x', {}), [{ id: 1 }])
  assert.equal(calls, 1)
})

test('getAllPages: rejects when a page fails', async () => {
  const get = async (url, { params }) => {
    if (params.page === 2) throw new Error('timeout')
    return { data: [{ id: 1 }], headers: { 'pagination-total-pages': '2' } }
  }
  await assert.rejects(getAllPages(get, '/x', {}))
})
