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
      <div
        v-for="(dep, i) in parsedDepictions"
        :key="i"
        class="my-1"
      >
        <!-- Line 1: type badge (+ ⓘ for CO/FO) -->
        <div
          v-if="dep.typeLabel"
          class="flex items-center justify-center gap-1"
        >
          <span class="text-xs opacity-40 uppercase tracking-wide">{{ dep.typeLabel }}</span>
          <button
            v-if="dep.objectId"
            type="button"
            class="shrink-0 opacity-40 hover:opacity-100 cursor-pointer leading-none text-xs"
            title="Show details"
            @click="openDwcTable(dep)"
          >ⓘ</button>
        </div>

        <!-- Line 2: species name as blue link -->
        <div v-if="dep.italic || dep.plain">
          <RouterLink
            v-if="dep.otuId"
            :to="{ name: 'otus-id', params: { id: dep.otuId } }"
            class="text-secondary hover:underline"
          ><em>{{ dep.italic }}</em>{{ dep.plain ? ' ' + dep.plain : '' }}</RouterLink>
          <span
            v-else-if="dep.objectId"
            class="text-secondary hover:underline cursor-pointer"
            @click="openDwcTable(dep)"
          ><em>{{ dep.italic }}</em>{{ dep.plain ? ' ' + dep.plain : '' }}</span>
          <span v-else><em>{{ dep.italic }}</em>{{ dep.plain ? ' ' + dep.plain : '' }}</span>
        </div>

        <!-- Line 3: type status (CO only) -->
        <div
          v-if="dep.typeStatus"
          class="text-xs font-semibold"
        >{{ dep.typeStatus }}</div>

        <!-- Line 4: figure label -->
        <div
          v-if="dep.figureLabel"
          class="opacity-70 text-xs"
        >{{ dep.figureLabel }}</div>

        <!-- Line 5: caption -->
        <div
          v-if="dep.caption"
          class="opacity-70 text-xs"
        >{{ dep.caption }}</div>
      </div>

      <!-- Attribution + citations (image-level) -->
      <div
        v-if="image.attribution?.label || image.citations?.length"
        class="opacity-60 my-1"
      >
        <span v-if="image.attribution?.label">{{ image.attribution.label }}</span><template
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

const DWC_ENDPOINTS = {
  CollectionObject: (id) => `/collection_objects/${id}/dwc`,
  FieldOccurrence:  (id) => `/field_occurrences/${id}/dwc`
}

function fetchDwcForImage(img) {
  for (const dep of (img?.depictions || [])) {
    const endpoint = DWC_ENDPOINTS[dep.depiction_object_type]
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

// One entry per depiction, always in the same field order:
//   typeLabel, objectId/otuId, italic, plain, typeStatus, figureLabel, caption
// OTU entries always come first. CO/FO entries suppress the species name when
// an OTU depiction is already present (the name would be the same — showing it
// twice is redundant and confusing).
const parsedDepictions = computed(() => {
  const deps = image.value.depictions || []
  const hasOtu = deps.some((d) => d.depiction_object_type === 'Otu')
  const result = []

  // Pass 1: OTU depictions
  for (const dep of deps) {
    if (dep.depiction_object_type !== 'Otu') continue
    const colonIdx = (dep.label || '').indexOf(': ')
    const namePart = colonIdx > 0 ? dep.label.substring(0, colonIdx) : (dep.label || '')
    const { italic, plain } = splitName(namePart)
    if (!italic && !plain) continue
    result.push({
      typeLabel:   'OTU',
      otuId:       dep.depiction_object_id,
      objectId:    null,
      objectType:  null,
      italic,      plain,
      typeStatus:  '',
      figureLabel: dep.figure_label || '',
      caption:     dep.caption      || ''
    })
  }

  // Pass 2: CO/FO depictions — name suppressed when an OTU is already shown
  for (const dep of deps) {
    const type = dep.depiction_object_type
    if (type !== 'CollectionObject' && type !== 'FieldOccurrence') continue
    const cached = dwcCache[dep.depiction_object_id]
    const { italic, plain } = hasOtu ? { italic: '', plain: '' } : splitName(cached?.scientificName || '')
    result.push({
      typeLabel:   type === 'CollectionObject' ? 'Collection object' : 'Field occurrence',
      otuId:       null,
      objectId:    dep.depiction_object_id,
      objectType:  type,
      italic,      plain,
      typeStatus:  cached?.typeStatus || '',
      figureLabel: dep.figure_label  || '',
      caption:     dep.caption       || ''
    })
  }

  // Pass 3: iNat synthetic depictions (no depiction_object_type)
  for (const dep of deps) {
    if (dep.depiction_object_type) continue
    const { italic, plain } = splitName(dep.label || '')
    if (!italic && !plain) continue
    result.push({
      typeLabel:   '',
      otuId:       null,
      objectId:    null,
      objectType:  null,
      italic,      plain,
      typeStatus:  '',
      figureLabel: '',
      caption:     ''
    })
  }

  return result
})

const depictionTitle = computed(() =>
  parsedDepictions.value.map((d) => [d.italic, d.plain].filter(Boolean).join(' ')).join('; ')
)

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
