<!--
  Rules tab of the curator page (CuratorPage.vue): the decision order and
  every rule of the rules file as the build compiled it (public/checklists/
  rules.json), grouped by section (placement/overview.js ruleSections). Each
  rule shows its line (placement.yml:N, the line to edit), what it matches,
  what it does, and its why or measured share. The overlap section is long
  and starts closed.

  Props
    loadRules  () => Promise<rules.json>
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
      <p class="mt-1">
        Then the part (France), the state (for checklists browsed by state) and the outline.
        Specimens and field occurrences go by their DwC country, else their coordinates.
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
                {{ row.ref }}
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
  </section>
</template>

<script setup>
import { onMounted, ref, shallowRef } from 'vue'
import { ruleSections, DECISION_ORDER } from '../placement/overview.js'

const props = defineProps({
  loadRules: { type: Function, required: true }
})

const sections = shallowRef(null)
const error = ref('')

onMounted(async () => {
  try {
    sections.value = ruleSections(await props.loadRules())
  } catch (failure) {
    error.value = `Could not load rules.json: ${failure?.message || failure}`
  }
})
</script>
