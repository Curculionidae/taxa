<!--
  One area of the curator page's area tree (AreaTree.vue), and its children
  when open. Children are rendered only while the node is open.

  Props
    node      a TreeNode (placement/overview.js buildAreaTree)
    openKeys  the Set of node keys opened by hand
    filtered  a filter is active: open the nodes filterTree marked `open`
    depth     nesting depth, for the indent
  Emits
    toggle (key)   open or close this node
    lookup (key)   look this area up ('GA 32253')
-->
<template>
  <li
    role="treeitem"
    :aria-expanded="node.children.length ? isOpen : undefined"
  >
    <div
      class="flex flex-wrap items-baseline gap-x-2 py-0.5"
      :style="{ paddingLeft: `${depth * 1.25}rem` }"
    >
      <button
        v-if="node.children.length"
        type="button"
        class="w-5 shrink-0 text-center text-base-content"
        :aria-label="`${isOpen ? 'Close' : 'Open'} ${node.name}`"
        @click="emit('toggle', node.key)"
      >
        {{ isOpen ? '▾' : '▸' }}
      </button>
      <span
        v-else
        class="w-5 shrink-0"
      />
      <template v-if="node.stub">
        <span class="text-base-soft">{{ node.name }} (<a
          :href="twUrl"
          target="_blank"
          rel="noopener"
          class="hover:underline"
        >{{ node.key }}</a>), used by no record</span>
      </template>
      <template v-else>
        <button
          type="button"
          class="text-left font-medium text-base-content hover:text-secondary hover:underline"
          :title="`Look up ${node.key}`"
          @click="emit('lookup', node.key)"
        >
          {{ node.name }}
        </button>
        <span>(<a
          :href="twUrl"
          target="_blank"
          rel="noopener"
          class="text-secondary hover:underline"
        >{{ node.key }}</a>)</span>
        <span>{{ node.row.records }} {{ node.row.records === 1 ? 'record' : 'records' }}:</span>
        <span :class="decision.problem ? 'font-semibold text-danger' : ''">{{ decision.text }}</span>
        <span class="font-mono text-xs">{{ decision.tag }}</span>
      </template>
    </div>
    <ul
      v-if="isOpen && node.children.length"
      role="group"
    >
      <AreaTreeNode
        v-for="child in node.children"
        :key="child.key"
        :node="child"
        :open-keys="openKeys"
        :filtered="filtered"
        :depth="depth + 1"
        @toggle="(key) => emit('toggle', key)"
        @lookup="(key) => emit('lookup', key)"
      />
    </ul>
  </li>
</template>

<script setup>
import { computed } from 'vue'
import { decisionOf } from '../placement/overview.js'
import { twRecordUrl } from '../../../panels/_shared/curatorMode/curatorMode.js'

const props = defineProps({
  node: { type: Object, required: true },
  openKeys: { type: Object, required: true },
  filtered: { type: Boolean, default: false },
  depth: { type: Number, default: 0 }
})

const emit = defineEmits(['toggle', 'lookup'])

// A filter opens the nodes on the way to its matches; a click toggles that.
const isOpen = computed(() => (props.filtered && props.node.open) !== props.openKeys.has(props.node.key))
const decision = computed(() => decisionOf(props.node.row.placement) ?? { text: '', tag: '', problem: false })
const twUrl = computed(() => {
  const [kind, id] = props.node.key.split(' ')
  return twRecordUrl(kind === 'GZ' ? `/gazetteers/${id}` : `/geographic_areas/${id}`)
})
</script>
