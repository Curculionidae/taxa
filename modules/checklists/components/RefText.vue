<!--
  A text in which every "placement.yml:N" links to line N of the rules file
  on the Rules tab of the curator page (R46). The link only changes the route
  query (?tab=rules&line=N), so it works with and without hash mode; the
  Rules tab (RulesView.vue) scrolls to the line and marks it.

  Used for explanations (PlacementLookup.vue), source tags (OtuPlacements.vue,
  AreaTreeNode.vue) and the rule list (RulesView.vue).

  Props
    text  the text, shown as is (whitespace kept, so it works inside <pre>)
-->
<template>
  <span><template
    v-for="(part, index) in parts"
    :key="index"
  ><RouterLink
    v-if="part.line"
    :to="toLine(part.line)"
    class="text-secondary hover:underline"
    :title="`Show line ${part.line} of placement.yml`"
  >{{ part.text }}</RouterLink><template v-else>{{ part.text }}</template></template></span>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { splitRefs } from '../placement/overview.js'

const props = defineProps({
  text: { type: String, default: '' }
})

const route = useRoute()
const parts = computed(() => splitRefs(props.text))

function toLine(line) {
  return { query: { ...route.query, tab: 'rules', line: String(line) } }
}
</script>
