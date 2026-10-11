<template>
  <div class="container mx-auto box-border">
    <h1 class="text-4xl px-4 md:px-0 mt-6 mb-6 font-bold">Bibliography</h1>
    <ClientOnly>
      <VSpinner
        v-if="isLoading"
        full-screen
      />
    </ClientOnly>
    <VCard class="mb-4">
      <VCardContent>
        <div
          class="flex flex-col md:flex-row justify-center items-center gap-4 md:gap-2 text-sm"
        >
          <div class="flex flex-col w-full">
            <label>In citation</label>
            <InputText
              class="w-full"
              type="text"
              placeholder='Search anywhere in the citation... for example: "Meregalli 2009 Pachycerus"'
              v-model="parameters.query_term"
              @keypress.enter="() => loadList()"
            />
          </div>
          <div class="flex flex-col w-full md:w-96">
            <label>Author(s)</label>
            <InputText
              class="w-full"
              type="text"
              placeholder="Type..."
              v-model="parameters.author"
              @keypress.enter="() => loadList()"
            />
          </div>
          <div class="w-full md:w-auto">
            <span>Published between:</span>
            <div class="flex flex-row gap-2">
              <YearPicker
                v-model="parameters.year_start"
                :min="MIN_YEAR"
                :max="MAX_YEAR"
              />
              <VSlider
                class="w-full md:w-64"
                :min="MIN_YEAR"
                :max="MAX_YEAR"
                v-model:start="parameters.year_start"
                v-model:end="parameters.year_end"
              />
              <YearPicker
                v-model="parameters.year_end"
                :min="MIN_YEAR"
                :max="MAX_YEAR"
              />
            </div>
          </div>
          <div class="flex flex-row gap-2 md:self-end">
            <VButton
              @click="() => loadList()"
              >Search</VButton
            >
            <VButton
              @click="() => reset()"
            >
              Reset
            </VButton>
          </div>
        </div>
      </VCardContent>
    </VCard>

    <VCard>
      <VCardContent>
        <div class="flex flex-row justify-between items-center mb-4">
          <div class="flex flex-col md:flex-row gap-3 md:items-center">
            <VPagination
              v-model="pagination.page"
              :total="pagination.total"
              :per="pagination.per"
              @update:modelValue="
                (page) => {
                  loadList(page)
                }
              "
            />
            <VPaginationInfo :pagination="pagination" />
          </div>
          <div class="flex flex-row items-center gap-3">
            <span
              v-if="hasDownloadFailed"
              class="text-sm text-danger"
            >
              Download failed, please try again.
            </span>
            <VButton
              size="sm"
              :disabled="isDownloading"
              title="Download the whole bibliography as a BibTeX file"
              @click="() => downloadBibliography()"
            >
              {{ isDownloading ? 'Preparing file...' : 'Download .bib' }}
            </VButton>
            <DropdownMenu :request="requestData" />
          </div>
        </div>
        <VTable>
          <VTableHeader>
            <VTableHeaderRow>
              <VTableHeaderCell class="w-2" />
              <VTableHeaderCell> Sources </VTableHeaderCell>
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
                class="break-all"
                v-html="sanitizeAndLinkifyHtml(item.cached)"
              />
            </VTableBodyRow>
          </VTableBody>
        </VTable>
        <div class="flex flex-col md:flex-row gap-3 md:items-center mt-4">
          <VPagination
            v-model="pagination.page"
            :total="pagination.total"
            :per="pagination.per"
            @update:modelValue="
              (page) => {
                loadList(page)
              }
            "
          />
          <VPaginationInfo :pagination="pagination" />
        </div>
      </VCardContent>
    </VCard>
  </div>
</template>

<script setup>
import { ref, onBeforeMount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPagination, getAll, toBibtex } from '../utils'
import { makeAPIRequest, sanitizeAndLinkifyHtml } from '@/utils'
import DropdownMenu from '../components/DropdownMenu.vue'
import YearPicker from '../components/YearPicker.vue'
import VSlider from '../components/VSlider.vue'
import OtuModal from '../components/OtuModal.vue'

const PER = 50
const MIN_YEAR = 1650
const MAX_YEAR = new Date().getFullYear()

const route = useRoute()
const router = useRouter()

const parameters = ref({})
const list = ref([])
const isLoading = ref(false)
const pagination = ref({ page: 1, total: 0, per: PER })
const requestData = ref()

const isDownloading = ref(false)
const hasDownloadFailed = ref(false)

// Always the whole project bibliography, whatever the filters say.
function downloadBibliography() {
  isDownloading.value = true
  hasDownloadFailed.value = false

  getAll(makeAPIRequest, '/sources', { in_project: true })
    .then((sources) => {
      sources.sort(
        (a, b) =>
          (a.author || '').localeCompare(b.author || '') ||
          (a.year || 0) - (b.year || 0)
      )

      const url = URL.createObjectURL(
        new Blob([toBibtex(sources)], {
          type: 'application/x-bibtex;charset=utf-8'
        })
      )
      const link = document.createElement('a')

      link.href = url
      link.download = 'bibliography.bib'
      link.click()
      URL.revokeObjectURL(url)
    })
    .catch(() => {
      hasDownloadFailed.value = true
    })
    .finally(() => {
      isDownloading.value = false
    })
}

async function loadList(page = 1) {
  isLoading.value = true

  makeAPIRequest
    .get('/sources', {
      params: {
        in_project: true,
        page,
        per: pagination.value.per,
        ...parameters.value
      }
    })
    .then(({ data, headers, request }) => {
      pagination.value = getPagination(headers)
      list.value = data

      requestData.value = {
        data,
        url: request.responseURL
      }

      setQuery()
    })
    .finally(() => {
      isLoading.value = false
    })
}

function setParameters(data = {}) {
  parameters.value = {
    year_start: Number(data.year_start || MIN_YEAR),
    year_end: Number(data.year_end || MAX_YEAR),
    author: data.author,
    query_term: data.query_term
  }
}

function setPagination(data = {}) {
  pagination.value = {
    page: Number(data.page) || 1,
    total: 0,
    per: PER
  }
}

function reset() {
  setParameters()
  setPagination()
  loadList()
}

function setQuery() {
  router.push({
    query: { ...parameters.value, page: pagination.value.page }
  })
}

onBeforeMount(() => {
  setParameters(route.query)
  setPagination(route.query)
  loadList(pagination.value.page)
})
</script>
