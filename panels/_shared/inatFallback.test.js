import { test } from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { parseName, resolveInatTaxonId, makeTaxonPhotoImage, makeObservationImage } from './inatFallback.js'

function stubAxiosGet(handler) {
  const original = axios.get
  axios.get = handler
  return () => { axios.get = original }
}

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

test('resolveInatTaxonId: caches by name|rank, second call makes no new request', async () => {
  let calls = 0
  const restore = stubAxiosGet(async () => {
    calls++
    return { data: { results: [{ name: 'Aus bus', id: 555 }] } }
  })
  try {
    const id1 = await resolveInatTaxonId('Aus bus', 'species')
    const id2 = await resolveInatTaxonId('Aus bus', 'species')
    assert.equal(id1, 555)
    assert.equal(id2, 555)
    assert.equal(calls, 1)
  } finally {
    restore()
  }
})

test('resolveInatTaxonId: concurrent callers before either settles share one request', async () => {
  let calls = 0
  let resolveGet
  const restore = stubAxiosGet(() => new Promise((resolve) => {
    calls++
    resolveGet = () => resolve({ data: { results: [{ name: 'Concurrent bus', id: 777 }] } })
  }))
  try {
    const p1 = resolveInatTaxonId('Concurrent bus', 'species')
    const p2 = resolveInatTaxonId('Concurrent bus', 'species')
    resolveGet()
    const [id1, id2] = await Promise.all([p1, p2])
    assert.equal(id1, 777)
    assert.equal(id2, 777)
    assert.equal(calls, 1)
  } finally {
    restore()
  }
})

test('resolveInatTaxonId: no name -> null, no request', async () => {
  const restore = stubAxiosGet(async () => { throw new Error('should not be called') })
  try {
    assert.equal(await resolveInatTaxonId(null), null)
  } finally {
    restore()
  }
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
