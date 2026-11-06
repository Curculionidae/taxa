<!--
  One random project image for the home page, cropped to the shape of the
  hero photos next to it (3:2, rounded corners) and linking to its taxon
  page. Used in pages/home.md as <RandomImage />.

  Draws from public/random-images.json, built ahead of time by
  scripts/build-random-images.mjs (`npm run random-images`), which keeps only
  roughly 3:2 images that link to an OTU and are no data depiction. So picking
  one costs no TaxonWorks lookups.

  TaxonWorks' ready-made `medium` copy (300 px wide) shows at once; a sharp
  copy is scaled on request, which takes the server about 2 s, and replaces
  it once loaded.
-->
<template>
  <ClientOnly>
    <RouterLink
      v-if="picked"
      class="random-image bg-base-muted"
      :to="{ name: 'otus-id', params: { id: picked.otuId } }"
      :title="picked.name"
    >
      <img
        :src="src"
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

// The hero photos are 500 × 333. The sharp copy is 1.5× that, so it stays
// crisp on high-density screens.
const BOX_WIDTH = 750
const BOX_HEIGHT = 500

const picked = ref(null)
const src = ref('')
const failed = ref(false)

// A scaled copy just large enough to cover the 3:2 box.
function sharpImageUrl({ id, width, height }) {
  const scale = Math.min(1, Math.max(BOX_WIDTH / width, BOX_HEIGHT / height))
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const { baseURL, params } = makeAPIRequest.defaults

  return `${baseURL}/images/${id}/scale_to_box/0/0/${width}/${height}/${w}/${h}?project_token=${params.project_token}`
}

onMounted(async () => {
  try {
    const response = await fetch('/random-images.json')
    const pool = await response.json()

    if (!pool.length) throw new Error('Empty pool')

    const image = pool[Math.floor(Math.random() * pool.length)]

    picked.value = image
    src.value = image.medium

    const sharp = new Image()

    sharp.onload = () => {
      src.value = sharp.src
    }
    sharp.src = sharpImageUrl(image)
  } catch {
    failed.value = true
  }
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
