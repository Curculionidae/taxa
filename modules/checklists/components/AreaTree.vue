<!--
  Area tree tab of the curator page (CuratorPage.vue): every area of
  public/checklists/areas.json and how the build placed it.

  Three roots, Political, TDWG and Gazetteers (placement/overview.js
  buildAreaTree), areas nested by the position the build compiled from
  TaxonWorks data (areas.json `ancestors`: level ids for political areas,
  TDWG codes for TDWG areas); gazetteers grouped by ISO code. Each area shows its
  name and key (a TaxonWorks link), its record count and its decision in one
  line with the deciding source tag (overview.js decisionOf); parent stubs
  (areas known only as a parent) are muted with "used by no record". Clicking
  an area name opens it in the lookup tab.

  Areas below the top level are collapsed; only expanded nodes render their
  children, so the tree of about 2,600 areas stays fast. The filter box (name
  contains, accent insensitive, or an exact key such as GA 78) and "Problems
  only" (not placeable, or placed without outline; overview.js isProblem)
  reduce the tree to the matches and their ancestors, shown open.

  Props
    loadAreas  () => Promise<areas.json rows>
  Emits
    lookup ('GA 32253')
-->
<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-end gap-3">
      <div class="min-w-[14rem] flex-1 sm:max-w-sm">
        <label
          class="block text-sm font-semibold"
          for="area-tree-filter"
        >
          Filter
        </label>
        <input
          id="area-tree-filter"
          v-model="text"
          type="search"
          autocomplete="off"
          placeholder="Name or key, e.g. Guiana"
          class="mt-1 box-border block w-full min-w-0 rounded-md border border-base-soft bg-base-foreground px-3 py-2 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
      </div>
      <label class="flex items-center gap-2 py-2 text-sm">
        <input
          v-model="problemsOnly"
          type="checkbox"
        >
        Problems only
      </label>
    </div>

    <p
      v-if="error"
      class="text-sm"
      role="status"
    >
      {{ error }}
    </p>
    <p
      v-else-if="!tree"
      class="text-sm"
      role="status"
    >
      Loading areas
    </p>

    <div
      v-for="root in shown"
      v-else
      :key="root.name"
      class="flex flex-col"
    >
      <h3 class="text-base font-semibold">
        {{ root.name }}
        <span class="text-sm font-normal text-base-soft">{{ root.count }} areas, {{ root.problems }} with problems</span>
      </h3>
      <p
        v-if="!root.nodes.length"
        class="text-sm text-base-soft"
      >
        Nothing matches.
      </p>
      <ul
        v-else
        class="text-sm"
      >
        <AreaTreeNode
          v-for="node in root.nodes"
          :key="node.key"
          :node="node"
          :open-keys="openKeys"
          :filtered="filtered"
          :depth="0"
          @toggle="toggle"
          @lookup="(key) => emit('lookup', key)"
        />
      </ul>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { buildAreaTree, filterTree } from '../placement/overview.js'
import AreaTreeNode from './AreaTreeNode.vue'

const props = defineProps({
  loadAreas: { type: Function, required: true }
})

const emit = defineEmits(['lookup'])

const tree = shallowRef(null)
const error = ref('')
const text = ref('')
const problemsOnly = ref(false)
// Keys of the nodes opened by hand ('GA 78'); a filter opens its own, cleared when it changes.
const openKeys = reactive(new Set())

const filtered = computed(() => Boolean(text.value.trim()) || problemsOnly.value)
const shown = computed(() => (tree.value ? filterTree(tree.value, { text: text.value, problemsOnly: problemsOnly.value }) : []))

watch([text, problemsOnly], () => openKeys.clear())

function toggle(key) {
  if (openKeys.has(key)) openKeys.delete(key)
  else openKeys.add(key)
}

onMounted(async () => {
  try {
    tree.value = buildAreaTree(await props.loadAreas())
  } catch (failure) {
    error.value = `Could not load the areas: ${failure?.message || failure}`
  }
})
</script>
