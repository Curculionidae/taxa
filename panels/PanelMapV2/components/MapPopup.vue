<template>
  <div class="max-h-64 overflow-y-auto text-xs min-w-80">
    <ul>
      <li
        v-for="(item, i) in items"
        :key="i"
        class="py-2 last:border-0 border-b"
        :class="CLICKABLE_TYPES.includes(item.type) ? 'cursor-pointer text-secondary-color hover:underline' : ''"
        @click="CLICKABLE_TYPES.includes(item.type) ? emit('selected', item) : null"
      >
        <!-- CollectionObject / FieldOccurrence -->
        <template v-if="CLICKABLE_TYPES.includes(item.type)">
          <div class="text-sm font-medium text-gray-600">{{ TYPE_LABELS[item.type] }}</div>
          <div class="text-xs truncate">
            <span class="italic">{{ splitName(targets?.[i]?.label ?? item.label).name }}</span>
            <span v-if="splitName(targets?.[i]?.label ?? item.label).author">
              {{ ' ' + splitName(targets?.[i]?.label ?? item.label).author }}
            </span>
          </div>
        </template>

        <!-- AssertedDistribution / AssertedAbsent -->
        <template v-else-if="AD_TYPES.includes(item.type)">
          <div class="text-sm font-medium text-gray-600">
            {{ item.type === ASSERTED_ABSENT ? 'Asserted absent' : 'Asserted distribution' }}
          </div>
          <div class="font-medium truncate">{{ areaNameFor(item) }}</div>
          <div class="text-xs truncate mt-0.5">
            <span class="italic">{{ splitName(targets?.[i]?.label ?? '').name }}</span>
            <span v-if="splitName(targets?.[i]?.label ?? '').author">
              {{ ' ' + splitName(targets?.[i]?.label ?? '').author }}
            </span>
          </div>
          <div class="mt-1">
            <span v-if="citationsLoading" class="text-gray-400 italic">loading...</span>
            <template v-else>
              <button
                v-for="cit in citationsByAdId.get(item.id) || []"
                :key="cit.id"
                class="text-secondary-color hover:underline mr-2"
                @click.stop="emit('citation-selected', cit)"
              >{{ cit.display }}</button>
            </template>
          </div>
        </template>

        <!-- Other / fallback -->
        <span v-else class="truncate">{{ item.label }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { makeAPIRequest } from '@/utils'
import {
  COLLECTION_OBJECT,
  FIELD_OCCURRENCE,
  ASSERTED_DISTRIBUTION,
  ASSERTED_ABSENT
} from '@/constants/objectTypes.js'

const CLICKABLE_TYPES = [COLLECTION_OBJECT, FIELD_OCCURRENCE]
const AD_TYPES = [ASSERTED_DISTRIBUTION, ASSERTED_ABSENT]

const TYPE_LABELS = {
  [COLLECTION_OBJECT]: 'Collection object',
  [FIELD_OCCURRENCE]: 'Field occurrence'
}

const props = defineProps({
  items: {
    type: Array,
    required: true
  },
  targets: {
    type: Array,
    default: undefined
  }
})

const emit = defineEmits(['selected', 'citation-selected'])

const citationsByAdId = ref(new Map())
const citationsLoading = ref(false)

// Module-level cache: persists across popup open/close cycles
const citationCache = new Map()

watch(
  () => props.items,
  async (items) => {
    const adIds = items
      .filter((item) => AD_TYPES.includes(item.type) && !citationCache.has(item.id))
      .map((item) => item.id)

    // Populate from cache for already-fetched IDs
    citationsByAdId.value = new Map(
      items.map((item) => [item.id, citationCache.get(item.id) || []])
    )

    if (!adIds.length) return

    citationsLoading.value = true
    try {
      const params = new URLSearchParams()
      params.append('citation_object_type', 'AssertedDistribution')
      adIds.forEach((id) => params.append('citation_object_id[]', id))

      const { data: citations } = await makeAPIRequest.get(`/citations?${params.toString()}`)

      if (citations.length) {
        const sourceIds = [...new Set(citations.map((c) => c.source_id))]
        const srcParams = new URLSearchParams()
        sourceIds.forEach((id) => srcParams.append('source_id[]', id))
        const { data: sources } = await makeAPIRequest.get(`/sources?${srcParams.toString()}`)
        const sourceMap = new Map(sources.map((s) => [s.id, s.cached]))

        for (const cit of citations) {
          if (!citationCache.has(cit.citation_object_id)) {
            citationCache.set(cit.citation_object_id, [])
          }
          citationCache.get(cit.citation_object_id).push({
            id: cit.id,
            display: shortCitation(cit.citation_source_body || ''),
            full: sourceMap.get(cit.source_id) || cit.citation_source_body || ''
          })
        }
      }

      // Mark uncited ADs so we don't re-fetch
      adIds.forEach((id) => {
        if (!citationCache.has(id)) citationCache.set(id, [])
      })
    } catch {
      adIds.forEach((id) => {
        if (!citationCache.has(id)) citationCache.set(id, [])
      })
    } finally {
      citationsLoading.value = false
      citationsByAdId.value = new Map(
        props.items.map((item) => [item.id, citationCache.get(item.id) || []])
      )
    }
  },
  { immediate: true }
)

function areaNameFor(item) {
  const m = item.label?.match(/ in (.+?) \[/)
  return m ? m[1] : item.label
}

function splitName(label) {
  if (!label) return { name: '', author: '' }
  const match = label.match(/^((?:.*\s)?[a-z]\S*)\s+(.+)$/)
  if (!match) return { name: label, author: '' }
  return { name: match[1], author: match[2] }
}

function shortCitation(body) {
  if (!body) return ''
  const m = body.match(/,\s*(\d{4}[a-z]?(?::[^\s,]+)?)\s*$/)
  if (!m) return body
  const year = m[1]
  const authorsStr = body.slice(0, m.index)
  const ampIdx = authorsStr.lastIndexOf('&')
  if (ampIdx < 0 || !authorsStr.slice(0, ampIdx).includes(',')) return body
  return `${authorsStr.split(',')[0].trim()} et al., ${year}`
}
</script>
