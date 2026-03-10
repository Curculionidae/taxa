<template>
  <VCard>
    <VCardHeader>Observations</VCardHeader>
    <VCardContent class="min-h-[6rem]">
      <ClientOnly>
        <VSpinner v-if="isLoading" />
      </ClientOnly>

      <div
        v-if="!isLoading && taxonId === null"
        class="text-xl text-center my-8 w-full"
      >
        No iNaturalist taxon found.
      </div>

      <div
        v-if="!isLoading && taxonId !== null && !observations.length"
        class="text-xl text-center my-8 w-full"
      >
        No records found.
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-3">
        <div
          v-for="observation in observations"
          :key="observation.id"
        >
          <a
            v-if="observation?.observation_photos[0]"
            :href="`https://www.inaturalist.org/observations/${observation.id}`"
            class="block hover:opacity-80 transition"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div class="aspect-[3/2] overflow-hidden rounded">
              <img
                class="w-full h-full object-cover"
                :src="observation.observation_photos[0].photo.url.replace('square', 'medium')"
              />
            </div>
          </a>
        </div>
      </div>

      <VPagination
        v-if="observations.length"
        class="mt-4"
        v-model="pagination.page"
        :total="pagination.total_results"
        :per="pagination.per_page"
        @update:modelValue="
          (value) => {
            loadObservations({ page: value, per_page: perPage })
          }
        "
      />
    </VCardContent>
  </VCard>
</template>

<script setup>
/**
 * PaneliNaturalist.vue
 *
 * Displays research-grade iNaturalist observation photos for a given taxon.
 *
 * WHY taxon_id INSTEAD OF taxon_name
 * ------------------------------------
 * The iNaturalist observations API accepts either a taxon_name (fuzzy text
 * search) or a taxon_id (exact match). Using taxon_name is unreliable because:
 *   - It can match the parent genus instead of a subgenus
 *   - It can match unrelated taxa with similar names
 *
 * Instead, we first resolve the TaxonWorks name to an exact iNaturalist
 * taxon_id via the iNat /v1/taxa endpoint, then use that ID for the
 * observations query.
 *
 * WHY SUBGENERA NEED SPECIAL HANDLING
 * -------------------------------------
 * TaxonWorks stores subgenera explicitly, e.g. "Otiorhynchus (Nihus)".
 * iNaturalist also has subgenera, but not all of them — so we attempt a
 * lookup and show nothing if the subgenus is not found on iNat, rather than
 * silently falling back to showing the whole genus.
 *
 * The taxon prop's expanded_name can take these forms:
 *   "Otiorhynchus"              → genus
 *   "Otiorhynchus sulcatus"     → species (no subgenus)
 *   "Otiorhynchus (Nihus)"      → subgenus
 *   "Otiorhynchus (Nihus) sulcatus" → species within a subgenus
 *
 * parseName() splits this into { genus, subgenus, epithet } so each case
 * can be handled correctly when querying iNat.
 */

import { ref, onMounted } from 'vue'
import axios from 'axios'

const props = defineProps({
  taxon: {
    type: Object,
    required: true
  },

  perPage: {
    type: Number,
    default: 12
  },

  parameters: {
    type: Object,
    default: () => {}
  }
})

const isLoading = ref(false)
const observations = ref([])

/**
 * taxonId states:
 *   undefined = not yet looked up (initial state)
 *   null      = lookup done but taxon not found on iNaturalist
 *   number    = valid iNaturalist taxon ID
 */
const taxonId = ref(undefined)

const pagination = ref({
  page: 1,
  per_page: props.perPage,
  total_results: 0
})

/**
 * Parses a TaxonWorks expanded_name into its components.
 *
 * Examples:
 *   "Otiorhynchus (Nihus)"          → { genus: "Otiorhynchus", subgenus: "Nihus",  epithet: null }
 *   "Otiorhynchus (Nihus) sulcatus" → { genus: "Otiorhynchus", subgenus: "Nihus",  epithet: "sulcatus" }
 *   "Otiorhynchus sulcatus"         → { genus: "Otiorhynchus", subgenus: null,      epithet: "sulcatus" }
 *   "Otiorhynchus"                  → { genus: "Otiorhynchus", subgenus: null,      epithet: null }
 */
function parseName(expandedName) {
  const subgenusMatch = expandedName.match(/^(\S+)\s+\((\S+)\)(?:\s+(\S+))?$/)
  if (subgenusMatch) {
    return {
      genus: subgenusMatch[1],
      subgenus: subgenusMatch[2],
      epithet: subgenusMatch[3] || null
    }
  }
  const parts = expandedName.trim().split(/\s+/)
  return {
    genus: parts[0],
    subgenus: null,
    epithet: parts[1] || null
  }
}

/**
 * Resolves the TaxonWorks taxon name to an iNaturalist taxon ID.
 *
 * For subgenera: searches iNat by subgenus name with rank=subgenus, then
 * verifies the parent genus matches via the ancestors list. This prevents
 * accidentally matching a same-named subgenus in a completely different genus.
 *
 * For species and genera: strips subgenus parentheses and searches by the
 * plain binomial or genus name with the appropriate rank filter.
 *
 * Returns the iNat taxon ID (number), or null if not found.
 */
async function resolveInatTaxonId() {
  const { genus, subgenus, epithet } = parseName(props.taxon.expanded_name)

  if (subgenus && !epithet) {
    // Subgenus page: search by subgenus name with rank filter
    const { data } = await axios.get('https://api.inaturalist.org/v1/taxa', {
      params: { q: subgenus, rank: 'subgenus', per_page: 10, all_names: true }
    })

    const match = data.results.find((t) => {
      if (t.name.toLowerCase() !== subgenus.toLowerCase()) return false
      // Verify parent genus via ancestors to avoid false matches
      if (t.ancestors?.length) {
        return t.ancestors.some(
          (a) => a.rank === 'genus' && a.name.toLowerCase() === genus.toLowerCase()
        )
      }
      return true // no ancestors returned, trust the name match
    })

    return match ? match.id : null
  }

  // Species or genus: drop subgenus parentheses, search by plain name
  const plainName = epithet ? `${genus} ${epithet}` : genus
  const rank = epithet ? 'species' : 'genus'

  const { data } = await axios.get('https://api.inaturalist.org/v1/taxa', {
    params: { q: plainName, rank, per_page: 10 }
  })

  const match = data.results.find(
    (t) => t.name.toLowerCase() === plainName.toLowerCase()
  )
  return match ? match.id : null
}

/**
 * Fetches observations from iNaturalist using the resolved taxon_id.
 * Only research-grade observations are shown (better photo quality).
 * Called on mount and again on pagination changes.
 */
async function loadObservations(params = {}) {
  isLoading.value = true

  try {
    // Resolve taxon ID once on first load
    if (taxonId.value === undefined) {
      taxonId.value = await resolveInatTaxonId()
    }

    // Stop if taxon not found on iNat
    if (taxonId.value === null) return

    const { data } = await axios.get('https://api.inaturalist.org/v1/observations', {
      params: {
        taxon_id: taxonId.value,
        quality_grade: 'research',
        ...params,
        ...props.parameters
      }
    })

    observations.value = data.results
    pagination.value = {
      page: data.page,
      per_page: data.per_page,
      total_results: data.total_results
    }
  } catch (e) {
    // Network or API errors fail silently; the spinner stops and no results show
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  loadObservations({ per_page: props.perPage })
})
</script>
