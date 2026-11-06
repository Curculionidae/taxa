// Builds the pool the home page's <RandomImage /> draws from: the images as
// WebP files 500 px tall in public/images/random/, and their list in
// components/randomImagePool.json. Run with `npm run random-images` after
// adding images in TaxonWorks. The page then loads the image from the site
// itself, as fast as the fixed hero photos, with no TaxonWorks requests.
//
// An image is kept when it
// - is landscape, between MIN_ASPECT (4:3) and MAX_ASPECT (about 16:9). It is
//   shown whole, never cropped, at the height of the hero photos;
// - is at least MIN_WIDTH wide (drops small drawings and thumbnails);
// - has no data depiction (label photos and the like);
// - depicts an OTU, or a specimen whose DwC record names an OTU. Undetermined
//   type specimens have none and are left out;
// - has an attribution in TaxonWorks (shown as the credit on the page) and a
//   license that allows the resized copy: not "no derivatives" (ND).
//
// One image per OTU (the newest), and at most MAX_IMAGES (the newest), since
// the files are committed and served from GitHub. Each entry carries the
// image's attribution line and license link from TaxonWorks. Files already
// on disk are kept, so a re-run only adds and removes what changed.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIN_ASPECT = 1.3
const MAX_ASPECT = 1.8
const MIN_WIDTH = 500
// About 35 KB per image, so 1000 stay around 35 MB.
const MAX_IMAGES = 1000
const PER = 500

// 1.5× the 333 px hero height, sharp on high-density screens.
const OUT_HEIGHT = 500

function outWidth({ width, height }) {
  return Math.round((width / height) * OUT_HEIGHT)
}

const IMAGE_DIR = fileURLToPath(new URL('../public/images/random/', import.meta.url))
const POOL_FILE = new URL('../components/randomImagePool.json', import.meta.url)

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

// An OTU tag can carry the OTU's own name after the taxon name; the taxon
// name part alone is enough.
function otuName(otu) {
  const taxonPart = (otu.object_tag || '').match(
    /<span class="otu_tag_taxon_name">(.*?)<\/span>/
  )

  return stripTags(taxonPart ? taxonPart[1] : otu.object_tag) || otu.name || ''
}

function stripTags(html = '') {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
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

const withOtu = candidates
  .map((candidate, i) => ({ ...candidate, otuId: otuIds[i] }))
  .filter((candidate) => candidate.otuId)

// The image list leaves out attribution unless asked for it.
const attributions = new Map()

for (const ids of chunks(withOtu.map(({ image }) => image.id), 100)) {
  const batch = await getAllPages('/images', [
    ...ids.map((id) => ['image_id[]', id]),
    ['extend[]', 'attribution']
  ])

  batch.forEach((image) => attributions.set(image.id, image.attribution))
}

function isUsable({ image }) {
  const attribution = attributions.get(image.id)

  return Boolean(attribution?.label) && !/-ND\b/.test(attribution.license?.name || '')
}

// Newest image first, then one per OTU, then the cap. The license check comes
// first, so an OTU whose newest image can't be used falls back to another.
const seenOtus = new Set()
const linked = withOtu
  .filter(isUsable)
  .sort((a, b) => b.image.id - a.image.id)
  .filter(({ otuId }) => !seenOtus.has(otuId) && seenOtus.add(otuId))
  .slice(0, MAX_IMAGES)

const names = new Map()

for (const ids of chunks([...new Set(linked.map((c) => c.otuId))], 100)) {
  const otus = await getAllPages('/otus', ids.map((id) => ['otu_id[]', id]))

  otus.forEach((otu) => names.set(otu.id, otuName(otu)))
}

// Fetched scaled down by TaxonWorks (a full-size original can be many MB),
// then sized to exactly OUT_HEIGHT tall, uncropped, and saved as WebP.
async function saveImage(image) {
  const { id, width, height } = image

  if (existsSync(`${IMAGE_DIR}${id}.webp`)) return true

  const w = outWidth(image)
  const h = OUT_HEIGHT
  const query = new URLSearchParams({ project_token: TOKEN })
  const response = await fetch(
    `${BASE}/images/${id}/scale_to_box/0/0/${width}/${height}/${w}/${h}?${query}`
  )

  if (!response.ok) throw new Error(`${response.status} image ${id}`)

  execFileSync(
    'magick',
    [
      '-', '-resize', `${w}x${h}!`, '-strip', '-quality', '80',
      `${IMAGE_DIR}${id}.webp`
    ],
    { input: Buffer.from(await response.arrayBuffer()) }
  )

  return true
}

mkdirSync(IMAGE_DIR, { recursive: true })

const saved = await mapLimited(linked, 6, ({ image }) => saveImage(image))
const keep = new Set(linked.filter((_, i) => saved[i]).map(({ image }) => `${image.id}.webp`))

readdirSync(IMAGE_DIR)
  .filter((file) => !keep.has(file))
  .forEach((file) => rmSync(`${IMAGE_DIR}${file}`))

const pool = linked
  .filter((_, i) => saved[i])
  .map(({ image, otuId }) => {
    const attribution = attributions.get(image.id)

    return {
      file: `/images/random/${image.id}.webp`,
      width: outWidth(image),
      height: OUT_HEIGHT,
      otuId,
      name: names.get(otuId) || '',
      credit: attribution.label,
      licenseUrl: attribution.license?.link || null
    }
  })

writeFileSync(POOL_FILE, JSON.stringify(pool, null, 1) + '\n')

console.log(
  `${pool.length} images saved to public/images/random/ ` +
    `(${linked.length - pool.length} failed), list in components/randomImagePool.json`
)
