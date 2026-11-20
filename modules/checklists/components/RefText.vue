<!--
  A text in which every "placement.yml:N" links to line N of the rules file
  on the Rules tab of the curator page (R46). The link is a route
  (lineLink): ?tab=rules and the route hash #L<N>. In hash mode the address
  reads /#/checklists/curator?curator=1&tab=rules#L120; the router keeps the
  second # as the route's hash, and the framework's scrollBehavior scrolls to
  the element with that id. A query-only link (?line=N, the first version)
  was scrolled back to the top by that same scrollBehavior ({ top: 0 } for
  any navigation without hash), so a click from the Rules tab itself never
  reached the line. The Rules tab (RulesView.vue) marks the line and scrolls
  to it when the file loads after the navigation. A click does not reach a
  clickable table row around the link (the OTU table opens a row's lookup).

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
    @click.stop
  >{{ part.text }}</RouterLink><template v-else>{{ part.text }}</template></template></span>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { splitRefs, lineLink } from '../placement/overview.js'

const props = defineProps({
  text: { type: String, default: '' }
})

const route = useRoute()
const parts = computed(() => splitRefs(props.text))
const toLine = lineLink(route)
</script>
