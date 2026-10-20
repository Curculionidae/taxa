<template>
  <div class="container mx-auto box-border">
    <h1 class="text-4xl px-4 md:px-0 mt-6 mb-2 font-bold text-base-content">
      Recently published
    </h1>
    <p class="px-4 md:px-0 mb-6 text-base-soft">
      Sources published in {{ PUBLISHED_SINCE }} or later.
      {{ PUBLISHED_ORDER_HELP }}
    </p>
    <ClientOnly>
      <VSpinner
        v-if="isLoading"
        full-screen
      />
    </ClientOnly>

    <VCard>
      <VCardContent>
        <div class="flex flex-col md:flex-row gap-3 md:items-center mb-4">
          <VPagination
            v-model="pagination.page"
            :total="pagination.total"
            :per="pagination.per"
            @update:modelValue="(page) => loadList(page)"
          />
          <VPaginationInfo :pagination="pagination" />
        </div>

        <VTable>
          <VTableHeader>
            <VTableHeaderRow>
              <VTableHeaderCell class="w-2" />
              <VTableHeaderCell>Sources</VTableHeaderCell>
              <VTableHeaderCell class="whitespace-nowrap">
                Published
              </VTableHeaderCell>
              <VTableHeaderCell class="whitespace-nowrap">Added</VTableHeaderCell>
              <VTableHeaderCell v-if="isCuratorMode" />
            </VTableHeaderRow>
          </VTableHeader>
          <VTableBody>
            <VTableBodyRow
              v-for="item in list"
              :key="item.id"
            >
              <VTableBodyCell
                class="pr-1"
                title="Show OTUs"
              >
                <OtuModal
                  :source-id="item.id"
                  :label="item.cached"
                />
              </VTableBodyCell>
              <VTableBodyCell
                class="break-all text-base-content"
                v-html="sanitizeAndLinkifyHtml(item.cached)"
              />
              <VTableBodyCell
                class="whitespace-nowrap text-base-content align-top"
              >
                {{ formatPublicationDate(item) }}
              </VTableBodyCell>
              <VTableBodyCell class="whitespace-nowrap text-base-content align-top">
                {{ formatAddedDate(item.created_at) }}
              </VTableBodyCell>
              <!-- Curator mode only: edit the source, and its PDF when it has one -->
              <VTableBodyCell
                v-if="isCuratorMode"
                class="whitespace-nowrap text-right align-middle"
              >
                <TwSourceLinks :source-id="item.id" />
              </VTableBodyCell>
            </VTableBodyRow>
          </VTableBody>
        </VTable>

        <div class="flex flex-col md:flex-row gap-3 md:items-center mt-4">
          <VPagination
            v-model="pagination.page"
            :total="pagination.total"
            :per="pagination.per"
            @update:modelValue="(page) => loadList(page)"
          />
          <VPaginationInfo :pagination="pagination" />
        </div>
      </VCardContent>
    </VCard>
  </div>
</template>

<script setup>
import { ref, onBeforeMount } from 'vue'
import { makeAPIRequest, sanitizeAndLinkifyHtml } from '@/utils'
import {
  formatPublicationDate,
  formatAddedDate,
  PUBLISHED_ORDER_HELP
} from './utils/publicationDate.js'
import { createPublishedList } from './utils/publishedList.js'
import OtuModal from './components/OtuModal.vue'
import TwSourceLinks from '../../panels/_shared/curatorMode/TwSourceLinks.vue'
import { useCuratorMode } from '../../panels/_shared/curatorMode/curatorMode.js'

const isCuratorMode = useCuratorMode()

const PER = 25
const CURRENT_YEAR = new Date().getFullYear()

// The list covers this year and the one before.
const PUBLISHED_SINCE = CURRENT_YEAR - 1

const publishedList = createPublishedList(makeAPIRequest)

const list = ref([])
const isLoading = ref(false)
const pagination = ref({ page: 1, total: 0, per: PER })

// Counts the requests, so a slow answer cannot replace a later one.
let lastRequest = 0

function loadList(page = 1) {
  const id = ++lastRequest

  isLoading.value = true

  publishedList
    .getPage({ year_start: PUBLISHED_SINCE, year_end: CURRENT_YEAR }, page, PER)
    .then(({ rows, total }) => {
      if (id !== lastRequest) return

      list.value = rows
      pagination.value = { page, total, per: PER }
    })
    .finally(() => {
      if (id === lastRequest) isLoading.value = false
    })
}

onBeforeMount(() => loadList())
</script>
