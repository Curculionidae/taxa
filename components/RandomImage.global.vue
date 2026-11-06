<!--
  One random project image for the home page, between the two hero photos:
  same height and rounded corners, its own landscape width, never cropped.
  Links to its taxon page and carries the image's credit from TaxonWorks.
  Used in pages/home.md as <RandomImage />.

  The images are files on the site (public/images/random/), listed in
  randomImagePool.json; both are built by scripts/build-random-images.mjs
  (`npm run random-images`), which keeps one landscape image per OTU, with an
  attribution, no data depiction. Loading one is as fast as the hero photos:
  no TaxonWorks requests.

  Credit: a line over the bottom of the photo on a dark gradient. Where the
  photo is too narrow for it (phones), a © button shows instead, which opens
  the credit in a bar at the bottom of the screen.
-->
<template>
  <ClientOnly>
    <div
      v-if="picked"
      class="random-image"
      :style="shapeStyle"
    >
      <RouterLink
        class="random-image__link"
        :to="{ name: 'otus-id', params: { id: picked.otuId } }"
        :title="picked.name"
      >
        <img
          :src="picked.file"
          :alt="picked.name"
          :width="picked.width"
          :height="picked.height"
        />
      </RouterLink>

      <p class="random-image__credit">
        {{ credit.text
        }}<a
          v-if="credit.license"
          :href="picked.licenseUrl"
          target="_blank"
          rel="noopener noreferrer"
          >{{ credit.license }}</a
        >
      </p>

      <button
        type="button"
        class="random-image__credit-button"
        aria-label="Image credit"
        :aria-expanded="isCreditOpen"
        @click="isCreditOpen = !isCreditOpen"
      >
        ©
      </button>

      <Teleport to="body">
        <p
          v-if="isCreditOpen"
          class="random-image__credit-toast"
          role="status"
        >
          <span>
            {{ credit.text
            }}<a
              v-if="credit.license"
              :href="picked.licenseUrl"
              target="_blank"
              rel="noopener noreferrer"
              >{{ credit.license }}</a
            >
          </span>
          <button
            type="button"
            aria-label="Close"
            @click="isCreditOpen = false"
          >
            ×
          </button>
        </p>
      </Teleport>
    </div>
  </ClientOnly>
</template>

<script setup>
import { ref } from 'vue'
import pool from './randomImagePool.json'
import './random-image-tokens.css'

// The hero photos are 500 × 333 with a 34 px corner radius (measured from
// the PNGs, whose corners are baked in).
const HERO_WIDTH = 500
const HERO_ASPECT = 1.5
const CORNER_OF_HEIGHT = 34 / 333

const picked = pool.length
  ? pool[Math.floor(Math.random() * pool.length)]
  : null

const isCreditOpen = ref(false)

const aspect = picked ? picked.width / picked.height : HERO_ASPECT

// Wider than the heroes by its aspect, so at full size and when the row
// shrinks (in proportion to each item's basis) all three stay the same
// height. The corner radius in % of width shrinks with the aspect to stay
// the same in pixels.
const shapeStyle = {
  aspectRatio: `${aspect}`,
  flex: `0 1 ${(HERO_WIDTH * aspect) / HERO_ASPECT}px`,
  borderRadius: `${(CORNER_OF_HEIGHT * 100) / aspect}% / ${CORNER_OF_HEIGHT * 100}%`
}

// "©2025 Jane Doe. License: CC BY 4.0" → text plus the license name, which
// is shown as the link to the license.
const credit = (() => {
  const label = picked?.credit || ''
  const match = label.match(/^(.*?)\s*License:\s*(.+)$/)

  if (!match || !picked.licenseUrl) return { text: label, license: null }

  return { text: match[1] ? `${match[1]} ` : '', license: match[2] }
})()
</script>

<style scoped>
.random-image {
  position: relative;
  /* The row would otherwise stretch the box to its own height. */
  align-self: center;
  overflow: hidden;
  container-type: inline-size;
}

.random-image__link {
  display: block;
  width: 100%;
  height: 100%;
}

/* The page's markdown styles give every img a vertical margin, which would
   push the photo down inside the clipped box. */
.random-image__link img {
  display: block;
  margin: 0;
  width: 100%;
  height: 100%;
}

/* The credit over the bottom of the photo, on a gradient that darkens it,
   so white text reads on light and dark photos alike. */
.random-image__credit {
  position: absolute;
  inset: auto 0 0 0;
  margin: 0;
  padding: 1.75rem 1rem 0.5rem;
  background: linear-gradient(to top, var(--pp-photo-scrim), transparent);
  color: var(--pp-photo-credit-ink);
  font-size: 0.7rem;
  line-height: 1.35;
  text-shadow: 0 1px 2px var(--pp-photo-scrim);
  /* Clicks beside the license link go through to the photo's link. */
  pointer-events: none;
}

.random-image__credit a,
.random-image__credit-toast a {
  color: inherit;
  text-decoration: underline;
  pointer-events: auto;
}

.random-image__credit-button {
  display: none;
  position: absolute;
  right: 0.3rem;
  bottom: 0.3rem;
  width: 1.25rem;
  height: 1.25rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--pp-photo-scrim);
  color: var(--pp-photo-credit-ink);
  font-size: 0.75rem;
  cursor: pointer;
}

/* Too narrow for a readable line (phones): the © button instead. */
@container (max-width: 280px) {
  .random-image__credit {
    display: none;
  }

  .random-image__credit-button {
    display: flex;
  }
}

.random-image__credit-toast {
  position: fixed;
  inset: auto 1rem 1rem 1rem;
  z-index: 50;
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  background: var(--pp-photo-scrim);
  color: var(--pp-photo-credit-ink);
  font-size: 0.8rem;
  line-height: 1.4;
}

.random-image__credit-toast button {
  margin-left: auto;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}
</style>
