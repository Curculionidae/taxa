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
        <p class="mt-3 text-sm text-base-soft">
          Words can be typed in any order. Accents and umlauts matter: search for "Schönherr" does not return
          the same results as "Schoenherr". For a single year, set both ends
          of the range to that year.
        </p>
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
              :title="
                isFiltered
                  ? 'Download the search results as a BibTeX file'
                  : 'Download the whole bibliography as a BibTeX file'
              "
              @click="() => downloadBibliography()"
            >
              {{
                isDownloading
                  ? 'Preparing file...'
                  : isFiltered
                    ? 'Download search results (.bib)'
                    : 'Download whole bibliography (.bib)'
              }}
            </VButton>
            <DropdownMenu :request="requestData" />
          </div>
        </div>
        <VTable>
          <VTableHeader>
            <VTableHeaderRow>
              <VTableHeaderCell class="w-2" />
              <VTableHeaderCell> Sources </VTableHeaderCell>
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
                class="break-all"
                v-html="sanitizeAndLinkifyHtml(item.cached)"
              />
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
import { ref, computed, watch, onBeforeMount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { makeAPIRequest, sanitizeAndLinkifyHtml } from '@/utils'
import DropdownMenu from '@/modules/bibliography/components/DropdownMenu.vue'
import YearPicker from '@/modules/bibliography/components/YearPicker.vue'
import VSlider from '@/modules/bibliography/components/VSlider.vue'
import { createWordSearch, getAllMatches } from './utils/wordSearch.js'
import { toBibtex } from './utils/bibtex.js'
import OtuModal from './components/OtuModal.vue'
import TwSourceLinks from '../../panels/_shared/curatorMode/TwSourceLinks.vue'
import { useCuratorMode } from '../../panels/_shared/curatorMode/curatorMode.js'

const isCuratorMode = useCuratorMode()

const PER = 50
const MIN_YEAR = 1650
const MAX_YEAR = new Date().getFullYear()

const wordSearch = createWordSearch(makeAPIRequest)

const route = useRoute()
const router = useRouter()

const parameters = ref({})
const list = ref([])
const isLoading = ref(false)
const pagination = ref({ page: 1, total: 0, per: PER })
const requestData = ref()

const isDownloading = ref(false)
const hasDownloadFailed = ref(false)

// What the table shows: the filters of the last search that was run, not
// what is typed in the form since.
const searched = ref({})

// The default year range alone is not a search. It is left out then, because
// it would drop the few sources that have no year.
const isFiltered = computed(() => {
  const { year_start, year_end, author, query_term } = searched.value

  return Boolean(
    author ||
      query_term ||
      Number(year_start ?? MIN_YEAR) !== MIN_YEAR ||
      Number(year_end ?? MAX_YEAR) !== MAX_YEAR
  )
})

// The search results, or the whole project bibliography without a search.
function downloadBibliography() {
  isDownloading.value = true
  hasDownloadFailed.value = false

  getAllMatches(makeAPIRequest, {
    in_project: true,
    ...(isFiltered.value ? searched.value : {})
  })
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
      link.download = isFiltered.value
        ? 'bibliography-search.bib'
        : 'bibliography.bib'
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

// Counts the searches, so a slow answer cannot replace a later one.
let lastRequest = 0

// The table, the download and the URL all follow the search that was
// answered, not what has been typed in the form since.
function showList({ filters, replace }, { data, total, page, url }) {
  pagination.value = { page, total, per: PER }
  list.value = data
  searched.value = filters
  requestData.value = { data, url }

  setQuery(toQuery(filters, page), replace)
}

// `replace`: the search comes from the URL (first load, Back, Forward), so
// it must not add a history entry of its own.
function loadList(page = 1, { replace = false } = {}) {
  const filters = { ...parameters.value }
  const id = ++lastRequest

  isLoading.value = true

  // Words are matched in any order, see wordSearch.js.
  wordSearch
    .getPage({ in_project: true, ...filters }, page, PER)
    .then((answer) => {
      if (id !== lastRequest) return

      showList({ filters, replace }, answer)
    })
    .finally(() => {
      if (id === lastRequest) isLoading.value = false
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

// The URL form of a search: strings only, nothing empty.
function toQuery(filters, page) {
  return Object.fromEntries(
    Object.entries({ ...filters, page })
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => [key, String(value)])
  )
}

function isSameQuery(a, b) {
  const keys = Object.keys(a)

  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => String(a[key]) === String(b[key]))
  )
}

// What this page last wrote to the URL, to tell its own changes from a
// Back or Forward.
let writtenQuery = {}

function setQuery(query, replace) {
  writtenQuery = query

  if (isSameQuery(query, route.query)) return

  if (replace) {
    router.replace({ query })
  } else {
    router.push({ query })
  }
}

function loadFromRoute() {
  setParameters(route.query)
  setPagination(route.query)
  loadList(pagination.value.page, { replace: true })
}

// Back and Forward change the URL without going through the form.
watch(
  () => route.query,
  (query) => {
    if (!isSameQuery(query, writtenQuery)) loadFromRoute()
  }
)

onBeforeMount(() => loadFromRoute())
</script>
