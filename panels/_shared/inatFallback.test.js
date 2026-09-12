import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseName, makeTaxonPhotoImage, makeObservationImage } from './inatFallback.js'

test('parseName: plain "Genus species"', () => {
  assert.deepEqual(parseName('Otiorhynchus carinatopunctatus'), {
    genus: 'Otiorhynchus',
    subgenus: null,
    epithet: 'carinatopunctatus'
  })
})

test('parseName: "Genus (Subgenus) species"', () => {
  assert.deepEqual(parseName('Otiorhynchus (Nihus) carinatopunctatus'), {
    genus: 'Otiorhynchus',
    subgenus: 'Nihus',
    epithet: 'carinatopunctatus'
  })
})

test('parseName: subgenus only, no epithet', () => {
  assert.deepEqual(parseName('Otiorhynchus (Nihus)'), {
    genus: 'Otiorhynchus',
    subgenus: 'Nihus',
    epithet: null
  })
})

test('parseName: null/undefined input', () => {
  assert.deepEqual(parseName(null), { genus: '', subgenus: null, epithet: null })
  assert.deepEqual(parseName(undefined), { genus: '', subgenus: null, epithet: null })
})

test('makeTaxonPhotoImage: builds an ImageLightbox-shaped object with medium', () => {
  const img = makeTaxonPhotoImage({
    photo: { id: 42, medium_url: 'https://x/medium.jpg', url: 'https://x/square.jpg' },
    taxon: { name: 'Aus bus' }
  })
  assert.equal(img.id, 42)
  assert.equal(img.thumb, 'https://x/medium.jpg')
  assert.equal(img.medium, 'https://x/medium.jpg')
  assert.deepEqual(img.depictions, [{ label: 'Aus bus' }])
  assert.ok(img.source.label.includes('inaturalist.org/photos/42'))
})

test('makeObservationImage: builds an ImageLightbox-shaped object', () => {
  const img = makeObservationImage(
    { id: 7, taxon: { name: 'Aus bus' } },
    { id: 99, url: 'https://x/square.jpg' }
  )
  assert.equal(img.id, 99)
  assert.equal(img.thumb, 'https://x/medium.jpg')
  assert.equal(img.original, 'https://x/original.jpg')
  assert.deepEqual(img.depictions, [{ label: 'Aus bus' }])
  assert.ok(img.source.label.includes('inaturalist.org/observations/7'))
})
