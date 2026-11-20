<!--
  Rules tab of the curator page (CuratorPage.vue): the decision order, every
  rule of the rules file as the build compiled it (public/checklists/
  rules.json), grouped by section (placement/overview.js ruleSections), and
  the rules file itself as the build copied it (public/checklists/
  placement.yml), with line numbers (R46).

  Each rule shows its line (placement.yml:N, a link to that line below), what
  it matches, what it does, and its why or measured share. The overlap
  section is long and starts closed. The file is shown at full length (the
  page scrolls, no scroll box of its own) with YAML colours
  (placement/yamlTokens.js, rendered token by token, no v-html). Every line
  has the id L<N> and a number that links to it. Every placement.yml:N link
  on the curator page (RefText.vue) goes to ?tab=rules with the route hash
  #L<N> (a route hash, so it works in hash mode: /#/checklists/curator?...#L120);
  the framework's scrollBehavior scrolls to that element, this view marks the
  line and scrolls to it itself when the file loads later.

  Props
    loadRules      () => Promise<rules.json>
    loadRulesText  () => Promise<string>, the text of placement.yml
-->
<template>
  <section class="flex flex-col gap-4 text-sm">
    <div>
      <h3 class="text-base font-semibold">
        How an area is placed
      </h3>
      <p>The first that applies decides.</p>
      <ol class="ml-5 mt-1 list-decimal">
        <li
          v-for="line in DECISION_ORDER"
          :key="line"
        >
          {{ line }}
        </li>
      </ol>
      <p class="mt-2">
        Then, once the checklist is known:
      </p>
      <ol
        class="ml-5 mt-1 list-decimal"
        :start="DECISION_ORDER.length + 1"
      >
        <li
          v-for="step in afterSteps"
          :key="step.text"
        >
          {{ step.text }}
          <RefText
            v-if="step.ref"
            class="font-mono text-xs"
            :text="`[${step.ref}]`"
          />
        </li>
      </ol>
      <p class="mt-2">
        Specimens and field occurrences go by their DwC country, else their coordinates.
        Coordinates just outside every outline but within {{ tolerance.text }} of one count for that outline, as a coastal point<template v-if="tolerance.ref">
          (<RefText
            class="font-mono text-xs"
            :text="tolerance.ref"
          />)</template>.
      </p>
    </div>

    <p
      v-if="error"
      role="status"
    >
      {{ error }}
    </p>
    <p
      v-else-if="!sections"
      role="status"
    >
      Loading
    </p>

    <details
      v-for="section in sections ?? []"
      :key="section.name"
      class="rounded-md border border-base-border bg-base-foreground"
      :open="!section.collapsed"
    >
      <summary class="cursor-pointer px-3 py-2 font-semibold">
        {{ section.name }} <span class="font-normal">({{ section.rows.length }})</span>
      </summary>
      <div class="overflow-x-auto px-3 pb-3">
        <table class="w-full border-collapse text-left">
          <thead>
            <tr class="border-b border-base-border">
              <th class="py-1.5 pr-3 font-semibold">Line</th>
              <th class="py-1.5 pr-3 font-semibold">Match</th>
              <th class="py-1.5 pr-3 font-semibold">Action</th>
              <th class="py-1.5 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in section.rows"
              :key="`${row.ref}:${row.match}`"
              class="border-b border-base-muted align-top"
            >
              <td class="whitespace-nowrap py-1 pr-3 font-mono text-xs">
                <RefText :text="row.ref ?? ''" />
              </td>
              <td class="py-1 pr-3">
                {{ row.match }}
              </td>
              <td class="py-1 pr-3">
                {{ row.action }}
              </td>
              <td class="py-1">
                {{ row.why }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <div
      v-if="fileLines"
      class="rounded-md border border-base-border bg-base-foreground"
    >
      <h3 class="px-3 py-2 font-semibold">
        placement.yml <span class="font-normal">as built ({{ fileLines.length }} lines)</span>
      </h3>
      <!-- The whole file at full length: no scroll box of its own, the page
           scrolls. Long lines wrap inside the block. -->
      <div
        class="yaml-view border-t border-base-border pb-2 font-mono text-xs leading-relaxed"
        role="region"
        aria-label="placement.yml with line numbers"
      >
        <div
          v-for="(tokens, index) in fileLines"
          :id="`L${index + 1}`"
          :key="index"
          class="flex scroll-mt-4"
          :class="marked === index + 1 ? 'bg-base-muted font-semibold' : ''"
        >
          <RouterLink
            :to="toLine(index + 1)"
            class="w-12 shrink-0 select-none pr-3 text-right text-base-soft hover:text-secondary"
            :aria-label="`Line ${index + 1}`"
          >
            {{ index + 1 }}
          </RouterLink>
          <span class="min-w-0 whitespace-pre-wrap break-words pr-3"><span
            v-for="(token, position) in tokens"
            :key="position"
            :class="`yaml-${token.kind}`"
          >{{ token.text }}</span>{{ tokens.length ? '' : ' ' }}</span>
        </div>
      </div>
    </div>
    <p
      v-else-if="fileError"
      role="status"
    >
      {{ fileError }}
    </p>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ruleSections, afterDecisionSteps, lineLink, DECISION_ORDER } from '../placement/overview.js'
import RefText from './RefText.vue'
import { tokenizeYaml } from '../placement/yamlTokens.js'
import '../data/checklist-tokens.css'

const props = defineProps({
  loadRules: { type: Function, required: true },
  loadRulesText: { type: Function, default: null }
})

const route = useRoute()
const rules = shallowRef(null)
const sections = computed(() => (rules.value ? ruleSections(rules.value) : null))
const afterSteps = computed(() => afterDecisionSteps(rules.value))
// The coastal tolerance of the rules file, in words: '0.05 degrees (about 5 km)'.
const tolerance = computed(() => {
  const { degrees = 0, ref: line = null } = rules.value?.coastalTolerance ?? {}
  return { text: `${degrees} degrees (about ${Math.max(1, Math.floor(degrees * 111))} km)`, ref: line }
})
const error = ref('')
const fileLines = shallowRef(null)
const fileError = ref('')
// The marked line: the route hash #L120 (overview.js lineLink); ?line=120
// from older links still works.
const marked = computed(() => {
  const found = /^#L(\d+)$/.exec(route.hash ?? '') ?? /^(\d+)$/.exec(String(route.query.line ?? ''))
  return found ? Number(found[1]) : null
})

const toLine = lineLink(route)

// Scroll the marked line into view. A click on a line link is a navigation,
// and the framework's scrollBehavior then scrolls to the element of the route
// hash (or to the top without one); this runs after it, on the next frame,
// and only when the line is still out of view (the file loaded later, or the
// router scrolled before it was there).
async function scrollToMarked() {
  if (!marked.value || !fileLines.value || typeof document === 'undefined') return
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const element = document.getElementById(`L${marked.value}`)
  const box = element?.getBoundingClientRect()
  if (box && (box.top < 0 || box.bottom > window.innerHeight)) element.scrollIntoView({ block: 'center' })
}
watch([marked, fileLines], scrollToMarked)

onMounted(async () => {
  try {
    rules.value = await props.loadRules()
  } catch (failure) {
    error.value = `Could not load rules.json: ${failure?.message || failure}`
  }
  if (!props.loadRulesText) return
  try {
    fileLines.value = tokenizeYaml(await props.loadRulesText())
  } catch (failure) {
    fileError.value = `Could not load placement.yml: ${failure?.message || failure}`
  }
})
</script>

<style scoped>
/* YAML colours: theme tokens and the module's --pp-yaml-* tokens
   (data/checklist-tokens.css), readable in light and dark mode. */
.yaml-key { color: var(--tp-secondary); }
.yaml-comment { color: var(--pp-yaml-comment); font-style: italic; }
.yaml-string { color: var(--pp-yaml-string); }
.yaml-number,
.yaml-boolean { color: var(--pp-yaml-number); }
.yaml-dash,
.yaml-colon,
.yaml-bracket { color: var(--tp-base-lighter); }
.yaml-text { color: var(--tp-base-content); }
</style>
