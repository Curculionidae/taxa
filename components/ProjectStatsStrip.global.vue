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
        :duration="1200"
      />
      <span class="text-xs">{{ p.label }}</span>
    </span>
  </div>
</template>

<script setup>
// The "project at a glance" figures under the hero images on the home page.
// The count-up starts at once, toward the last known real figures: the ones
// this browser saw on its last visit (STORAGE_KEY), else the built-in
// BUILT_IN figures. The live requests run alongside. A live figure that lands
// during the 1.2 s count-up moves its end point; one that lands later (/stats
// takes about 3 s) is not shown, since any change after the count reads as a
// break, but is remembered, and the next visit counts straight to it. So a
// figure can lag by one visit, usually by a handful. A failed request
// just leaves the last known figure showing.
//
// "taxon names" is NOT the /stats figure: that one is project-wide and also
// counts the host plants and other taxa that only exist as partners in
// biological associations. It is a header count of the names under
// Curculionoidea instead, same root as "valid species".

import { reactive, computed, onMounted, watch } from 'vue'
import { makeAPIRequest } from '@/utils'
import AnimateNumber from './AnimateNumber.vue'
import {
  CURCULIONOIDEA_TAXON_NAME_ID,
  fetchValidSpeciesCount
} from './lib/validSpeciesCount.js'

// The root this catalog covers.
const ROOT_TAXON_NAME_ID = CURCULIONOIDEA_TAXON_NAME_ID

// The real figures on 2026-11-06. Only a fallback for a first visit; worth
// refreshing now and then: a first visit shows these, not the live ones.
const BUILT_IN = {
  species: 23634,
  names: 37943,
  specimens: 26136,
  distributions: 53840,
  bioassoc: 4329,
  images: 1435,
  refs: 7998
}

const STORAGE_KEY = 'tp-home-stats'

function lastSeen() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY))

    return Object.fromEntries(
      Object.keys(BUILT_IN)
        .filter((key) => Number.isFinite(stored?.[key]))
        .map((key) => [key, stored[key]])
    )
  } catch {
    return {}
  }
}

const counts = reactive({ ...BUILT_IN })

// Remembers live figures for the next visit.
watch(counts, () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(counts))
  } catch {}
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
    title:
      'Every scientific name within Curculionoidea, all ranks, valid and invalid.'
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
  // Read here, not at setup, so a server render and the first client render
  // agree. The count has already started; it just moves its end point.
  Object.assign(counts, lastSeen())

  makeAPIRequest
    .get('/stats')
    .then(({ data }) => {
      const d = data?.data || {}
      const num = (k) => (typeof d[k] === 'number' ? d[k] : null)
      const co = num('Collection objects')
      const fo = num('Field occurrences')
      if (co != null || fo != null) counts.specimens = (co || 0) + (fo || 0)
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

  // Every name under Curculionoidea, all ranks, valid and invalid. Header
  // count only.
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
      if (Number.isFinite(total)) counts.names = total
    })
    .catch(() => {})
})
</script>
