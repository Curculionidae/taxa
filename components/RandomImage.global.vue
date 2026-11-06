<!--
  One random project image for the home page, cropped to the shape of the
  hero photos next to it (3:2, rounded corners) and linking to its taxon
  page. Used in pages/home.md as <RandomImage />.

  Picks a random image from the whole project. An image counts when it
  depicts an OTU or a specimen (CollectionObject / FieldOccurrence) whose DwC
  record names an OTU. Skipped, and another one drawn:
  - data depictions (label photos and the like), read from /depictions,
    since the image list does not carry the flag;
  - specimens without an OTU, e.g. undetermined type specimens: nothing in
    the API links those to a taxon page.
-->
<template>
  <ClientOnly>
    <RouterLink
      v-if="picked"
      class="random-image"
      :to="{ name: 'otus-id', params: { id: picked.otuId } }"
      :title="picked.name"
    >
      <img
        :src="picked.src"
        :alt="picked.name"
      />
    </RouterLink>
    <div
      v-else-if="!failed"
      class="random-image bg-base-muted"
      aria-hidden="true"
    />
  </ClientOnly>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { makeAPIRequest } from '@/utils/request'

// The hero photos are 500 × 333. The image is fetched at 1.5× that, so it
// stays sharp on high-density screens.
const BOX_WIDTH = 750
const BOX_HEIGHT = 500

const MAX_TRIES = 6

const picked = ref(null)
const failed = ref(false)

function randomInt(max) {
  return Math.floor(Math.random() * max)
}

function stripTags(html = '') {
  const div = document.createElement('div')

  div.innerHTML = html

  return div.textContent.trim()
}

// A scaled copy just large enough to cover the 3:2 box, so the crop is sharp.
function scaledImageUrl({ id, width, height }) {
  const scale = Math.min(1, Math.max(BOX_WIDTH / width, BOX_HEIGHT / height))
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const { baseURL, params } = makeAPIRequest.defaults

  return `${baseURL}/images/${id}/scale_to_box/0/0/${width}/${height}/${w}/${h}?project_token=${params.project_token}`
}

async function otuIdOf(depictions) {
  const otu = depictions.find((d) => d.depiction_object_type === 'Otu')

  if (otu) return otu.depiction_object_id

  const specimen = depictions.find((d) =>
    ['CollectionObject', 'FieldOccurrence'].includes(d.depiction_object_type)
  )

  if (!specimen) return null

  const path =
    specimen.depiction_object_type === 'CollectionObject'
      ? 'collection_objects'
      : 'field_occurrences'
  const { data } = await makeAPIRequest.get(
    `/${path}/${specimen.depiction_object_id}/dwc`
  )

  return data.otu_id ?? null
}

async function tryOnce(total) {
  const { data: images } = await makeAPIRequest.get('/images', {
    params: { per: 1, page: randomInt(total) + 1 }
  })
  const image = images[0]

  if (!image?.width || !image?.height) return null

  const { data: depictions } = await makeAPIRequest.get('/depictions', {
    params: { 'image_id[]': image.id }
  })

  if (depictions.some((d) => d.is_metadata_depiction)) return null

  const otuId = await otuIdOf(depictions)

  if (!otuId) return null

  const { data: otu } = await makeAPIRequest.get(`/otus/${otuId}`)

  return {
    otuId,
    name: stripTags(otu.object_tag) || otu.name || '',
    src: scaledImageUrl(image)
  }
}

onMounted(async () => {
  try {
    const { headers } = await makeAPIRequest.get('/images', {
      params: { per: 1 }
    })
    const total = Number(headers['pagination-total'])

    if (!total) throw new Error('No images')

    for (let i = 0; i < MAX_TRIES && !picked.value; i++) {
      picked.value = await tryOnce(total).catch(() => null)
    }
  } catch {}

  if (!picked.value) failed.value = true
})
</script>

<style scoped>
/* Same shape as the hero PNGs, whose rounded corners are baked in:
   500 × 333 with a corner radius of 34 px (measured). */
.random-image {
  display: block;
  flex: 0 1 500px;
  /* The row would otherwise stretch the box to its own height. */
  align-self: center;
  aspect-ratio: 500 / 333;
  border-radius: 6.8% / 10.2%;
  overflow: hidden;
}

/* The page's markdown styles give every img a vertical margin, which would
   push the photo down inside the clipped box. */
.random-image img {
  margin: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
