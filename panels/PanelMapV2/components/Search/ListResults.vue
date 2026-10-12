<template>
  <VTable
    v-if="list.length"
    class="shadow-md"
  >
    <VTableHeader>
      <VTableHeaderRow>
        <VTableHeaderCell
          class="w-full flex justify-between box-border items-center"
        >
          <span>OTU ({{ list.length }})</span>
          <IconArrowRight
            class="opacity-50 cursor-pointer w-4 h-4"
            @click="emit('close:table')"
          />
        </VTableHeaderCell>
      </VTableHeaderRow>
    </VTableHeader>
    <VTableBody>
      <VTableBodyRow
        v-for="otu in list"
        :key="otu.id"
      >
        <VTableBodyCell>
          <RouterLink
            v-html="linkFor(otu).html"
            :to="{ name: 'otus-id', params: { id: linkFor(otu).otuId } }"
            @click="() => emit('close')"
          />
        </VTableBodyCell>
      </VTableBodyRow>
    </VTableBody>
  </VTable>
  <div
    v-else
    class="text-lg text-center text-base-lighter align-middle p-4"
  >
    No OTUs found in this area
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { otuLinkFallback, resolveOtuLinks } from '../../../_shared/otuLink.js'

const props = defineProps({
  list: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'close:table'])

// An OTU such as "Carex sp." is shown under that name and links to the page
// of its taxon (otuLink.js).
const links = ref(new Map())
const linkFor = (otu) => links.value.get(String(otu.id)) ?? otuLinkFallback(otu)
watch(
  () => props.list,
  async (list) => {
    const resolved = await resolveOtuLinks(list)
    if (list === props.list) links.value = resolved
  },
  { immediate: true }
)
</script>
