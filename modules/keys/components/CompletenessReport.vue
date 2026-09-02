<template>
  <div class="text-sm [&_i]:italic space-y-3">
    <!-- ─────────────── taxonomy mode ─────────────── -->
    <template v-if="mode !== 'geography'">
      <p class="text-base-content">
        Keyed at <strong>{{ report.targetRank }}</strong> level —
        {{ report.coveredCount }} of {{ report.expectedCount }} in the key's scope<span v-if="report.isComplete" class="text-base-soft">&nbsp;(complete)</span>.
      </p>

      <section v-for="g in report.groups" :key="g.taxon.id">
        <h4 class="font-medium text-base-content">
          <TaxRefLink :taxon="g.taxon" /><span class="text-base-soft text-xs">&nbsp;({{ keyedOf(g.members) }} / {{ g.members.length }} keyed out)</span>
        </h4>
        <ul class="ml-4 mt-1 space-y-1">
          <li
            v-for="m in g.members"
            :key="m.taxon.id"
            class="flex items-start gap-1"
            :class="m.status === 'missing' ? 'border-l-2 border-danger pl-2 -ml-2' : ''"
          >
            <span class="w-5 shrink-0 text-center font-semibold" :class="m.status === 'included' ? 'text-success' : 'text-danger'" aria-hidden="true">{{ m.status === 'included' ? '✓' : '✗' }}</span>
            <span class="flex-1">
              <TaxRefLink :taxon="m.taxon" :class="m.status === 'missing' ? 'text-danger font-medium' : ''" />
              <ul v-if="m.synonyms.length" class="ml-5 text-base-soft">
                <li v-for="s in m.synonyms" :key="s.id">= <TaxRefLink :taxon="s" /></li>
              </ul>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="report.ungrouped.length">
        <h4 class="font-medium text-base-content">Not placed in a lower group</h4>
        <ul class="ml-4 mt-1 space-y-1">
          <li
            v-for="m in report.ungrouped"
            :key="m.taxon.id"
            class="flex items-start gap-1"
            :class="m.status === 'missing' ? 'border-l-2 border-danger pl-2 -ml-2' : ''"
          >
            <span class="w-5 shrink-0 text-center font-semibold" :class="m.status === 'included' ? 'text-success' : 'text-danger'" aria-hidden="true">{{ m.status === 'included' ? '✓' : '✗' }}</span>
            <span class="flex-1"><TaxRefLink :taxon="m.taxon" :class="m.status === 'missing' ? 'text-danger font-medium' : ''" /></span>
          </li>
        </ul>
      </section>

      <section v-if="report.outOfScope.length">
        <p class="text-base-soft">Referenced but outside the key's scope:</p>
        <ul class="ml-4 list-disc">
          <li v-for="t in report.outOfScope" :key="t.otuId ?? t.name"><TaxRefLink :taxon="t" /></li>
        </ul>
      </section>
    </template>

    <!-- ─────────────── geography mode ─────────────── -->
    <template v-else-if="geo">
      <p class="text-base-content">
        In <strong>{{ geo.label }}</strong>:
        {{ geo.keyedCount }} of {{ geo.expectedCount }} {{ report.targetRank }} keyed out<span v-if="geo.isComplete" class="text-base-soft">&nbsp;(complete)</span>.
      </p>

      <!-- 1. the species recorded from the selection, coded for key presence -->
      <section v-for="g in geoGroups" :key="g.taxon.id">
        <h4 class="font-medium text-base-content">
          <TaxRefLink :taxon="g.taxon" /><span class="text-base-soft text-xs">&nbsp;({{ keyedOf(g.members) }} / {{ g.members.length }} keyed out)</span>
        </h4>
        <ul class="ml-4 mt-1 space-y-1">
          <li
            v-for="m in g.members"
            :key="m.taxon.id"
            class="flex items-start gap-1"
            :class="m.status === 'missing' ? 'border-l-2 border-danger pl-2 -ml-2' : ''"
          >
            <span class="w-5 shrink-0 text-center font-semibold" :class="m.status === 'included' ? 'text-success' : 'text-danger'" aria-hidden="true">{{ m.status === 'included' ? '✓' : '✗' }}</span>
            <span class="flex-1">
              <TaxRefLink :taxon="m.taxon" :class="m.status === 'missing' ? 'text-danger font-medium' : ''" />
              <ul v-if="m.synonyms.length" class="ml-5 text-base-soft">
                <li v-for="s in m.synonyms" :key="s.id">= <TaxRefLink :taxon="s" /></li>
              </ul>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="geoUngrouped.length">
        <h4 class="font-medium text-base-content">Not placed in a lower group</h4>
        <ul class="ml-4 mt-1 space-y-1">
          <li
            v-for="m in geoUngrouped"
            :key="m.taxon.id"
            class="flex items-start gap-1"
            :class="m.status === 'missing' ? 'border-l-2 border-danger pl-2 -ml-2' : ''"
          >
            <span class="w-5 shrink-0 text-center font-semibold" :class="m.status === 'included' ? 'text-success' : 'text-danger'" aria-hidden="true">{{ m.status === 'included' ? '✓' : '✗' }}</span>
            <span class="flex-1"><TaxRefLink :taxon="m.taxon" :class="m.status === 'missing' ? 'text-danger font-medium' : ''" /></span>
          </li>
        </ul>
      </section>

      <p v-if="!geoGroups.length && !geoUngrouped.length" class="text-base-soft">
        No {{ report.targetRank }} in the key's scope is recorded from {{ geo.label }} yet.
      </p>

      <!-- 2. everything not recorded from the selection -->
      <section v-if="notRecorded.length">
        <h4 class="font-medium text-base-soft">Not recorded from {{ geo.label }}</h4>
        <ul class="ml-4 mt-1 space-y-0.5 text-base-soft">
          <li v-for="m in notRecorded" :key="m.taxon.id">
            <TaxRefLink :taxon="m.taxon" /><span
              v-if="m.geoStatus === 'unknown'"
              class="text-xs"
            >&nbsp;— no distribution data</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import TaxRefLink from './TaxRefLink.vue'

const props = defineProps({
  report: { type: Object, required: true },
  // 'taxonomy' (default) or 'geography'
  mode: { type: String, default: 'taxonomy' }
})

const geo = computed(() => props.report.geographic || null)
const keyedOf = (members) => members.filter((m) => m.status === 'included').length

const allMembers = computed(() => [
  ...props.report.groups.flatMap((g) => g.members),
  ...props.report.ungrouped
])

// Geography section 1: groups / ungrouped restricted to in-area members.
const geoGroups = computed(() =>
  props.report.groups
    .map((g) => ({ ...g, members: g.members.filter((m) => m.geoStatus === 'in') }))
    .filter((g) => g.members.length)
)
const geoUngrouped = computed(() =>
  props.report.ungrouped.filter((m) => m.geoStatus === 'in')
)

// Geography section 2: everything with distribution info that is not in the
// selection (recorded elsewhere), plus the taxa with no distribution data.
const notRecorded = computed(() =>
  allMembers.value
    .filter((m) => m.geoStatus === 'out' || m.geoStatus === 'unknown')
    .sort((a, b) => a.taxon.name.localeCompare(b.taxon.name))
)
</script>
