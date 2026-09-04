<template>
  <div
    class="flex flex-wrap justify-center gap-2 my-4"
    aria-label="Catalog statistics"
  >
    <span
      v-for="p in pills"
      :key="p.key"
      :title="p.title"
      class="inline-flex items-center gap-1.5 rounded-full border border-base-muted bg-base-foreground px-3 py-1 cursor-help"
    >
      <span
        class="w-1.5 h-1.5 rounded-full bg-secondary shrink-0"
        aria-hidden="true"
      />
      <span
        v-if="p.value != null"
        class="font-semibold tabular-nums text-base-content"
      >{{ p.value.toLocaleString() }}</span>
      <span
        v-else-if="p.settled"
        class="font-semibold text-base-soft"
      >&mdash;</span>
      <span
        v-else
        class="inline-block h-3 w-10 rounded animate-pulse bg-base-muted"
        aria-hidden="true"
      />
      <span class="text-xs text-base-soft">{{ p.label }}</span>
    </span>
  </div>
</template>

<script setup>
// The "project at a glance" figures under the hero images on the home page.
// One /stats call feeds every pill except "valid species", which needs its own
// validity-scoped taxon-name query (the same one components/ValidSpeciesCount
// still runs for pages/about.md).

import { ref, computed, onMounted } from 'vue'
import { makeAPIRequest } from '@/utils'

// TaxonWorks taxon_name id for Curculionoidea — the root the catalog covers.
const ROOT_TAXON_NAME_ID = 809411

const stats = ref(null) // /stats "data" object once loaded
const statsSettled = ref(false)
const validSpecies = ref(null)
const speciesSettled = ref(false)

// A /stats entry as a number, or null when absent / not yet loaded.
function stat(key) {
  const v = stats.value?.[key]
  return typeof v === 'number' ? v : null
}

const pills = computed(() => {
  const co = stat('Collection objects')
  const fo = stat('Field occurrences')
  const specimens =
    co == null && fo == null ? null : (co || 0) + (fo || 0)

  return [
    {
      key: 'species',
      label: 'valid species',
      value: validSpecies.value,
      settled: speciesSettled.value,
      title:
        'Valid species-rank names within Curculionoidea (excludes synonyms).'
    },
    {
      key: 'names',
      label: 'taxon names',
      value: stat('Taxon names'),
      settled: statsSettled.value,
      title:
        'All scientific names in the project, every rank, valid and invalid.'
    },
    {
      key: 'specimens',
      label: 'specimen records',
      value: specimens,
      settled: statsSettled.value,
      title:
        'Physical specimens (collection objects) plus field occurrence records.'
    },
    {
      key: 'distributions',
      label: 'asserted distributions',
      value: stat('Asserted distributions'),
      settled: statsSettled.value,
      title: 'Published records of a taxon occurring in a geographic area.'
    },
    {
      key: 'bioassoc',
      label: 'biological associations',
      value: stat('Biological associations'),
      settled: statsSettled.value,
      title:
        'Recorded interactions between organisms (host plants, parasites, predators, …).'
    },
    {
      key: 'images',
      label: 'images',
      value: stat('Images'),
      settled: statsSettled.value,
      title: 'Image files in the database.'
    },
    {
      key: 'refs',
      label: 'references',
      value: stat('Project sources'),
      settled: statsSettled.value,
      title: 'Published works (papers, books) cited in the catalog.'
    }
  ]
})

onMounted(() => {
  makeAPIRequest
    .get('/stats')
    .then(({ data }) => {
      stats.value = data?.data || {}
    })
    .catch(() => {
      stats.value = {}
    })
    .finally(() => {
      statsSettled.value = true
    })

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
      validSpecies.value = Number.isFinite(total) ? total : null
    })
    .catch(() => {})
    .finally(() => {
      speciesSettled.value = true
    })
})
</script>
