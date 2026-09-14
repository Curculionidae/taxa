<template>
  <div class="container mx-auto box-border">
    <h1 class="text-4xl px-4 md:px-0 mt-6 mb-2 font-bold text-base-content">
      Recent additions
    </h1>
    <p class="px-4 md:px-0 mb-6 text-base-soft">
      Sources most recently added to the project bibliography, newest first.
    </p>
    <ClientOnly>
      <VSpinner
        v-if="isLoading"
        full-screen
      />
    </ClientOnly>

    <VCard>
      <VCardContent>
        <div class="flex flex-row justify-between items-center mb-4">
          <div class="flex flex-col md:flex-row gap-3 md:items-center">
            <VPagination
              v-model="pagination.page"
              :total="pagination.total"
              :per="pagination.per"
              @update:modelValue="(page) => loadList(page)"
            />
            <VPaginationInfo :pagination="pagination" />
          </div>
          <DropdownMenu :request="requestData" />
        </div>

        <VTable>
          <VTableHeader>
            <VTableHeaderRow>
              <VTableHeaderCell class="w-2" />
              <VTableHeaderCell>Sources</VTableHeaderCell>
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
              <VTableBodyCell class="whitespace-nowrap text-base-content align-top">
                {{ formatDate(item.created_at) }}
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
import { getPagination } from '@/modules/bibliography/utils'
import DropdownMenu from '@/modules/bibliography/components/DropdownMenu.vue'
import OtuModal from '@/modules/bibliography/components/OtuModal.vue'

const PER = 25

const list = ref([])
const isLoading = ref(false)
const pagination = ref({ page: 1, total: 0, per: PER })
const requestData = ref()

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(date))
}

function loadList(page = 1) {
  isLoading.value = true

  makeAPIRequest
    .get('/sources', {
      params: {
        in_project: true,
        recent: true,
        recent_target: 'created_at',
        page,
        per: pagination.value.per
      }
    })
    .then(({ data, headers, request }) => {
      pagination.value = getPagination(headers)
      list.value = data
      requestData.value = { data, url: request.responseURL }
    })
    .finally(() => {
      isLoading.value = false
    })
}

onBeforeMount(() => loadList())
</script>
