<template>
  <div
    class="fixed z-[10000] inset-0 flex flex-col backdrop-blur-md bg-base-foreground overflow-hidden"
  >
    <!-- Toolbar -->
    <div class="flex-none h-12 flex items-center justify-between px-2">
      <span class="text-sm opacity-50 px-2">{{ index + 1 }} / {{ images.length }}</span>
      <button
        type="button"
        aria-label="Close image viewer"
        class="p-2 cursor-pointer opacity-50 text-base-content"
        @click="emit('close')"
      >
        <IconClose />
      </button>
    </div>

    <!-- Image area: takes all remaining vertical space -->
    <div class="flex-1 min-h-0 relative flex items-center justify-center">
      <img
        class="max-w-full max-h-full object-contain cursor-zoom-out"
        :src="image.original"
        :alt="depictionTitle"
        @click="emit('close')"
      />
      <ControlImagePrevious
        v-if="previous"
        class="absolute left-0 top-1/2 -translate-y-1/2"
        @click="emit('previous')"
      />
      <ControlImageNext
        v-if="next"
        class="absolute right-0 top-1/2 -translate-y-1/2"
        @click="emit('next')"
      />
    </div>

    <!-- Bottom panel: natural height, scrollable if very tall -->
    <div class="flex-none text-center text-sm px-6 pb-2 max-h-[40vh] overflow-y-auto">
      <!-- OTU section: badge, name, description -->
      <div
        v-if="imageDisplay.hasOtu || imageDisplay.name"
        class="my-1"
      >
        <div
          v-if="imageDisplay.hasOtu"
          class="text-xs opacity-40 uppercase tracking-wide"
        >OTU</div>
        <div>
          <RouterLink
            v-if="imageDisplay.otuId"
            :to="{ name: 'otus-id', params: { id: imageDisplay.otuId } }"
            class="text-secondary hover:underline"
          ><em>{{ imageDisplay.name.italic }}</em>{{ imageDisplay.name.plain ? ' ' + imageDisplay.name.plain : '' }}</RouterLink>
          <span v-else><em>{{ imageDisplay.name.italic }}</em>{{ imageDisplay.name.plain ? ' ' + imageDisplay.name.plain : '' }}</span>
        </div>
        <div
          v-if="imageDisplay.otuFigLabel"
          class="opacity-70"
        >{{ imageDisplay.otuFigLabel }}</div>
        <div
          v-if="imageDisplay.otuDesc"
          class="opacity-70"
        >{{ imageDisplay.otuDesc }}</div>
      </div>

      <!-- CO/FO entries: badge + ⓘ, type status, figure label, caption -->
      <div
        v-for="co in imageDisplay.coEntries"
        :key="co.objectId"
        class="my-0.5"
      >
        <div class="flex items-center justify-center gap-1">
          <span class="text-xs opacity-40 uppercase tracking-wide">{{ co.objectType === 'CollectionObject' ? 'Collection object' : 'Field occurrence' }}</span>
          <button
            type="button"
            class="shrink-0 opacity-40 hover:opacity-100 cursor-pointer leading-none text-xs"
            title="Show details"
            @click="openDwcTable(co)"
          >ⓘ</button>
        </div>
        <div
          v-if="co.typeStatus"
          class="font-semibold"
        >{{ co.typeStatus }}</div>
        <div
          v-if="co.figureLabel"
          class="opacity-70 text-xs"
        >{{ co.figureLabel }}</div>
        <div
          v-if="co.caption"
          class="opacity-70 text-xs"
        >{{ co.caption }}</div>
      </div>

      <!-- Attribution + citations (image-level) -->
      <div class="opacity-60 my-1">
        <span v-if="image.attribution?.label">{{ image.attribution.label }}</span>
        <span
          v-else-if="!image.citations?.length"
          class="italic"
        >attribution missing</span><template
          v-for="(cit, i) in image.citations || []"
          :key="cit.id"
        > <span
            class="text-secondary hover:underline cursor-pointer"
            @click="activeCitation = cit"
            v-html="cit.citation_source_body"
          /></template>
      </div>

      <!-- Source -->
      <div
        v-if="image.source?.label"
        class="opacity-60 my-1"
        v-html="image.source.label"
      />

      <!-- Thumbnail strip -->
      <div class="flex flex-row overflow-x-auto justify-center gap-1.5 mt-2 pb-2">
        <div
          v-for="(img, i) in images"
          :key="img.id"
          class="w-24 h-20 flex-shrink-0 cursor-pointer rounded-md border overflow-hidden hover:opacity-80 transition"
          :class="index === i ? 'border-secondary' : 'border-base-muted'"
          @click="emit('selectIndex', i)"
        >
          <img
            class="w-24 h-20 object-contain"
            :src="img.thumb"
            :alt="img.depictions?.map((d) => d.label).join(';')"
          />
        </div>
      </div>
    </div>

    <DwcTable ref="dwcTableRef" />

    <Teleport to="body">
      <VModal
        v-if="activeCitation"
        @close="activeCitation = null"
      >
        <template #header>
          <div class="text-sm font-medium">Reference</div>
        </template>
        <div
          class="px-4 pb-4 text-sm leading-relaxed"
          v-html="activeCitation.source?.cached || activeCitation.citation_source_body"
        />
      </VModal>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import ControlImageNext from '@/components/ImageViewer/ControlImageNext.vue'
import ControlImagePrevious from '@/components/ImageViewer/ControlImagePrevious.vue'
import DwcTable from '../PanelMapV2/components/DwcTable.vue'
import { makeAPIRequest } from '@/utils/request'

const props = defineProps({
  images: { type: Array, required: true },
  index:  { type: Number, required: true },
  next:     { type: Boolean, default: false },
  previous: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'next', 'previous', 'selectIndex'])

const dwcTableRef = ref(null)
const activeCitation = ref(null)

// DWC cache keyed by object id: { typeStatus, scientificName }
const dwcCache = reactive({})

// OTU validity cache: rawOtuId → validOtuId (resolved asynchronously)
const otuValidCache = reactive({})

const DWC_ENDPOINTS = {
  CollectionObject: (id) => `/collection_objects/${id}/dwc`,
  FieldOccurrence:  (id) => `/field_occurrences/${id}/dwc`
}

// Infer depiction type when depiction_object_type isn't serialized by the inventory endpoint.
// CO/FO are identified first by label prefix, preventing their "uuid: " from being
// mistaken for the OTU ': ' separator. Anything else with ': ' is treated as OTU.
function inferDepictionType(dep) {
  if (dep.depiction_object_type) return dep.depiction_object_type
  const label = dep.label || ''
  if (label.startsWith('CollectionObject ')) return 'CollectionObject'
  if (label.startsWith('FieldOccurrence '))  return 'FieldOccurrence'
  if (label.indexOf(': ') > 0)               return 'Otu'
  if (dep.depiction_object_id)               return 'Otu'
  return null
}

function fetchDwcForImage(img) {
  for (const dep of (img?.depictions || [])) {
    const type = inferDepictionType(dep)
    const endpoint = DWC_ENDPOINTS[type]
    if (!endpoint || dep.depiction_object_id in dwcCache) continue
    const id = dep.depiction_object_id
    dwcCache[id] = null
    makeAPIRequest(endpoint(id))
      .then(({ data }) => {
        dwcCache[id] = {
          typeStatus:     data.typeStatus     || '',
          scientificName: data.scientificName || ''
        }
      })
      .catch(() => { dwcCache[id] = { typeStatus: '', scientificName: '' } })
  }
}

// Fetch DWC for current image and prefetch adjacent ones.
watch(
  () => props.index,
  (idx) => {
    fetchDwcForImage(props.images[idx])
    fetchDwcForImage(props.images[idx + 1])
    fetchDwcForImage(props.images[idx - 1])
  },
  { immediate: true }
)

// Split "Genus (Subgenus) species (Author, year)" into italic name and plain authorship.
// Rules:
//   lowercase word                        → species/subspecies epithet → italic
//   (Word) where next word is lowercase   → subgenus → italic
//   anything else                         → authorship → plain
function splitName(name) {
  const words = (name || '').trim().split(/\s+/)
  let i = 1
  while (i < words.length) {
    const w = words[i]
    if (/^[a-z]/.test(w)) { i++; continue }
    if (/^\(/.test(w) && /^[a-z]/.test(words[i + 1] || '')) { i++; continue }
    break
  }
  return { italic: words.slice(0, i).join(' '), plain: words.slice(i).join(' ') }
}

const image = computed(() => props.images[props.index] || {})

// Extract the description embedded in an OTU label after ': ', stripping the trailing
// '. (Type).' marker. Falls back to dep.caption if available.
function otuDescription(dep) {
  if (!dep) return ''
  if (dep.caption) return dep.caption
  const label = dep.label || ''
  const colonIdx = label.indexOf(': ')
  if (colonIdx < 0) return ''
  return label.substring(colonIdx + 2).replace(/\s*\.\s*\(\w+\)\s*\.\s*$/, '').trim()
}

// Unified display object for the current image.
// Name is always shown first (OTU label or DWC scientificName for CO-only).
// OTU description appears directly below the name.
// CO/FO entries follow, each with badge, type status, and their own figure label / caption.
const imageDisplay = computed(() => {
  const deps = image.value.depictions || []

  // OTU depiction: use inferred type
  const otuDep = deps.find((d) => inferDepictionType(d) === 'Otu')

  // CO/FO depictions: use inferred type
  const coDeps = deps.filter((d) => {
    const t = inferDepictionType(d)
    return t === 'CollectionObject' || t === 'FieldOccurrence'
  })

  // Primary name: from OTU label (before ': ') — only when non-empty after parsing
  let name = null
  let otuId = null

  if (otuDep) {
    const label = otuDep.label || ''
    const colonIdx = label.indexOf(': ')
    const namePart = colonIdx > 0 ? label.substring(0, colonIdx) : label
    const parsed = splitName(namePart)
    if (parsed.italic || parsed.plain) name = parsed
    otuId = otuDep.depiction_object_id || null
  }

  // Fallback: DWC scientificName from first CO/FO when OTU label is empty
  if (!name && coDeps.length) {
    const cached = dwcCache[coDeps[0].depiction_object_id]
    if (cached?.scientificName) name = splitName(cached.scientificName)
  }

  // iNat synthetic fallback: null-type dep whose label is just the taxon name
  if (!name && !otuDep && !coDeps.length) {
    const synDep = deps.find((d) => !inferDepictionType(d))
    if (synDep?.label) name = splitName(synDep.label)
  }

  // CO/FO entries — use inferred type for badge label
  const coEntries = coDeps.map((dep) => {
    const cached = dwcCache[dep.depiction_object_id]
    return {
      objectId:    dep.depiction_object_id,
      objectType:  inferDepictionType(dep),
      typeStatus:  cached?.typeStatus  || '',
      figureLabel: dep.figure_label    || '',
      caption:     dep.caption         || ''
    }
  })

  return {
    name,
    otuId,
    hasOtu:      !!otuDep,
    otuDesc:     otuDescription(otuDep),
    otuFigLabel: otuDep?.figure_label || '',
    coEntries
  }
})

const depictionTitle = computed(() => {
  const { name } = imageDisplay.value
  if (!name) return ''
  return [name.italic, name.plain].filter(Boolean).join(' ')
})

function openDwcTable(dep) {
  dwcTableRef.value?.show({ id: dep.objectId, type: dep.objectType })
}

function handleKey(e) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowLeft' && props.previous) emit('previous')
  if (e.key === 'ArrowRight' && props.next) emit('next')
}

onMounted(() => {
  document.addEventListener('keyup', handleKey)
  document.body.classList.add('overflow-hidden')
})
onUnmounted(() => {
  document.removeEventListener('keyup', handleKey)
  document.body.classList.remove('overflow-hidden')
})
</script>
