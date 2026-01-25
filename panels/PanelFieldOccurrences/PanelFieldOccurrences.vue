<template>
  <div class="flex flex-col gap-3">
    <ListOccurrences
      :list="dwcRecords"
      :is-loading="isLoading"
      :max="MAX"
      @select="setCurrentImages"
    />

    <ImageViewer
      v-if="isViewerVisible"
      :images="currentImages"
      :index="currentIndex"
      :next="currentImages.length - 1 > currentIndex"
      :previous="currentIndex > 0"
      @select-index="(index) => (currentIndex = index)"
      @next="() => currentIndex++"
      @previous="() => currentIndex--"
      @close="() => (isViewerVisible = false)"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { makeAPIRequest } from '@/utils'
import ListOccurrences from './components/ListOccurrences.vue'

const MAX = 10

const props = defineProps({
  otuId: {
    type: Number,
    required: true
  }
})

const currentIndex = ref(0)
const currentImages = ref([])
const isViewerVisible = ref(false)
const isLoading = ref(false)

const dwcRecords = ref([])

function loadDwc() {
  isLoading.value = true
  makeAPIRequest
    .get(`/otus/${props.otuId}/inventory/dwc.json`)
    .then(async ({ headers, data }) => {
      data.sort((a, b) => {
        if (a.associatedMedia && !b.associatedMedia) {
          return -1
        }
        if (!a.associatedMedia && b.associatedMedia) {
          return 1
        }

        return 0
      })

      for (let i = 0; i < data.length; i++) {
        const item = data[i]

        if (item.associatedMedia) {
          const images = await getMediaImages(item)

          item.associatedMedia = images
        }
      }
      dwcRecords.value = data
        .filter((item) => item.dwc_occurrence_object_type === 'FieldOccurrence')
        .map((d) => ({
          ...d,
          label: makeFieldOccurrenceLabel(d)
        }))
    })
    .finally(() => {
      isLoading.value = false
    })
}

function getLocalityData(data) {
  const area = [
    data.country,
    data.stateProvince,
    data.county,
    data.verbatimLocality
  ]
    .filter(Boolean)
    .join(', ')

  return area
}

function makeFieldOccurrenceLabel(item) {
  return [
    getCountAndSex(item),
    getLocalityData(item),
    getCoordinates(item),
    getCollector(item)
  ]
    .filter(Boolean)
    .join('; ')
}

function getCountAndSex({ individualCount, sex }) {
  return sex
    ? `${individualCount} ${sex}`
    : `${individualCount} occurrence${individualCount > 1 ? 's' : ''}`
}

function getCollector({ recordedBy }) {
  return recordedBy ? `Col. ${recordedBy}` : ''
}

function getCoordinates({ verbatimCoordinates }) {
  const coordinates = verbatimCoordinates?.split(' ').join(', ')

  return coordinates ? `(${coordinates})` : ''
}

onMounted(loadDwc)

async function getMediaImages(item) {
  const links = item.associatedMedia.split('|')
  const promises = []

  links.forEach((link) => {
    promises.push(
      makeAPIRequest.get(link.trim(), {
        params: {
          extend: ['attribution', 'depictions', 'source']
        }
      })
    )
  })

  return await Promise.all(promises).then((responses) => {
    return responses.map((item) => item.data)
  })
}

function setCurrentImages({ images, index }) {
  currentImages.value = images
  currentIndex.value = index
  isViewerVisible.value = true
}
</script>
