// Builds public/random-images.json, the pool the home page's <RandomImage />
// draws from. Run with `npm run random-images` after adding images in
// TaxonWorks; the page itself then makes no lookups to pick one.
//
// An image is kept when it
// - is roughly 3:2, so the hero-shaped crop cuts off little;
// - is at least MIN_WIDTH wide (drops small drawings and thumbnails);
// - has no data depiction (label photos and the like);
// - depicts an OTU, or a specimen whose DwC record names an OTU. Undetermined
//   type specimens have none and are left out.

import { readFileSync, writeFileSync } from 'node:fs'

const MIN_ASPECT = 1.35
const MAX_ASPECT = 1.7
const MIN_WIDTH = 500
const PER = 500
const OUT = new URL('../public/random-images.json', import.meta.url)

const apiConfig = readFileSync(new URL('../config/api.yml', import.meta.url), 'utf8')
const BASE = apiConfig.match(/^\s*url:\s*['"]?([^'"\s]+)/m)[1]
const TOKEN = apiConfig.match(/^\s*project_token:\s*['"]?([^'"\s]+)/m)[1]

async function get(path, params = []) {
  const query = new URLSearchParams([['project_token', TOKEN], ...params])
  const response = await fetch(`${BASE}${path}?${query}`)

  if (!response.ok) throw new Error(`${response.status} ${path}`)

  return response.json()
}

async function getAllPages(path, params = []) {
  const all = []

  for (let page = 1; ; page++) {
    const batch = await get(path, [...params, ['per', PER], ['page', page]])

    all.push(...batch)
    if (batch.length < PER) return all
  }
}

function chunks(list, size) {
  const out = []

  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))

  return out
}

// Small pool of parallel requests, so the specimen lookups don't run one
// at a time.
async function mapLimited(list, limit, fn) {
  const results = new Array(list.length)
  let next = 0

  async function worker() {
    while (next < list.length) {
      const i = next++

      results[i] = await fn(list[i]).catch(() => null)
    }
  }

  await Promise.all(Array.from({ length: limit }, worker))

  return results
}

function stripTags(html = '') {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
}

const images = (await getAllPages('/images')).filter((image) => {
  const aspect = image.width / image.height

  return image.width >= MIN_WIDTH && aspect >= MIN_ASPECT && aspect <= MAX_ASPECT
})

console.log(`${images.length} images with a fitting shape`)

// The image list does not carry the data-depiction flag; /depictions does.
const depictions = []

for (const ids of chunks(images.map((image) => image.id), 100)) {
  depictions.push(
    ...(await getAllPages('/depictions', ids.map((id) => ['image_id[]', id])))
  )
}

const depictionsByImage = Map.groupBy(depictions, (d) => d.image_id)

const candidates = images
  .map((image) => ({ image, depictions: depictionsByImage.get(image.id) || [] }))
  .filter(({ depictions }) => !depictions.some((d) => d.is_metadata_depiction))

const DWC_PATH = {
  CollectionObject: 'collection_objects',
  FieldOccurrence: 'field_occurrences'
}

const otuIds = await mapLimited(candidates, 6, async ({ depictions }) => {
  const otu = depictions.find((d) => d.depiction_object_type === 'Otu')

  if (otu) return otu.depiction_object_id

  const specimen = depictions.find((d) => DWC_PATH[d.depiction_object_type])

  if (!specimen) return null

  const dwc = await get(
    `/${DWC_PATH[specimen.depiction_object_type]}/${specimen.depiction_object_id}/dwc`
  )

  return dwc.otu_id ?? null
})

const linked = candidates
  .map((candidate, i) => ({ ...candidate, otuId: otuIds[i] }))
  .filter((candidate) => candidate.otuId)

const names = new Map()

for (const ids of chunks([...new Set(linked.map((c) => c.otuId))], 100)) {
  const otus = await getAllPages('/otus', ids.map((id) => ['otu_id[]', id]))

  otus.forEach((otu) => names.set(otu.id, stripTags(otu.object_tag) || otu.name || ''))
}

const pool = linked.map(({ image, otuId }) => ({
  id: image.id,
  width: image.width,
  height: image.height,
  medium: image.medium,
  otuId,
  name: names.get(otuId) || ''
}))

writeFileSync(OUT, JSON.stringify(pool) + '\n')
console.log(`${pool.length} images written to public/random-images.json`)
