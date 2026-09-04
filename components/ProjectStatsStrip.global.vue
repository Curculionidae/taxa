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

import { reactive, computed, onMounted } from 'vue'
import { makeAPIRequest } from '@/utils'
import AnimateNumber from './AnimateNumber.vue'

// TaxonWorks taxon_name id for Curculionoidea — the root the catalog covers.
const ROOT_TAXON_NAME_ID = 809411

// Roughly two thirds of the current real figures: enough runway that the
// correction is a visible continuation, never a jump, and always upward.
const counts = reactive({
  species: 14000,
  names: 22000,
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
    title: 'All scientific names in the project, every rank, valid and invalid.'
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
  META.map((m) => ({ ...m, count: counts[m.key] }))
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

  makeAPIRequest
    .get('/taxon_names.json', {
      params: {
        per: 1,
        validity: true,
        taxon_name_id: [ROOT_TAXON_NAME_ID],
        rank: ['NomenclaturalRank::Iczn::SpeciesGroup::Species'],
        descendants: true
      }
    })
    .then((response) => {
      const total = Number(response.headers['pagination-total'])
      if (Number.isFinite(total)) counts.species = total
    })
    .catch(() => {})
})
</script>
