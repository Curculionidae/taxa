<template>
  <div class="container mx-auto box-border">
    <h1 class="text-4xl px-4 md:px-0 mt-6 mb-2 font-bold text-base-content">
      Recent additions
    </h1>
    <p class="px-4 md:px-0 mb-4 text-base-soft">
      {{
        isPublished
          ? `Sources published in ${PUBLISHED_SINCE} or later. ${PUBLISHED_ORDER_HELP}`
          : 'Sources most recently added to the project bibliography, newest first.'
      }}
    </p>
    <SortSwitch
      class="px-4 md:px-0 mb-6"
      :model-value="sort"
      :options="SORT_OPTIONS"
      @update:modelValue="(value) => setSort(value)"
    />
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
              <VTableHeaderCell
                v-if="isPublished"
                class="whitespace-nowrap"
              >
                Published
              </VTableHeaderCell>
              <VTableHeaderCell class="whitespace-nowrap">Added</VTableHeaderCell>
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
                v-if="isPublished"
                class="whitespace-nowrap text-base-content align-top"
              >
                {{ formatPublicationDate(item) }}
              </VTableBodyCell>
              <VTableBodyCell class="whitespace-nowrap text-base-content align-top">
                {{ formatAddedDate(item.created_at) }}
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
import { ref, computed, watch, onBeforeMount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { makeAPIRequest, sanitizeAndLinkifyHtml } from '@/utils'
import { getPagination } from '@/modules/bibliography/utils'
import {
  formatPublicationDate,
  formatAddedDate,
  PUBLISHED_ORDER_HELP
} from './utils/publicationDate.js'
import { createPublishedList } from './utils/publishedList.js'
import OtuModal from './components/OtuModal.vue'
import SortSwitch from './components/SortSwitch.vue'

const PER = 25
const CURRENT_YEAR = new Date().getFullYear()

// "Recently published" covers this year and the one before. The search page
// offers the same order for any range of years.
const PUBLISHED_SINCE = CURRENT_YEAR - 1

const SORT_OPTIONS = [
  { label: 'Recently added', value: 'added' },
  { label: 'Recently published', value: 'published' }
]

const route = useRoute()
const router = useRouter()
const publishedList = createPublishedList(makeAPIRequest)

const list = ref([])
const isLoading = ref(false)
const pagination = ref({ page: 1, total: 0, per: PER })

const isPublished = computed(() => route.query.sort === 'published')
const sort = computed(() => (isPublished.value ? 'published' : 'added'))

function setSort(value) {
  const { sort: _, ...query } = route.query

  router.replace({
    query: value === 'published' ? { ...query, sort: 'published' } : query
  })
}

// Counts the requests, so a slow answer cannot replace a later one.
let lastRequest = 0

function loadList(page = 1) {
  const id = ++lastRequest

  isLoading.value = true

  const request = isPublished.value
    ? publishedList
        .getPage(
          { year_start: PUBLISHED_SINCE, year_end: CURRENT_YEAR },
          page,
          PER
        )
        .then(({ rows, total }) => ({ data: rows, total, page }))
    : makeAPIRequest
        .get('/sources', {
          params: {
            in_project: true,
            recent: true,
            recent_target: 'created_at',
            page,
            per: PER
          }
        })
        .then(({ data, headers }) => ({ data, ...getPagination(headers) }))

  request
    .then(({ data, total, page }) => {
      if (id !== lastRequest) return

      list.value = data
      pagination.value = { page, total, per: PER }
    })
    .finally(() => {
      if (id === lastRequest) isLoading.value = false
    })
}

watch(isPublished, () => loadList())

onBeforeMount(() => loadList())
</script>
