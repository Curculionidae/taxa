<template>
  <IconPlusCircle
    class="size-6 text-secondary cursor-pointer"
    @click="() => (isModalVisible = true)"
  />
  <Teleport to="body">
    <VModal
      v-if="isModalVisible"
      @close="() => (isModalVisible = false)"
    >
      <template #header>
        <div class="flex flex-1 items-start justify-between gap-3">
          <div class="text-sm">
            Bibliography - <span v-html="sanitizeAndLinkifyHtml(label)" />
          </div>
          <TwSourceLinks
            class="p-1"
            icon-class="size-5"
            :source-id="sourceId"
          />
        </div>
      </template>

      <div class="md:max-h-[64vh] min-h-28 px-4 overflow-y-auto pb-4">
        <ClientOnly>
          <VSpinner v-if="isLoading" />
        </ClientOnly>

        <div
          v-if="hasFailed"
          class="text-xl text-center my-8 w-full text-danger"
        >
          The records could not be loaded. Please close this window and try
          again.
        </div>

        <div
          v-else-if="
            !isLoading && !records.otus.length && !records.unlinked.length
          "
          class="text-xl text-center my-8 w-full"
        >
          No records found.
        </div>

        <div v-if="records.otus.length">
          <VPagination
            v-if="records.otus.length > PER"
            class="py-4"
            v-model="page"
            :total="records.otus.length"
            :per="PER"
          />

          <VTable>
            <VTableHeader>
              <VTableHeaderRow>
                <VTableHeaderCell>OTU</VTableHeaderCell>
              </VTableHeaderRow>
            </VTableHeader>
            <VTableBody>
              <VTableBodyRow
                v-for="otu in list"
                :key="otu.id"
              >
                <VTableBodyCell>
                  <RouterLink
                    v-if="otu.otuId"
                    :to="{ name: 'otus-id', params: { id: otu.otuId } }"
                    v-html="otu.object_tag"
                  />
                  <span
                    v-else
                    v-html="otu.object_tag"
                  />
                  <VBadge
                    v-for="item in otu.citedOn"
                    :key="`${item.type}:${item.kind}:${item.pages}`"
                    class="ml-1 cursor-help"
                    :color="getCitationColor(item.type)"
                    :title="describeCitedOn(item).help"
                    shape="pill"
                    size="sm"
                    weight="normal"
                  >
                    {{ getPillText(item) }}
                  </VBadge>
                </VTableBodyCell>
              </VTableBodyRow>
            </VTableBody>
          </VTable>

          <VPagination
            v-if="records.otus.length > PER"
            class="pt-4"
            v-model="page"
            :total="records.otus.length"
            :per="PER"
          />
        </div>

        <div
          v-if="!isLoading && records.unlinked.length"
          class="pt-4 text-sm"
        >
          <span>Also cited on:</span>
          <VBadge
            v-for="item in records.unlinked"
            :key="item.type"
            class="ml-1 cursor-help"
            :color="getCitationColor(item.type)"
            :title="describeCitedOn(item).help"
            shape="pill"
            size="sm"
            weight="normal"
          >
            {{ describeCitedOn(item).label }} ({{ item.count }})
          </VBadge>
        </div>
      </div>
    </VModal>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { makeAPIRequest, sanitizeAndLinkifyHtml } from '@/utils'
import { getSourceRecords, getCitationColor } from '../utils/sourceRecords.js'
import { describeCitedOn } from '../utils/citationLabels.js'
import TwSourceLinks from '../../../panels/_shared/curatorMode/TwSourceLinks.vue'

const PER = 50

const props = defineProps({
  sourceId: {
    type: Number,
    required: true
  },

  label: {
    type: String,
    required: true
  }
})

const isLoading = ref(false)
const hasFailed = ref(false)
const isModalVisible = ref(false)
const records = ref({ otus: [], unlinked: [] })
const page = ref(1)

const list = computed(() =>
  records.value.otus.slice((page.value - 1) * PER, page.value * PER)
)

// "OTU: 22 · Distribution, description": what the source is cited on, the
// pages, then the topics tagged on that citation.
function getPillText(item) {
  const cited = [describeCitedOn(item).label, item.pages]
    .filter(Boolean)
    .join(': ')
  const topics = (item.topics || []).map(({ name }) => name).join(', ')

  return [cited, topics].filter(Boolean).join(' · ')
}

// A failed lookup must not read as "no records", nor leave the records of an
// earlier, successful one on screen.
function loadRecords() {
  isLoading.value = true
  hasFailed.value = false
  page.value = 1
  getSourceRecords(props.sourceId, makeAPIRequest)
    .then((data) => {
      records.value = data
    })
    .catch(() => {
      records.value = { otus: [], unlinked: [] }
      hasFailed.value = true
    })
    .finally(() => {
      isLoading.value = false
    })
}

watch(isModalVisible, (newVal) => {
  if (newVal) {
    loadRecords()
  }
})
</script>
