import { test } from 'node:test'
import assert from 'node:assert/strict'

import { figureImageId, figureKey } from './images.js'

test('figureImageId: numeric TW image id from a lead figure original_png', () => {
  assert.equal(
    figureImageId({ original_png: '/api/v1/images/1199100/scale_to_box/0/0/706/584/706/584' }),
    1199100
  )
})

test('figureImageId: null when there is no original_png / no numeric id', () => {
  assert.equal(figureImageId({}), null)
  assert.equal(figureImageId(null), null)
  assert.equal(figureImageId({ original_png: '' }), null)
  assert.equal(figureImageId({ original: 'https://www.inaturalist.org/photos/9' }), null)
})

test('figureKey: img:<id> when resolvable, else a URL fallback', () => {
  assert.equal(
    figureKey({ original_png: '/api/v1/images/1199100/scale_to_box/x' }),
    'img:1199100'
  )
  assert.equal(figureKey({ thumb: 'https://sfg.taxonworks.org/s/abc' }), 'https://sfg.taxonworks.org/s/abc')
  assert.equal(figureKey(null), '')
})
