<!--
  A slideshow of random project images for the home page, between the two
  hero photos: same height and rounded corners, each image at its own
  landscape width, never cropped. The shown image links to its taxon page and
  carries its credit from TaxonWorks. Used in pages/home.md as <RandomImage />.

  Starts at a random image and moves through the pool in shuffled order every
  INTERVAL_MS, crossfading while the frame eases to the next image's width.
  The next image is loaded before the switch. Pauses while hovered, focused,
  the credit is open or the tab is hidden; stays on one image for visitors
  who ask for reduced motion.

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
      @mouseenter="isHovered = true"
      @mouseleave="isHovered = false"
      @focusin="isFocused = true"
      @focusout="isFocused = false"
    >
      <RouterLink
        class="random-image__link"
        :to="{ name: 'otus-id', params: { id: picked.otuId } }"
        :title="picked.name"
      >
        <Transition name="random-image-fade">
          <img
            :key="picked.file"
            :src="picked.file"
            :alt="picked.name"
            :width="picked.width"
            :height="picked.height"
          />
        </Transition>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import pool from './randomImagePool.json'
import './random-image-tokens.css'

const INTERVAL_MS = 6000

// The hero photos are 500 × 333 with a 34 px corner radius (measured from
// the PNGs, whose corners are baked in).
const HERO_WIDTH = 500
const HERO_ASPECT = 1.5
const CORNER_OF_HEIGHT = 34 / 333

// Fisher-Yates: every image once before any repeats.
function shuffled(list) {
  const out = [...list]

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))

    ;[out[i], out[j]] = [out[j], out[i]]
  }

  return out
}

const order = shuffled(pool)
const index = ref(0)
const picked = computed(() => order[index.value] || null)

const isCreditOpen = ref(false)
const isHovered = ref(false)
const isFocused = ref(false)
const isHidden = ref(false)

const isPaused = computed(
  () => isHovered.value || isFocused.value || isCreditOpen.value || isHidden.value
)

// Wider than the heroes by its aspect, so at full size and when the row
// shrinks (in proportion to each item's basis) all three stay the same
// height. The corner radius in % of width shrinks with the aspect to stay
// the same in pixels.
const shapeStyle = computed(() => {
  const aspect = picked.value
    ? picked.value.width / picked.value.height
    : HERO_ASPECT

  return {
    aspectRatio: `${aspect}`,
    flex: `0 1 ${(HERO_WIDTH * aspect) / HERO_ASPECT}px`,
    borderRadius: `${(CORNER_OF_HEIGHT * 100) / aspect}% / ${CORNER_OF_HEIGHT * 100}%`
  }
})

// "©2025 Jane Doe. License: CC BY 4.0" → text plus the license name, which
// is shown as the link to the license.
const credit = computed(() => {
  const label = picked.value?.credit || ''
  const match = label.match(/^(.*?)\s*License:\s*(.+)$/)

  if (!match || !picked.value.licenseUrl) return { text: label, license: null }

  return { text: match[1] ? `${match[1]} ` : '', license: match[2] }
})

let timer = null

function schedule() {
  clearTimeout(timer)
  timer = null

  if (isPaused.value || order.length < 2) return

  timer = setTimeout(showNext, INTERVAL_MS)
}

// Switches only once the next image is loaded, so it never shows half drawn.
function showNext() {
  const nextIndex = (index.value + 1) % order.length
  const preload = new Image()

  preload.onload = preload.onerror = () => {
    if (isPaused.value) return

    index.value = nextIndex
    schedule()
  }
  preload.src = order[nextIndex].file
}

function onVisibilityChange() {
  isHidden.value = document.hidden
}

let reducedMotion = false

onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reducedMotion) return

  document.addEventListener('visibilitychange', onVisibilityChange)
  schedule()
})

watch(isPaused, () => {
  if (!reducedMotion) schedule()
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<style scoped>
.random-image {
  position: relative;
  /* The row would otherwise stretch the box to its own height. */
  align-self: center;
  overflow: hidden;
  container-type: inline-size;
  /* Eases the frame to the next image's width during the crossfade. */
  transition:
    flex-basis 0.8s ease,
    aspect-ratio 0.8s ease,
    border-radius 0.8s ease;
}

/* Crossfade: the old image is lifted out of the flow and fades out over the
   new one fading in. */
.random-image-fade-enter-active,
.random-image-fade-leave-active {
  transition: opacity 0.8s ease;
}

.random-image-fade-leave-active {
  position: absolute;
  inset: 0;
}

.random-image-fade-enter-from,
.random-image-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .random-image,
  .random-image-fade-enter-active,
  .random-image-fade-leave-active {
    transition: none;
  }
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
  /* Only matters mid-transition, while the frame is between two shapes. */
  object-fit: cover;
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
