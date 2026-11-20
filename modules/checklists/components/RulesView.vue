<!--
  Rules tab of the curator page (CuratorPage.vue): the decision order, every
  rule of the rules file as the build compiled it (public/checklists/
  rules.json), grouped by section (placement/overview.js ruleSections), and
  the rules file itself as the build copied it (public/checklists/
  placement.yml), with line numbers (R46).

  Each rule shows its line (placement.yml:N, a link to that line below), what
  it matches, what it does, and its why or measured share. The overlap
  section is long and starts closed. Every line of the file has the id L<N>
  and a number that links to it; ?line=N in the address (set by every
  placement.yml:N link on the curator page, RefText.vue) scrolls to that line
  and marks it. Only the query changes, never the URL hash, so this works
  with and without hash mode.

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
      <div
        class="max-h-[32rem] overflow-auto border-t border-base-border font-mono text-xs leading-relaxed"
        role="region"
        aria-label="placement.yml with line numbers"
        tabindex="0"
      >
        <div
          v-for="(line, index) in fileLines"
          :id="`L${index + 1}`"
          :key="index"
          class="flex"
          :class="marked === index + 1 ? 'bg-base-muted font-semibold' : ''"
        >
          <RouterLink
            :to="toLine(index + 1)"
            class="w-12 shrink-0 select-none pr-3 text-right text-base-soft hover:text-secondary"
            :aria-label="`Line ${index + 1}`"
          >
            {{ index + 1 }}
          </RouterLink>
          <span class="whitespace-pre pr-3">{{ line || ' ' }}</span>
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
import { ruleSections, afterDecisionSteps, DECISION_ORDER } from '../placement/overview.js'
import RefText from './RefText.vue'

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
const marked = computed(() => (/^\d+$/.test(String(route.query.line ?? '')) ? Number(route.query.line) : null))

function toLine(line) {
  return { query: { ...route.query, tab: 'rules', line: String(line) } }
}

// Scroll the marked line into view once the file is shown.
async function scrollToMarked() {
  if (!marked.value || !fileLines.value || typeof document === 'undefined') return
  await nextTick()
  document.getElementById(`L${marked.value}`)?.scrollIntoView({ block: 'center' })
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
    fileLines.value = String(await props.loadRulesText()).replace(/\n$/, '').split('\n')
  } catch (failure) {
    fileError.value = `Could not load placement.yml: ${failure?.message || failure}`
  }
})
</script>
