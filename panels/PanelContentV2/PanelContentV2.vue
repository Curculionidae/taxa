<template>
  <VCard v-if="topics.length">
    <template
      v-for="topic in topics"
      :key="topic.title"
    >
      <VCardHeader class="border-t border-base-muted first:border-t-0">
        {{ topic.title }}
      </VCardHeader>
      <VCardContent class="panel-content-v2-list">
        <div
          v-for="(entry, index) in topic.entries"
          :key="index"
          class="pt-1 text-sm text-base-content"
        >
          <h3
            v-if="entry.otuNameHtml"
            class="mb-1 text-base font-semibold"
            v-html="enteredUnderHtml(entry.otuNameHtml)"
          />
          <div v-html="entry.text" />
          <div
            v-if="entry.citations.length"
            class="mt-1 text-base-soft"
          >{{ entry.citations.length > 1 ? 'Sources:' : 'Source:' }}<span
              v-for="(citation, citationIndex) in entry.citations"
              :key="citation.id"
              class="ml-1"
            ><button
                type="button"
                class="text-secondary hover:underline cursor-pointer"
                @click="activeCitation = citation"
              >{{ shortCitation(stripHtml(citation.citation_source_body)) }}</button><span v-if="citationIndex < entry.citations.length - 1">;</span></span></div>
        </div>
      </VCardContent>
    </template>
    <ReferenceModal
      :citation="activeCitation"
      @close="activeCitation = null"
    />
  </VCard>
</template>

<script setup>
import { computed, ref, onBeforeMount, onBeforeUnmount } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest'
import { stripHtml, shortCitation } from '../_shared/citationText.js'
import ReferenceModal from '../_shared/ReferenceModal.vue'
import {
  groupByTopic,
  inventoryContent,
  loadContents
} from './contentSources.js'

const props = defineProps({
  otuId: {
    type: Number,
    required: true
  },

  taxon: {
    type: Object,
    default: undefined
  }
})

const contents = ref([])
const activeCitation = ref(null)
const controller = new AbortController()

const topics = computed(() => groupByTopic(contents.value))

// One HTML string, so the space after the label survives Vue's whitespace
// condensing. The name is TaxonWorks' own `object_tag` markup or an escaped
// OTU name, see otuNameHtml().
function enteredUnderHtml(nameHtml) {
  return `<span class="font-normal text-base-soft">Entered under</span> ${nameHtml}`
}

onBeforeMount(() => {
  loadContents(makeAPIRequest, {
    otuId: props.otuId,
    isValid: props.taxon?.is_valid !== false,
    ownRequest: useOtuPageRequest('panel:content-v2', () =>
      inventoryContent(makeAPIRequest, props.otuId, controller.signal)
    ),
    signal: controller.signal
  })
    .then((data) => {
      contents.value = data
    })
    .catch(() => {})
})

onBeforeUnmount(() => {
  controller.abort()
})
</script>

<style>
.panel-content-v2-list {
  ul {
    margin: 1rem 0;
    list-style: disc;
    margin-left: 1rem;
  }

  ol {
    list-style-type: decimal;
    margin-left: 1rem;
  }
}
</style>
