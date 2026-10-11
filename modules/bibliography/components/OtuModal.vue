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
        <div class="text-sm">
          Bibliography - <span v-html="sanitizeAndLinkifyHtml(label)" />
        </div>
      </template>

      <div class="md:max-h-[64vh] min-h-28 px-4 overflow-y-auto pb-4">
        <ClientOnly>
          <VSpinner v-if="isLoading" />
        </ClientOnly>

        <div
          v-if="!isLoading && !records.otus.length && !records.unlinked.length"
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
                    :key="`${item.type}:${item.pages}`"
                    class="ml-1"
                    :color="getCitationColor(item.type)"
                    shape="pill"
                    size="sm"
                    weight="normal"
                  >
                    {{ [getTypeLabel(item.type), item.pages].filter(Boolean).join(': ') }}
                  </VBadge>
                  <VBadge
                    v-for="topic in otu.topics"
                    :key="topic.id"
                    class="ml-1"
                    :color="getTopicColor(topic)"
                    :title="topic.definition"
                    shape="pill"
                    size="sm"
                    weight="normal"
                  >
                    {{ topic.name }}
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
            class="ml-1"
            :color="getCitationColor(item.type)"
            shape="pill"
            size="sm"
            weight="normal"
          >
            {{ getTypeLabel(item.type) }} ({{ item.count }})
          </VBadge>
        </div>
      </div>
    </VModal>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { makeAPIRequest, sanitizeAndLinkifyHtml } from '@/utils'
import {
  getSourceRecords,
  getCitationColor,
  getTopicColor
} from '../utils'

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
const isModalVisible = ref(false)
const records = ref({ otus: [], unlinked: [] })
const page = ref(1)

const list = computed(() =>
  records.value.otus.slice((page.value - 1) * PER, page.value * PER)
)

const TYPE_LABELS = {
  TaxonName: 'Name',
  Otu: 'OTU',
  AssertedDistribution: 'Distribution',
  BiologicalAssociation: 'Biological association',
  Content: 'Content',
  CollectionObject: 'Specimen',
  Image: 'Image',
  TaxonNameRelationship: 'Name relationship',
  TaxonNameClassification: 'Name status',
  TypeMaterial: 'Type material',
  Lead: 'Key'
}

// A citation type without a label, e.g. one TaxonWorks adds later, falls back
// to its class name split into words: "FieldOccurrence" becomes
// "Field occurrence".
function getTypeLabel(type) {
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()

  return TYPE_LABELS[type] || words.charAt(0).toUpperCase() + words.slice(1)
}

function loadRecords() {
  isLoading.value = true
  page.value = 1
  getSourceRecords(props.sourceId, makeAPIRequest)
    .then((data) => {
      records.value = data
    })
    .catch(() => {})
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
