<template>
  <VCard>
    <VCardHeader>Field occurrences</VCardHeader>
    <VCardContent :class="isLoading && 'min-h-[6rem]'">
      <VSpinner v-if="isLoading" />
      <ul>
        <li
          v-for="item in items"
          :key="item.id"
          class="flex flex-col text-sm px-2 py-4 gap-2 border-b first:pt-0 last:pb-0 last:border-none"
        >
          <div class="flex flex-col">
            <span>{{ item.typeStatus }}</span>
            <span v-html="item.label" />
          </div>
          <GalleryThumbnailList
            v-if="item.associatedMedia"
            :images="item.associatedMedia"
            class="lg:flex-row gap-2 flex-wrap"
            @select-index="
              (index) => emit('select', { images: item.associatedMedia, index })
            "
          />
        </li>
        <li
          v-if="!showAll && list.length > props.max"
          class="flex justify-start pt-4 px-2 cursor-pointer border-base-muted text-sm"
        >
          <div
            class="h-5 w-5 text-secondary-color opacity-60 mr-2 cursor-pointer"
            @click="() => (isExpanded = !isExpanded)"
          >
            <IconPlusCircle class="h-5 w-5" />
          </div>
          <span @click="() => (showAll = true)"
            >... Show all ... ({{ list.length }})</span
          >
        </li>
      </ul>
    </VCardContent>
  </VCard>
</template>

<script setup>
import GalleryThumbnailList from '@/components/Gallery/GalleryThumbnailList.vue'
import { computed, ref } from 'vue'

const props = defineProps({
  list: {
    type: Array,
    default: () => []
  },

  isLoading: {
    type: Boolean,
    default: false
  },

  max: {
    type: Number,
    default: 2
  }
})

const emit = defineEmits(['select'])

const showAll = ref(false)

const items = computed(() =>
  showAll.value ? props.list : props.list.slice(0, props.max)
)
</script>
