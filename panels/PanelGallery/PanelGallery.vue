<template>
  <VCard v-if="showCard">
    <!-- Source tabs — only when more than one source has images to offer -->
    <VCardHeader
      v-if="visibleTabs.length > 1"
      class="flex flex-wrap items-center gap-1.5 p-2"
    >
      <button
        v-for="t in visibleTabs"
        :key="t.key"
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded border text-sm transition"
        :class="activeTab === t.key
          ? 'border-secondary text-secondary bg-base-foreground'
          : 'border-base-muted text-base-soft hover:text-base-content'"
        @click="selectTab(t.key)"
      >
        <img
          v-if="t.mark"
          :src="t.mark"
          :alt="t.label"
          class="h-4 w-auto shrink-0"
        />
        {{ t.label }}
      </button>
    </VCardHeader>

    <VCardContent>
      <VSpinner v-if="activeLoading" />
      <template v-else>
        <p
          v-if="activeNote"
          class="flex items-center gap-2 text-sm text-warning mb-2"
        >
          <img
            v-if="activeMark && visibleTabs.length <= 1"
            :src="activeMark"
            alt=""
            class="h-6 w-auto shrink-0"
          />
          <span>{{ activeNote }}</span>
        </p>

        <template v-if="currentImage">
          <GalleryMainImage
            :image="currentImage"
            @open:viewer="isViewerOpen = true"
          />
          <div class="flex flex-row overflow-x-auto gap-1.5 pt-2 pb-2">
            <div
              v-for="(image, index) in activeImages"
              :key="image.id"
              class="w-24 h-20 flex-shrink-0 cursor-pointer rounded-md border overflow-hidden hover:opacity-80 transition"
              :class="galleryIndex === index ? 'border-secondary' : 'border-base-muted'"
              @click="galleryIndex = index"
            >
              <img
                class="w-24 h-20 object-contain"
                :src="image.thumb"
                :alt="image.depictions?.map((d) => d.label).join(';')"
              />
            </div>
          </div>
          <ImageLightbox
            v-if="isViewerOpen"
            :index="galleryIndex"
            :images="activeImages"
            :next="galleryIndex < activeImages.length - 1"
            :previous="galleryIndex > 0"
            @select-index="galleryIndex = $event"
            @next="galleryIndex++"
            @previous="galleryIndex--"
            @close="isViewerOpen = false"
          />
        </template>

        <!-- GBIF type specimens whose images can't be embedded — one link each -->
        <div
          v-if="activeTab === 'gbif' && gbifLinks.length"
          class="text-sm"
          :class="currentImage ? 'mt-3 pt-2 border-t border-base-muted' : ''"
        >
          <p class="text-base-soft mb-1">
            {{ currentImage
              ? 'More type material on GBIF (images can’t be embedded):'
              : 'Type material on GBIF: images can’t be embedded here' }}
          </p>
          <ul class="space-y-1">
            <li
              v-for="l in gbifLinks"
              :key="l.href"
            >
              <a
                :href="l.href"
                target="_blank"
                rel="noopener noreferrer"
                class="text-secondary hover:underline"
              >{{ l.typeStatus || 'Type' }} · <em>{{ l.name }}</em></a>
              <span
                v-if="l.specimen"
                class="text-base-soft"
              >: {{ l.specimen }}</span>
            </li>
          </ul>
        </div>
      </template>
    </VCardContent>
  </VCard>
</template>

<script setup>
import { computed, watch, ref, reactive, onServerPrefetch, onMounted, onBeforeUnmount } from 'vue'
import axios from 'axios'
import { useImageStore } from '@/modules/otus/store/useImageStore'
import { makeAPIRequest } from '@/utils/request'
import GalleryMainImage from '@/components/Gallery/GalleryMainImage.vue'
import ImageLightbox from '../_shared/ImageLightbox.vue'
import inatMark from '../PaneliNaturalist/inat-mark.svg'
import gbifMark from '../_gbifShared/gbif-mark.svg'
import { CHECKLIST_KEY, deriveScientificName } from '../_gbifShared/useGbifMatch'
import { TYPE_STATUSES } from '../_gbifShared/typeStatuses'
import { gbifOccurrencesToImages } from '../_gbifShared/gbifTypeImages'
import { resolveGbifTaxonScope } from '../_gbifShared/gbifTaxonScope'

const INAT_MAX = 10
const SUB_IMAGE_TIMEOUT_MS = 8000
const GBIF_OCCURRENCE_SEARCH = 'https://api.gbif.org/v1/occurrence/search'
const GBIF_TYPE_MAX = 24
// Ask GBIF for a bigger pool than we show — many type images (esp. MNHN's
// mediaphoto.mnhn.fr, now behind a Cloudflare challenge) 403 on hotlink and get
// dropped after the load probe.
const GBIF_TYPE_POOL = 40
const GBIF_IMG_PROBE_MS = 6000
// "Type material" is only meaningful in the species group.
const SPECIES_GROUP_RANKS = new Set(['species', 'subspecies', 'variety', 'form'])

// Tab order + presentation. 'tw' also covers the subordinate-taxa sample.
const TAB_ORDER = ['tw', 'gbif', 'inat']
const TAB_LABEL = {
  tw: 'TaxonWorks',
  gbif: 'Type material via GBIF',
  inat: 'iNaturalist'
}
const TAB_MARK = { tw: null, gbif: gbifMark, inat: inatMark }

const props = defineProps({
  otuId: {
    type: [String, Number],
    required: true
  },
  sort_order: {
    type: Array,
    default: () => []
  },
  taxon: {
    type: Object,
    default: undefined
  },
  otu: {
    type: Object,
    default: undefined
  },
  subMaxImages: {
    type: Number,
    default: 10
  }
})

function normalizeImage(img) {
  const { url, project_token } = __APP_ENV__
  return {
    id: img.id,
    thumb: img.thumb,
    medium: img.medium,
    original: img.original_png
      ? `${url}/${img.original_png.substring(8)}?project_token=${project_token}`
      : img.original,
    attribution: img.attribution || { label: '' },
    source: img.source || { label: '' },
    citations: img.citations || [],
    depictions: img.depictions || []
  }
}

const store = useImageStore()

// Image ids to hide from this OTU-scoped gallery: images tied to the OTU scope
// ONLY through a data depiction (is_metadata_depiction — a label photo, a shot of
// handwritten notes, …) on a CollectionObject/FieldOccurrence. A data depiction
// attached directly to the OTU is kept. The /otus/:id/inventory/images endpoint
// doesn't serialize is_metadata_depiction, so the flag comes from /depictions.
const dataDepictionDropIds = ref(new Set())

const twDirectImages = computed(() =>
  (store.images || [])
    .map(normalizeImage)
    .filter((img) => !dataDepictionDropIds.value.has(img.id))
)

// Per-source image containers (loaded lazily, then kept for the panel's life).
const subImages = ref([])
const gbifImages = ref([])
const inatImages = ref([])

// The TaxonWorks tab shows the OTU's own depictions, or a subordinate-taxa
// sample when it has none.
const twTabImages = computed(() =>
  twDirectImages.value.length ? twDirectImages.value : subImages.value
)

// Per-source meta: availability (controls tab visibility), lazy-load state, note.
// TaxonWorks availability is a computed (twAvailable) so it works during SSR,
// before the client-only orchestrate() runs.
const meta = reactive({
  tw: { checked: false, loading: false, loaded: false, note: '' },
  gbif: { available: false, checked: false, loading: false, loaded: false, note: '', count: 0, links: [] },
  inat: { available: false, checked: false, loading: false, loaded: false, note: '' }
})

// Non-reactive scratch shared between the availability check and the full load.
const cache = {
  gbifKeys: null,
  gbifNames: null, // TW accepted name + TW synonym names, for result filtering
  gbifPool: null, // name-filtered type-specimen image objects (pre load-probe)
  inatTaxonId: null,
  inatRec: null
}

// Explicit user tab choice; null → fall back to the first visible tab.
const activeKey = ref(null)
const galleryIndex = ref(0)
const isViewerOpen = ref(false)

function imagesFor(key) {
  if (key === 'tw') return twTabImages.value
  if (key === 'gbif') return gbifImages.value
  if (key === 'inat') return inatImages.value
  return []
}

const twAvailable = computed(
  () =>
    twDirectImages.value.length > 0 ||
    (meta.tw.checked && subImages.value.length > 0)
)

function sourceAvailable(key) {
  return key === 'tw' ? twAvailable.value : meta[key].available
}

const visibleTabs = computed(() =>
  TAB_ORDER.filter(sourceAvailable).map((k) => ({
    key: k,
    label: TAB_LABEL[k],
    mark: TAB_MARK[k]
  }))
)

// The tab actually shown: the user's pick if it's still visible, else the first.
const activeTab = computed(() => {
  if (activeKey.value && sourceAvailable(activeKey.value)) return activeKey.value
  return visibleTabs.value[0]?.key ?? null
})

const activeImages = computed(() =>
  activeTab.value ? imagesFor(activeTab.value) : []
)
const currentImage = computed(() => activeImages.value[galleryIndex.value])
const activeLoading = computed(
  () =>
    meta.tw.loading ||
    (!!activeTab.value && meta[activeTab.value].loading)
)
const activeMark = computed(() =>
  activeTab.value ? TAB_MARK[activeTab.value] : null
)
const gbifLinks = computed(() => meta.gbif.links)

// Context line under the tabs. TW shows the subordinate-sample notice; the other
// sources only need a "which source is this" line when there's no tab bar, plus
// any real message (e.g. GBIF's images not being embeddable).
const activeNote = computed(() => {
  const k = activeTab.value
  if (!k) return ''
  if (k === 'tw') return meta.tw.note
  if (meta[k].note) return meta[k].note
  // GBIF: the "can't embed" link list is its own context — no extra line.
  if (k === 'gbif' && meta.gbif.links.length && !currentImage.value) return ''
  if (visibleTabs.value.length <= 1) {
    return k === 'gbif'
      ? 'Showing type specimens from GBIF'
      : 'Fetched from iNaturalist'
  }
  return ''
})

const showCard = computed(
  () => visibleTabs.value.length > 0 || meta.tw.loading
)

watch(activeImages, () => {
  galleryIndex.value = 0
})

const userChoseTab = ref(false)

function selectTab(key, { user = true } = {}) {
  if (user) userChoseTab.value = true
  if (activeKey.value === key) return
  activeKey.value = key
  galleryIndex.value = 0
  isViewerOpen.value = false
  if (key === 'gbif') loadGbif()
  if (key === 'inat') loadInat()
}

// The GBIF type-material tab was auto-selected but its images can't be embedded
// (links only). A tab with actual images should win the default — hand off to
// iNaturalist, else the TaxonWorks tab. The user can still pick GBIF manually.
watch(
  () => meta.gbif.loaded,
  (loaded) => {
    if (!loaded || userChoseTab.value) return
    if (activeTab.value !== 'gbif' || gbifImages.value.length) return
    if (meta.inat.available) selectTab('inat', { user: false })
    else if (twAvailable.value) selectTab('tw', { user: false })
  }
)

// ── Orchestration ────────────────────────────────────────────────────────────

let orchestrated = false

// Client-only: resolve the TaxonWorks tab, then check (cheaply) whether GBIF and
// iNaturalist also have something, to decide which tabs to show. Images for the
// non-active tabs are not fetched until the user opens them.
async function orchestrate() {
  if (orchestrated || store.images === null) return
  orchestrated = true

  if (twDirectImages.value.length) {
    meta.tw.loaded = true
  } else {
    meta.tw.loading = true
    await fetchSubordinateSample()
    meta.tw.loading = false
    meta.tw.loaded = true
    if (subImages.value.length) {
      meta.tw.note =
        'No depictions for this taxon: showing a random sample from subordinate taxa'
    }
  }
  meta.tw.checked = true

  await Promise.all([checkGbifAvailability(), checkInatAvailability()])

  // If TaxonWorks has nothing, open the first source that does (kicks its load).
  // Marked non-user so the handoff watcher can still move off a links-only GBIF.
  if (!twAvailable.value) {
    const first = visibleTabs.value[0]?.key
    if (first) selectTab(first, { user: false })
  }
}

onServerPrefetch(async () => {
  await store.loadImages(props.otuId, { sortOrder: props.sort_order })
})

onMounted(() => {
  if (!store.images) {
    store.loadImages(props.otuId, { sortOrder: props.sort_order })
  }
  // Client-only on purpose: dataDepictionDropIds isn't part of the SSR payload,
  // so filtering during onServerPrefetch would make the server markup disagree
  // with the first client render (Set still empty) — a hydration mismatch.
  fetchDataDepictionFilter()
  orchestrate()
})

watch(() => store.images, orchestrate)

onBeforeUnmount(() => {
  store.resetRequest()
  store.$reset()
})

// ── TaxonWorks data-depiction filter ─────────────────────────────────────────

function dropIdsFromDepictions(rows) {
  const otuMeta = new Set() // image has a data depiction ON an Otu
  const foreignMeta = new Set() // image has a data depiction on a non-Otu object
  for (const d of rows || []) {
    if (!d.is_metadata_depiction) continue
    if (d.depiction_object_type === 'Otu') otuMeta.add(d.image_id)
    else foreignMeta.add(d.image_id)
  }
  return new Set([...foreignMeta].filter((id) => !otuMeta.has(id)))
}

async function fetchDataDepictionFilter() {
  try {
    const { data } = await makeAPIRequest.get('/depictions', {
      params: {
        'otu_id[]': [props.otuId],
        'otu_scope[]': ['all', 'coordinate_otus'],
        per: 500
      }
    })
    dataDepictionDropIds.value = dropIdsFromDepictions(data)
  } catch {
    // Leave the set empty — show everything, as before.
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    )
  ])
}

// Resolves true only if the URL loads as an image. Cross-origin <img> loads need
// no CORS, so this catches 403 / 404 / dead hosts a HEAD fetch couldn't.
// SSR-safe: no Image constructor on the server → treat as not loadable.
function imageLoads(url, ms = GBIF_IMG_PROBE_MS) {
  if (!url || typeof Image === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      img.onload = img.onerror = null
      img.src = '' // cancel the download if it's still in flight
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), ms)
    img.onload = () => done(img.naturalWidth > 0)
    img.onerror = () => done(false)
    // No referrerPolicy override — the probe must mirror what the gallery's own
    // <img> tags do, or it green-lights images that then fail to show.
    img.src = url
  })
}

// ── GBIF type material ───────────────────────────────────────────────────────

// The taxon's accepted name + every TaxonWorks synonym → the union of CoL usage
// keys (each synonym may carry its own GBIF records) and the name set for the
// result filter. speciesGroupOnly drops HIGHERRANK matches (species absent from
// CoL → resolves to its genus → genus rollup).
async function resolveGbifKeys() {
  if (cache.gbifKeys) return cache.gbifKeys

  const rank = String(props.taxon?.rank || '').toLowerCase()
  const primaryName = deriveScientificName(props.taxon, props.otu)
  if (!SPECIES_GROUP_RANKS.has(rank) || !primaryName) {
    cache.gbifKeys = []
    cache.gbifNames = []
    return cache.gbifKeys
  }

  const { names, keys } = await resolveGbifTaxonScope(
    primaryName,
    props.taxon?.id,
    { speciesGroupOnly: true }
  )
  cache.gbifNames = names
  cache.gbifKeys = keys
  return cache.gbifKeys
}

function gbifTypeParams(keys) {
  const params = new URLSearchParams()
  params.set('checklistKey', CHECKLIST_KEY)
  keys.forEach((k) => params.append('taxonKey', k))
  params.set('mediaType', 'StillImage')
  TYPE_STATUSES.forEach((s) => params.append('typeStatus', s))
  params.set('limit', String(GBIF_TYPE_POOL))
  return params
}

// Fetch + name-filter the type-specimen occurrences (one request). The image
// LOAD PROBE — the slow part — is deferred to loadGbif() on tab select. The pool
// is cached so the two share the one fetch.
async function resolveGbifPool() {
  if (cache.gbifPool) return cache.gbifPool
  const keys = await resolveGbifKeys()
  if (!keys.length) {
    cache.gbifPool = []
    return cache.gbifPool
  }
  try {
    const res = await withTimeout(
      fetch(`${GBIF_OCCURRENCE_SEARCH}?${gbifTypeParams(keys)}`),
      SUB_IMAGE_TIMEOUT_MS
    )
    const data = res.ok ? await res.json() : null
    cache.gbifPool = gbifOccurrencesToImages(data?.results || [], {
      max: GBIF_TYPE_POOL,
      names: cache.gbifNames
    })
  } catch {
    cache.gbifPool = []
  }
  return cache.gbifPool
}

async function checkGbifAvailability() {
  meta.gbif.checked = true
  try {
    const pool = await resolveGbifPool()
    // distinct type specimens (occurrences), not media count
    meta.gbif.count = new Set(pool.map((im) => im.occurrenceKey)).size
    meta.gbif.available = pool.length > 0
  } catch {
    // unavailable
  }
}

async function loadGbif() {
  if (meta.gbif.loaded || meta.gbif.loading) return
  meta.gbif.loading = true
  try {
    const pool = await resolveGbifPool()
    const ok = await Promise.all(pool.map((im) => imageLoads(im.original)))
    const embeddable = pool.filter((_, i) => ok[i])
    gbifImages.value = embeddable.slice(0, GBIF_TYPE_MAX)

    // Direct links only for type specimens with NO embeddable image at all. An
    // occurrence with a loaded image is never a "can't embed" link, even if it
    // fell past the display cap — so key off the full embeddable set, not the
    // sliced one.
    const embeddableKeys = new Set(embeddable.map((im) => im.occurrenceKey))
    const byOccurrence = new Map()
    pool.forEach((im, i) => {
      if (ok[i] || embeddableKeys.has(im.occurrenceKey)) return
      if (!byOccurrence.has(im.occurrenceKey)) {
        byOccurrence.set(im.occurrenceKey, {
          href: im.href,
          typeStatus: im.typeStatus,
          name: im.taxonName,
          specimen: im.specimenLabel
        })
      }
    })
    meta.gbif.links = [...byOccurrence.values()]
  } catch {
    // leave empty
  } finally {
    meta.gbif.loaded = true
    meta.gbif.loading = false
  }
}

// ── Subordinate taxa sample (part of the TaxonWorks tab) ─────────────────────

async function fetchSubordinateSample() {
  if (!props.taxon?.id) return
  try {
    const perPage = Math.ceil(props.subMaxImages / 2)
    const params = {
      'taxon_name_id[]': [props.taxon.id],
      per: perPage,
      extend: ['depictions', 'attribution', 'source', 'citations']
    }

    // Lightweight probe (per=1) to get the total image count without the data.
    const probe = await withTimeout(
      makeAPIRequest.get('/images', {
        params: { 'taxon_name_id[]': [props.taxon.id], per: 1 }
      }),
      SUB_IMAGE_TIMEOUT_MS
    )
    const total = parseInt(probe.headers['pagination-total'] || '0', 10)
    if (!total) return

    const totalPages = Math.ceil(total / perPage)
    const pageA = Math.floor(Math.random() * totalPages) + 1
    let pageB = pageA
    if (totalPages > 1) {
      while (pageB === pageA) pageB = Math.floor(Math.random() * totalPages) + 1
    }

    const pages = pageA === pageB ? [pageA] : [pageA, pageB]
    const results = await Promise.all(
      pages.map((page) =>
        withTimeout(
          makeAPIRequest.get('/images', { params: { ...params, page } }),
          SUB_IMAGE_TIMEOUT_MS
        )
      )
    )

    const raw = results.flatMap((r) => r.data || [])

    // Same rule as the direct gallery: drop images tied only to data depictions
    // (is_metadata_depiction) not on an Otu.
    let drop = new Set()
    if (raw.length) {
      try {
        const { data } = await withTimeout(
          makeAPIRequest.get('/depictions', {
            params: { 'image_id[]': raw.map((i) => i.id), per: 500 }
          }),
          SUB_IMAGE_TIMEOUT_MS
        )
        drop = dropIdsFromDepictions(data)
      } catch {
        // keep everything on failure
      }
    }

    subImages.value = raw
      .filter((i) => !drop.has(i.id))
      .slice(0, props.subMaxImages)
      .map(normalizeImage)
  } catch {
    // fail silently
  }
}

// ── iNaturalist ──────────────────────────────────────────────────────────────

/**
 * Copied from PaneliNaturalist.vue. Uses props.taxon.expanded_name directly —
 * otu.object_label may include authorship, breaking the exact-name match.
 */
function parseName(expandedName) {
  const subgenusMatch = expandedName.match(/^(\S+)\s+\((\S+)\)(?:\s+(\S+))?$/)
  if (subgenusMatch) {
    return {
      genus: subgenusMatch[1],
      subgenus: subgenusMatch[2],
      epithet: subgenusMatch[3] || null
    }
  }
  const parts = expandedName.trim().split(/\s+/)
  return {
    genus: parts[0],
    subgenus: null,
    epithet: parts[1] || null
  }
}

async function resolveInatTaxonId() {
  if (cache.inatTaxonId) return cache.inatTaxonId
  if (!props.taxon?.expanded_name) return null

  const { genus, subgenus, epithet } = parseName(props.taxon.expanded_name)

  if (subgenus && !epithet) {
    const { data } = await axios.get('https://api.inaturalist.org/v1/taxa', {
      params: { q: subgenus, rank: 'subgenus', per_page: 10, all_names: true }
    })
    const match = data.results.find((t) => {
      if (t.name.toLowerCase() !== subgenus.toLowerCase()) return false
      if (t.ancestors?.length) {
        return t.ancestors.some(
          (a) => a.rank === 'genus' && a.name.toLowerCase() === genus.toLowerCase()
        )
      }
      return true
    })
    cache.inatTaxonId = match ? match.id : null
    return cache.inatTaxonId
  }

  const plainName = subgenus && epithet
    ? `${genus} ${epithet}`
    : props.taxon.expanded_name

  const { data } = await axios.get('https://api.inaturalist.org/v1/taxa', {
    params: { q: plainName, rank: props.taxon.rank, per_page: 10 }
  })
  const match = data.results.find(
    (t) => t.name.toLowerCase() === plainName.toLowerCase()
  )
  cache.inatTaxonId = match ? match.id : null
  return cache.inatTaxonId
}

function makeTaxonPhotoImage(taxonPhoto) {
  const photo = taxonPhoto.photo
  const photoUrl = `https://www.inaturalist.org/photos/${photo.id}`
  const taxonName = taxonPhoto.taxon?.name || ''
  return {
    id: photo.id,
    thumb: photo.medium_url || photo.url.replace('square', 'medium'),
    medium: photo.medium_url || photo.url.replace('square', 'medium'),
    original: photo.original_url || photo.large_url || photo.url.replace('square', 'original'),
    attribution: { label: photo.attribution || '' },
    source: {
      label: `<a href="${photoUrl}" target="_blank" rel="noopener noreferrer" class="text-secondary hover:underline">${photoUrl}</a>`
    },
    depictions: taxonName ? [{ label: taxonName }] : []
  }
}

function makeObservationImage(obs, photo) {
  const obsUrl = `https://www.inaturalist.org/observations/${obs.id}`
  return {
    id: photo.id,
    thumb: photo.url.replace('square', 'medium'),
    medium: photo.url.replace('square', 'medium'),
    original: photo.url.replace('square', 'original'),
    attribution: { label: photo.attribution || '' },
    source: {
      label: `<a href="${obsUrl}" target="_blank" rel="noopener noreferrer" class="text-secondary hover:underline">${obsUrl}</a>`
    },
    depictions: obs.taxon?.name ? [{ label: obs.taxon.name }] : []
  }
}

async function fetchInatRecord() {
  if (cache.inatRec) return cache.inatRec
  const taxonId = await resolveInatTaxonId()
  if (!taxonId) return null
  const { data } = await axios.get(
    `https://api.inaturalist.org/v1/taxa/${taxonId}`
  )
  cache.inatRec = data.results?.[0] || null
  return cache.inatRec
}

async function checkInatAvailability() {
  meta.inat.checked = true
  try {
    const rec = await fetchInatRecord()
    if (!rec) return
    meta.inat.available =
      (rec.taxon_photos?.length || 0) > 0 || (rec.observations_count || 0) > 0
  } catch {
    // unavailable
  }
}

async function loadInat() {
  if (meta.inat.loaded || meta.inat.loading) return
  meta.inat.loading = true
  try {
    const taxonId = await resolveInatTaxonId()
    const rec = await fetchInatRecord()
    if (taxonId) {
      const curated = (rec?.taxon_photos || [])
        .slice(0, INAT_MAX)
        .map(makeTaxonPhotoImage)

      const remaining = INAT_MAX - curated.length
      let observationImages = []
      if (remaining > 0) {
        const { data: obsData } = await axios.get(
          'https://api.inaturalist.org/v1/observations',
          {
            params: {
              taxon_id: taxonId,
              quality_grade: 'research',
              per_page: remaining
            }
          }
        )
        observationImages = obsData.results
          .filter((obs) => obs.observation_photos?.[0])
          .map((obs) => makeObservationImage(obs, obs.observation_photos[0].photo))
      }

      inatImages.value = [...curated, ...observationImages]
    }
  } catch {
    // leave empty
  } finally {
    if (!inatImages.value.length) {
      meta.inat.note = 'No embeddable iNaturalist photos for this taxon.'
    }
    meta.inat.loaded = true
    meta.inat.loading = false
  }
}
</script>

<style scoped>
:deep(.w-24.h-20.cursor-pointer) {
  transition: opacity 150ms;
}
:deep(.w-24.h-20.cursor-pointer:hover) {
  opacity: 0.8;
}
</style>
