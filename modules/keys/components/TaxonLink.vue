<template>
  <span
    :class="outOfArea ? 'opacity-50' : ''"
    :title="outOfArea ? `not in ${geoLabel}` : undefined"
  >
    <RouterLink
      :to="{ name: 'otus-id', params: { id } }"
      target="_blank"
      rel="noopener"
      :class="variant === 'pill'
        ? 'inline-flex items-center whitespace-nowrap rounded-full bg-secondary/10 px-2.5 py-0.5 text-sm text-secondary hover:bg-secondary/20 hover:underline'
        : 'text-secondary hover:underline'"
    ><span
        v-if="nameHtml"
        v-html="nameHtml"
      /><i v-else>{{ label }}</i><span v-if="authorYear" v-html="authorYearSuffix" /></RouterLink><span
      v-if="validName"
      class="text-base-soft"
    > [= <i>{{ validName }}</i>]</span>
  </span>
</template>

<script setup>
import { inject, computed } from 'vue'

const props = defineProps({
  id: { type: [Number, String], required: true },
  label: { type: String, required: true },
  // 'text' (default) keeps the inline link used in the reachable-taxa list;
  // 'pill' is the right-aligned filled chip used as a lead target in the key views.
  variant: { type: String, default: 'text' },
  // set by a caller that already dims the surrounding lead, so this link does
  // not dim itself on top (opacities would compound)
  suppressGeoDim: { type: Boolean, default: false }
})

const synonymy = inject('keySynonymy', { value: {} })
const validName = computed(() => synonymy.value?.[props.id]?.validName || '')

// Geography filter (design spec 2026-09-02): dim a terminal whose recorded
// territories are all outside the selection. Unknown (no distribution data) and
// in-area terminals are left alone. `props.id` is the target OTU id.
const geo = inject('keyGeo', null)
// A dimmed GuidedChoice card sets this so its inner taxa don't double-dim.
const geoDimSuppressed = inject('geoDimSuppressed', null)
const geoLabel = computed(() => geo?.selectionLabel?.value || 'the selected area')
const outOfArea = computed(() => {
  if (props.suppressGeoDim || geoDimSuppressed?.value) return false
  const eff = geo?.effective?.value
  if (!eff || eff.size === 0) return false
  const set = geo.territoriesByOtu.value.get(Number(props.id))
  if (!set || set.size === 0) return false
  for (const k of set) if (eff.has(k)) return false
  return true
})

// Provided by KeyView: otuId -> { html: "<i>Name</i>", authorYear: "Author, Year" }.
// Falls back to the plain (fully italic) label when the OTU isn't resolved yet.
const taxonNames = inject('keyTaxonNames', { map: {} })
const entry = computed(() => taxonNames.map?.[props.id] || null)
const nameHtml = computed(() => entry.value?.html || '')
const authorYear = computed(() => entry.value?.authorYear || '')
// leading &nbsp; keeps the author on the same line as the name and survives Vue's
// whitespace condensing (a plain leading space in a text node would be stripped)
const authorYearSuffix = computed(() =>
  authorYear.value ? `&nbsp;${escHtml(authorYear.value)}` : ''
)

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
</script>
