<!--
  One area of the curator page's area tree (AreaTree.vue), and its children
  when open. Children are rendered only while the node is open. A group node
  (gazetteers of one ISO code) shows its name and size only. An area line
  (R54): name (key, a TaxonWorks link) · n records · → <checklist> checklist
  with part and state · because: <a few plain words for the deciding step,
  overview.js plainReason> (its rules line); an area not placed shows only
  "not placed: <reason>" with its rules line. Wrapped text stays indented. A
  placement.yml:N in the source tag links to that line on the Rules tab
  (RefText.vue).

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
  <li>
    <!-- The toggle column is fixed; the text column wraps inside itself, so a
         wrapped line stays at this node's indentation. -->
    <div
      class="flex items-baseline gap-x-2 py-0.5"
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
      <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
      <span
        v-if="node.group"
        class="font-medium"
      >{{ node.name }} <span class="font-normal text-base-soft">({{ node.children.length }} {{ node.children.length === 1 ? 'gazetteer' : 'gazetteers' }})</span></span>
      <template v-else-if="node.stub">
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
        <span
          class="text-base-soft"
          aria-hidden="true"
        >·</span>
        <span>{{ node.row.records }} {{ node.row.records === 1 ? 'record' : 'records' }}</span>
        <span
          class="text-base-soft"
          aria-hidden="true"
        >·</span>
        <span :class="outcome.problem ? 'font-semibold text-danger' : ''">{{ outcome.text }}{{ outcome.ref ? ' (' : '' }}<RefText
          v-if="outcome.ref"
          class="font-mono text-xs font-normal"
          :text="outcome.ref"
        />{{ outcome.ref ? ')' : '' }}</span>
        <template v-if="because">
          <span
            class="text-base-soft"
            aria-hidden="true"
          >·</span>
          <span>because: {{ because.text }}{{ because.ref ? ' (' : '' }}<RefText
            v-if="because.ref"
            class="font-mono text-xs"
            :text="because.ref"
          />{{ because.ref ? ')' : '' }}</span>
        </template>
      </template>
      </div>
    </div>
    <ul
      v-if="isOpen && node.children.length"
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
import { decisionOf, plainReason } from '../placement/overview.js'
import RefText from './RefText.vue'
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
// '→ France checklist, part Corsica' or 'not placed: <reason>' (R54).
const outcome = computed(() => {
  const placement = props.node.row?.placement
  if (!placement) return { text: '', problem: false, ref: null }
  // Not placed: the reason says it all; the rules line goes with it, no "because" (R54).
  if (!placement.checklist) return { text: `not placed: ${placement.reason}`, problem: true, ref: plainReason(placement)?.ref ?? null }
  const extra = [placement.part && `part ${placement.part}`, placement.state && `state ${placement.state}`, !placement.shape && 'no outline']
  return { text: [`→ ${placement.checklist.name} checklist`, ...extra.filter(Boolean)].join(', '), problem: decisionOf(placement).problem, ref: null }
})
// 'because: spelling synonym (placement.yml:131)', overview.js plainReason;
// only for placed areas.
const because = computed(() => (props.node.row?.placement?.checklist ? plainReason(props.node.row.placement) : null))
const twUrl = computed(() => {
  const [kind, id] = props.node.key.split(' ')
  return twRecordUrl(kind === 'GZ' ? `/gazetteers/${id}` : `/geographic_areas/${id}`)
})
</script>
