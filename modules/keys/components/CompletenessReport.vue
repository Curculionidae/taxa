<template>
  <div class="text-sm [&_i]:italic space-y-3">
    <!-- taxonomy mode: the key-scope headline -->
    <p
      v-if="mode !== 'geography'"
      class="text-base-content"
    >
      Keyed at <strong>{{ report.targetRank }}</strong> level —
      {{ report.coveredCount }} of {{ report.expectedCount }} in the key's scope<span v-if="report.isComplete" class="text-base-soft">&nbsp;(complete)</span>.
    </p>

    <!-- geography mode: the region headline + context notes -->
    <template v-if="mode === 'geography' && geo">
      <p class="text-base-content">
        In <strong>{{ geo.label }}</strong>:
        {{ geo.keyedCount }} of {{ geo.expectedCount }} {{ report.targetRank }}
        recorded there are keyed out<span v-if="geo.isComplete" class="text-base-soft">&nbsp;(complete)</span>.
      </p>
      <p
        v-if="geo.unknownExpected.length"
        class="text-base-soft"
        :title="geo.unknownExpected.join(', ')"
      >
        {{ geo.unknownExpected.length }} in-scope {{ report.targetRank }} have no
        distribution data (grey below, not counted).
      </p>
      <p
        v-if="geo.outOfAreaTerminals.length"
        class="text-base-soft"
      >
        In the key but not recorded from {{ geo.label }}:
        <span v-for="(m, i) in geo.outOfAreaTerminals" :key="m">{{ i ? ', ' : '' }}<i>{{ m }}</i></span>
      </p>
    </template>

    <section v-for="g in report.groups" :key="g.taxon.id">
      <h4 class="font-medium text-base-content">
        <TaxRefLink :taxon="g.taxon" /><span class="text-base-soft text-xs">&nbsp;({{ groupCount(g) }})</span>
      </h4>
      <ul class="ml-4 mt-1 space-y-1">
        <li
          v-for="m in g.members"
          :key="m.taxon.id"
          class="flex items-start gap-1"
          :class="rowClass(m)"
        >
          <span
            class="w-5 shrink-0 text-center font-semibold"
            :class="markClass(m)"
            aria-hidden="true"
          >{{ mark(m) }}</span>
          <span class="flex-1">
            <TaxRefLink
              :taxon="m.taxon"
              :class="nameClass(m)"
            />
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
          :class="rowClass(m)"
        >
          <span
            class="w-5 shrink-0 text-center font-semibold"
            :class="markClass(m)"
            aria-hidden="true"
          >{{ mark(m) }}</span>
          <span class="flex-1">
            <TaxRefLink
              :taxon="m.taxon"
              :class="nameClass(m)"
            />
          </span>
        </li>
      </ul>
    </section>

    <section v-if="report.outOfScope.length">
      <p class="text-base-soft">Referenced but outside the key's scope:</p>
      <ul class="ml-4 list-disc">
        <li v-for="t in report.outOfScope" :key="t.otuId ?? t.name">
          <TaxRefLink :taxon="t" />
        </li>
      </ul>
    </section>
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
const isGeo = computed(() => props.mode === 'geography' && !!geo.value)

// In geography mode a taxon not recorded from the selection (out / unknown) is
// greyed and loses its key-presence colour; only in-area taxa keep the ✓ / ✗.
const greyed = (m) => isGeo.value && m.geoStatus !== 'in'

const rowClass = (m) => {
  if (greyed(m)) return 'opacity-50'
  return m.status === 'missing' ? 'border-l-2 border-danger pl-2 -ml-2' : ''
}
const mark = (m) => {
  if (greyed(m)) return '·'
  return m.status === 'included' ? '✓' : '✗'
}
const markClass = (m) => {
  if (greyed(m)) return 'text-base-soft'
  return m.status === 'included' ? 'text-success' : 'text-danger'
}
const nameClass = (m) => {
  if (greyed(m)) return 'text-base-soft'
  return m.status === 'missing' ? 'text-danger font-medium' : ''
}

const groupCount = (g) => {
  if (isGeo.value) {
    const inArea = g.members.filter((m) => m.geoStatus === 'in')
    const keyed = inArea.filter((m) => m.status === 'included').length
    return `${keyed} / ${inArea.length} keyed out in ${geo.value.label}`
  }
  const keyed = g.members.filter((m) => m.status === 'included').length
  return `${keyed} / ${g.members.length} keyed out`
}
</script>
