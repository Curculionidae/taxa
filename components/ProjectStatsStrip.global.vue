<template>
  <div
    class="flex flex-wrap justify-center gap-2 my-4"
    aria-label="Catalog statistics"
  >
    <span
      v-for="p in pills"
      :key="p.key"
      :title="p.title"
      class="inline-flex items-center gap-1.5 rounded-full border border-base-muted bg-base-foreground px-3 py-1 text-base-content cursor-help"
    >
      <span
        class="w-1.5 h-1.5 rounded-full bg-secondary shrink-0"
        aria-hidden="true"
      />
      <AnimateNumber
        class="font-semibold tabular-nums"
        :number="p.count"
        :duration="2600"
      />
      <span class="text-xs">{{ p.label }}</span>
    </span>
  </div>
</template>

<script setup>
// The "project at a glance" figures under the hero images on the home page.
// Pattern borrowed from sfg-taxonpages/orthoptera SectionData.vue: seed each
// figure with a rough estimate so the count-up starts immediately, then let the
// /stats call (and the validity-scoped taxon-name query that ValidSpeciesCount
// still runs for pages/about.md) overwrite each with the real number, which
// re-drives <AnimateNumber>. Seeds are deliberately BELOW the real figures so
// the correction only ever counts upward; the catalog only grows. A failed
// request just leaves the estimate showing.
//
// weevilNames / plantNames back the "taxon names" tooltip only (not animated):
// they come from two extra header-count queries so the "how many of these are
// non-weevil / plant names" line stays live rather than a written-in guess.
// Both seed as null and the tooltip only spells out the breakdown once every
// figure it needs is a real fetched number (see the sanity guard in the title
// function) — a half-loaded or failed pair never renders a bogus subtraction.

import { reactive, computed, onMounted } from 'vue'
import { makeAPIRequest } from '@/utils'
import AnimateNumber from './AnimateNumber.vue'
import {
  CURCULIONOIDEA_TAXON_NAME_ID,
  fetchValidSpeciesCount
} from './lib/validSpeciesCount.js'

// The root this catalog covers.
const ROOT_TAXON_NAME_ID = CURCULIONOIDEA_TAXON_NAME_ID

// Roughly two thirds of the current real figures: enough runway that the
// correction is a visible continuation, never a jump, and always upward.
const counts = reactive({
  species: 14000,
  names: 22000,
  weevilNames: null,
  plantNames: null,
  specimens: 16000,
  distributions: 32000,
  bioassoc: 1900,
  images: 800,
  refs: 4800
})

const META = [
  {
    key: 'species',
    label: 'valid species',
    title: 'Valid species-rank names within Curculionoidea (excludes synonyms).'
  },
  {
    key: 'names',
    label: 'taxon names',
    title: (c) => {
      const base =
        'Every scientific name in the project, all ranks, valid and invalid.'
      // Only add the breakdown when every figure it needs is a real fetched
      // number and the arithmetic is sane (a failed /stats leaves c.names at
      // its seed, which can be below the weevil-only count).
      if (
        c.weevilNames == null ||
        c.plantNames == null ||
        c.names <= c.weevilNames
      )
        return base
      const nonWeevil = c.names - c.weevilNames
      return (
        base +
        ` Includes ${nonWeevil.toLocaleString()} names outside Curculionoidea ` +
        `(host plants and other taxa in biological associations), ` +
        `${c.plantNames.toLocaleString()} of them plants.`
      )
    }
  },
  {
    key: 'specimens',
    label: 'specimen records',
    title:
      'Physical specimens (collection objects) plus field occurrence records.'
  },
  {
    key: 'distributions',
    label: 'asserted distributions',
    title: 'Published records of a taxon occurring in a geographic area.'
  },
  {
    key: 'bioassoc',
    label: 'biological associations',
    title:
      'Recorded interactions between organisms (host plants, parasites, predators, …).'
  },
  {
    key: 'images',
    label: 'images',
    title: 'Image files in the database.'
  },
  {
    key: 'refs',
    label: 'references',
    title: 'Published works (papers, books) cited in the catalog.'
  }
]

const pills = computed(() =>
  META.map((m) => ({
    ...m,
    count: counts[m.key],
    title: typeof m.title === 'function' ? m.title(counts) : m.title
  }))
)

onMounted(() => {
  makeAPIRequest
    .get('/stats')
    .then(({ data }) => {
      const d = data?.data || {}
      const num = (k) => (typeof d[k] === 'number' ? d[k] : null)
      const co = num('Collection objects')
      const fo = num('Field occurrences')
      if (co != null || fo != null) counts.specimens = (co || 0) + (fo || 0)
      if (num('Taxon names') != null) counts.names = num('Taxon names')
      if (num('Asserted distributions') != null)
        counts.distributions = num('Asserted distributions')
      if (num('Biological associations') != null)
        counts.bioassoc = num('Biological associations')
      if (num('Images') != null) counts.images = num('Images')
      if (num('Project sources') != null) counts.refs = num('Project sources')
    })
    .catch(() => {})

  fetchValidSpeciesCount()
    .then((total) => {
      if (total != null) counts.species = total
    })
    .catch(() => {})

  // Non-weevil share of "Taxon names": total (from /stats) minus everything
  // under Curculionoidea. Header count only, feeds the tooltip.
  makeAPIRequest
    .get('/taxon_names.json', {
      params: {
        per: 1,
        taxon_name_id: [ROOT_TAXON_NAME_ID],
        descendants: true
      }
    })
    .then((response) => {
      const total = Number(response.headers['pagination-total'])
      if (Number.isFinite(total)) counts.weevilNames = total
    })
    .catch(() => {})

  // Of those non-weevil names, how many are botanical (ICN code).
  makeAPIRequest
    .get('/taxon_names.json', {
      params: { per: 1, nomenclature_group: 'Icn' }
    })
    .then((response) => {
      const total = Number(response.headers['pagination-total'])
      if (Number.isFinite(total)) counts.plantNames = total
    })
    .catch(() => {})
})
</script>
