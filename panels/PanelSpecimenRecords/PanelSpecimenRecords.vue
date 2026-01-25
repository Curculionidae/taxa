<template>
  <div class="flex flex-col gap-3">
    <ListTypeSpecimens
      v-if="typeSpecimenRecords.length"
      :list="typeSpecimenRecords"
      :max="MAX"
      @select="setCurrentImages"
    />

    <ListSpecimens
      :list="specimenRecords"
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
import { ref, computed, onMounted } from 'vue'
import { makeAPIRequest } from '@/utils'
import ListSpecimens from './components/ListSpecimens.vue'
import ListTypeSpecimens from './components/ListTypeSpecimens.vue'

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
const specimenRecords = computed(() =>
  dwcRecords.value.filter(
    (item) =>
      item.dwc_occurrence_object_type === 'CollectionObject' && !item.typeStatus
  )
)

const typeSpecimenRecords = computed(() =>
  dwcRecords.value.filter(
    (item) =>
      item.dwc_occurrence_object_type === 'CollectionObject' && item.typeStatus
  )
)

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
      dwcRecords.value = data.map((d) => ({
        ...d,
        label: makeSpecimenLabel(d)
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

function makeSpecimenLabel(item) {
  return [
    getCountAndSex(item),
    getDepositoryData(item),
    item.catalogNumber,
    getLocalityData(item),
    getCoordinates(item),
    getCollector(item)
  ]
    .filter(Boolean)
    .join('; ')
}

function getDepositoryData(data) {
  const { institutionCode, institutionID } = data

  if (!institutionCode) return

  return institutionID
    ? `<a href="${institutionID}" target="_blank">${institutionCode}</a>`
    : `<span>${institutionCode}</span>`
}

function getCountAndSex({ individualCount, sex }) {
  return sex
    ? `${individualCount} ${sex}`
    : `${individualCount} specimen${individualCount > 1 ? 's' : ''}`
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
