<template>
  <div class="max-h-64 overflow-y-auto text-xs min-w-80">
    <ul>
      <li
        v-for="{ item, i } in rows"
        :key="i"
        class="relative py-2 last:border-0 border-b"
        :class="[
          specimenFor(item) ? 'cursor-pointer text-secondary hover:underline' : '',
          isCuratorMode && editLinksFor(item).length ? 'pr-14' : ''
        ]"
        @click="specimenFor(item) ? emit('selected', specimenFor(item)) : null"
      >
        <!-- CollectionObject / FieldOccurrence -->
        <template v-if="CLICKABLE_TYPES.includes(item.type)">
          <div class="text-sm font-medium text-base-content">{{ TYPE_LABELS[item.type] }}</div>
          <!-- no name line for a type specimen the store added itself: it has
               no determination to show (item.undetermined) -->
          <div v-if="!item.undetermined" class="text-xs truncate">
            <span class="italic">{{ splitName(targets?.[i]?.label ?? item.label).name }}</span>
            <span v-if="splitName(targets?.[i]?.label ?? item.label).author">
              {{ ' ' + splitName(targets?.[i]?.label ?? item.label).author }}
            </span>
          </div>
          <TypeStatusChip
            class="mt-1"
            :status="typeStatusList(item).join(' | ')"
          />
          <div
            v-if="isAdventiveSpecimen(item)"
            class="mt-1"
            v-html="ADVENTIVE_CHIP_HTML"
          />
        </template>

        <!-- AssertedDistribution / AssertedAbsent — BA-linked variant -->
        <template v-else-if="AD_TYPES.includes(item.type) && isBaLinked(item, targets?.[i])">
          <div class="text-sm font-medium text-base-content">
            Asserted Distribution (Biological Association)<VBadge
              v-for="tag in tagList(item.id)"
              :key="tag"
              class="ml-1"
              color="yellow"
              shape="pill"
              size="sm"
              weight="normal"
            >{{ tag }}</VBadge>
          </div>
          <div class="text-xs mt-0.5">
            <span v-if="baLoading" class="text-base-soft italic">loading...</span>
            <template v-else-if="baDetailsMap.get(item.id)">
              <RouterLink
                :to="`/otus/${baDetailsMap.get(item.id).otherId}/overview`"
                class="text-secondary hover:underline"
              ><span class="italic">{{ splitName(baDetailsMap.get(item.id).otherLabel).name }}</span>{{ splitName(baDetailsMap.get(item.id).otherLabel).author ? ' ' + splitName(baDetailsMap.get(item.id).otherLabel).author : '' }}</RouterLink>
              <span class="mx-1 text-base-soft">/</span>
              <RouterLink
                :to="`/otus/${targets?.[i]?.id}/overview`"
                class="text-secondary hover:underline"
              ><span class="italic">{{ splitName(targets?.[i]?.label ?? '').name }}</span>{{ splitName(targets?.[i]?.label ?? '').author ? ' ' + splitName(targets?.[i]?.label ?? '').author : '' }}</RouterLink>
            </template>
            <!-- fallback while loading or if match fails -->
            <span v-else class="text-base-content">{{ parseBaRelationship(item.label) }}</span>
          </div>
          <div class="mt-1">
            <span v-if="citationsLoading" class="text-base-soft italic">loading...</span>
            <template v-else>
              <button
                v-for="cit in citationsByItemId.get(item.id) || []"
                :key="cit.id"
                class="text-secondary hover:underline mr-2"
                @click.stop="emit('citation-selected', cit)"
              >{{ cit.display }}</button>
            </template>
          </div>
          <div
            v-for="reassessment in reassessmentsByItemId.get(item.id) || []"
            :key="reassessment.citation.id"
            class="mt-1"
          ><b>Reassessed by <button
              class="text-secondary hover:underline"
              @click.stop="emit('citation-selected', reassessment.citation)"
            >{{ reassessment.citation.display }}</button>:</b> {{ reassessment.value }}</div>
        </template>

        <!-- AssertedDistribution / AssertedAbsent — regular -->
        <template v-else-if="AD_TYPES.includes(item.type)">
          <div class="text-sm font-medium text-base-content">
            {{ item.type === ASSERTED_ABSENT ? 'Asserted absent' : 'Asserted distribution' }}<VBadge
              v-for="tag in tagList(item.id)"
              :key="tag"
              class="ml-1"
              color="yellow"
              shape="pill"
              size="sm"
              weight="normal"
            >{{ tag }}</VBadge>
          </div>
          <div class="font-medium truncate">{{ areaNameFor(item) }}</div>
          <div class="text-xs truncate mt-0.5">
            <span class="italic">{{ splitName(targets?.[i]?.label ?? '').name }}</span>
            <span v-if="splitName(targets?.[i]?.label ?? '').author">
              {{ ' ' + splitName(targets?.[i]?.label ?? '').author }}
            </span>
          </div>
          <div class="mt-1">
            <span v-if="citationsLoading" class="text-base-soft italic">loading...</span>
            <template v-else>
              <button
                v-for="cit in citationsByItemId.get(item.id) || []"
                :key="cit.id"
                class="text-secondary hover:underline mr-2"
                @click.stop="emit('citation-selected', cit)"
              >{{ cit.display }}</button>
            </template>
          </div>
          <div
            v-for="reassessment in reassessmentsByItemId.get(item.id) || []"
            :key="reassessment.citation.id"
            class="mt-1"
          ><b>Reassessed by <button
              class="text-secondary hover:underline"
              @click.stop="emit('citation-selected', reassessment.citation)"
            >{{ reassessment.citation.display }}</button>:</b> {{ reassessment.value }}</div>
        </template>

        <!-- TypeMaterial: its specimen has no determination, so it never
             arrives as a CollectionObject row of its own. Once the specimen is
             found (resolveTypeSpecimens) the row gets the same heading as the
             CollectionObject row above, minus the determined name. Redundant
             TypeMaterial rows are already dropped from `rows` (see
             typeMaterialIsDuplicate). -->
        <template v-else-if="item.type === TYPE_MATERIAL">
          <div
            v-if="specimenFor(item)"
            class="text-sm font-medium text-base-content mb-1"
          >
            {{ TYPE_LABELS[COLLECTION_OBJECT] }}
          </div>
          <TypeStatusChip :status="item.label" />
        </template>

        <!-- other bare types -->
        <span
          v-else
          class="truncate"
          v-html="escapeHtml(item.label)"
        />

        <!-- Curator mode only: edit the record(s) of this row in TaxonWorks.
             `!` because Leaflet's popup CSS colours every link blue. -->
        <span
          v-if="isCuratorMode && editLinksFor(item).length"
          class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1.5"
        >
          <TwEditLink
            v-for="link in editLinksFor(item)"
            :key="link.href"
            :href="link.href"
            :title="link.title"
            icon-class="size-4"
            class="!text-base-soft hover:!text-base-content"
          />
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { makeAPIRequest } from '@/utils'
import {
  COLLECTION_OBJECT,
  FIELD_OCCURRENCE,
  ASSERTED_DISTRIBUTION,
  ASSERTED_ABSENT,
  TYPE_MATERIAL
} from '@/constants/objectTypes.js'
import { stripHtml, shortCitation } from '../../_shared/citationText.js'
import { escHtml as escapeHtml, splitScientificName } from '../../_shared/scientificName.js'
import TypeStatusChip from '../../_shared/TypeStatusChip.vue'
import { ADVENTIVE_CHIP_HTML } from '../../_shared/adventive.js'
import { fetchTypeSpecimens, specimenByTypeMaterialId as indexByTypeMaterialId } from '../../_shared/typeMaterialSpecimen.js'
import TwEditLink from '../../_shared/curatorMode/TwEditLink.vue'
import { useCuratorMode, twEditUrl } from '../../_shared/curatorMode/curatorMode.js'

const isCuratorMode = useCuratorMode()

const CLICKABLE_TYPES = [COLLECTION_OBJECT, FIELD_OCCURRENCE]
const AD_TYPES = [ASSERTED_DISTRIBUTION, ASSERTED_ABSENT]

const TYPE_LABELS = {
  [COLLECTION_OBJECT]: 'Collection object',
  [FIELD_OCCURRENCE]: 'Field occurrence'
}

const props = defineProps({
  items: {
    type: Array,
    required: true
  },
  targets: {
    type: Array,
    default: undefined
  },
  // Map<assertedDistributionId, keywordName[]>
  tagsByAdId: {
    type: Object,
    default: () => new Map()
  },
  // Map<collectionObjectId, { kind, statuses: string[] }>
  typeStatusByCoId: {
    type: Object,
    default: () => new Map()
  },
  // Set<"<type>:<id>"> of specimens tagged "Adventive" (_shared/adventive.js)
  adventiveSpecimenKeys: {
    type: Object,
    default: () => new Set()
  }
})

function isAdventiveSpecimen(item) {
  return Boolean(props.adventiveSpecimenKeys?.has?.(`${item.type}:${item.id}`))
}

// keyword names tagged on this AssertedDistribution, rendered as yellow pills
function tagList(adId) {
  return props.tagsByAdId?.get?.(adId) || []
}

// verbatim DwC type-status strings for a CollectionObject ("holotype of X",
// "paratype of X", ...). A specimen can carry more than one.
// The map is keyed by CollectionObject id: a FieldOccurrence with the same
// number is a different record and has no type status.
function typeStatusList(item) {
  if (item.type !== COLLECTION_OBJECT) return []
  return props.typeStatusByCoId?.get?.(item.id)?.statuses || []
}
// A TypeMaterial popup row is redundant only when another row in the SAME popup
// is a CollectionObject that already renders the very same "<type> of <name>"
// status (the DwC typeStatus string is built from the same label helper, so the
// two match exactly). A blanket "any sibling has any status" check would wrongly
// hide an unrelated type — several types georeferenced to one locality get
// merged into a single popup.
function typeMaterialIsDuplicate(item) {
  if (item.type !== TYPE_MATERIAL) return false
  return props.items.some(
    (it) =>
      CLICKABLE_TYPES.includes(it.type) && typeStatusList(it).includes(item.label)
  )
}

// items minus the redundant TypeMaterial rows, keeping each row's original index
// so `targets[i]` still lines up. Filtering here (rather than with a v-if on the
// row) keeps a suppressed row from leaving an empty bordered <li> behind.
const rows = computed(() =>
  props.items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => !typeMaterialIsDuplicate(item))
)

const emit = defineEmits(['selected', 'citation-selected'])

const citationsByItemId = ref(new Map())
const citationsLoading = ref(false)
const baDetailsMap = ref(new Map())   // item.id → { otherId, otherLabel }
const baLoading = ref(false)
const reassessmentsByItemId = ref(new Map())  // AD item.id → { value, citation }[]
const specimenByTypeMaterialId = ref(new Map()) // TypeMaterial item.id → collectionObjectId

// Module-level caches: persist across popup open/close cycles
const citationCache = new Map()    // itemId → citation[]
const baByTargetId = new Map()     // targetId → BaRecord[] from /biological_associations/basic
const baDetailsCache = new Map()   // item.label → { otherId, otherLabel } | null
const reassessmentCache = new Map() // AD id → { value, citation }[]

// A type specimen usually has no taxon determination (its type status is the
// identification), so TaxonWorks does not list it under the OTU: the geojson
// carries only a TypeMaterial entry, whose id is not the specimen's. Look the
// specimen up so the row can open the DwC modal like any CollectionObject row.
async function resolveTypeSpecimens(items) {
  const pending = items
    .map((item, i) => ({ item, otuId: props.targets?.[i]?.id }))
    .filter(({ item, otuId }) => item.type === TYPE_MATERIAL && otuId != null)

  await Promise.all(
    pending.map(async ({ item, otuId }) => {
      // cached per OTU in typeMaterialSpecimen.js (the store asks for it too)
      const coId = indexByTypeMaterialId(await fetchTypeSpecimens(otuId)).get(item.id)
      if (coId != null && specimenByTypeMaterialId.value.get(item.id) !== coId) {
        specimenByTypeMaterialId.value = new Map(specimenByTypeMaterialId.value).set(item.id, coId)
      }
    })
  )
}

// What a click on this row opens in the DwC modal, or null for a dead row.
// Curator mode: the TaxonWorks edit pages for a row. A BA-linked asserted
// distribution gets two, the distribution and its biological association.
function editLinksFor(item) {
  const links = []
  const specimen = specimenFor(item)

  if (specimen?.type === COLLECTION_OBJECT) {
    links.push({ href: twEditUrl.collectionObject(specimen.id), title: 'Edit collection object in TaxonWorks' })
  } else if (specimen?.type === FIELD_OCCURRENCE) {
    links.push({ href: twEditUrl.fieldOccurrence(specimen.id), title: 'Edit field occurrence in TaxonWorks' })
  } else if (AD_TYPES.includes(item.type)) {
    links.push({ href: twEditUrl.assertedDistribution(item.id), title: 'Edit asserted distribution in TaxonWorks' })

    const baId = baDetailsMap.value.get(item.id)?.baId
    if (baId) {
      links.push({ href: twEditUrl.biologicalAssociation(baId), title: 'Edit biological association in TaxonWorks' })
    }
  }

  return links
}

function specimenFor(item) {
  if (CLICKABLE_TYPES.includes(item.type)) return item
  if (item.type !== TYPE_MATERIAL) return null
  const id = specimenByTypeMaterialId.value.get(item.id)
  return id == null ? null : { id, type: COLLECTION_OBJECT }
}

// A "Reassessment" DataAttribute on an AssertedDistribution: a later source
// reassessed the record (e.g. a reported presence turned out to be a
// misidentification and was asserted absent elsewhere). Only surfaced when it
// carries its own citation - "Reassessed by [citation]" with no citation to
// point to isn't useful in the popup.
async function fetchReassessments(adIds) {
  try {
    const params = new URLSearchParams()
    params.append('attribute_subject_type', 'AssertedDistribution')
    adIds.forEach((id) => params.append('attribute_subject_id[]', id))

    const { data: attrs } = await makeAPIRequest.get(`/data_attributes?${params.toString()}`)
    const matches = (attrs || []).filter(
      (a) => (a.predicate_name || '').toLowerCase() === 'reassessment'
    )

    if (matches.length) {
      const citParams = new URLSearchParams()
      citParams.append('citation_object_type', 'DataAttribute')
      matches.forEach((a) => citParams.append('citation_object_id[]', a.id))
      const { data: citations } = await makeAPIRequest.get(`/citations?${citParams.toString()}`)

      const sourceIds = [...new Set((citations || []).map((c) => c.source_id))]
      const srcParams = new URLSearchParams()
      sourceIds.forEach((id) => srcParams.append('source_id[]', id))
      const { data: sources } = sourceIds.length
        ? await makeAPIRequest.get(`/sources?${srcParams.toString()}`)
        : { data: [] }
      const sourceMap = new Map(sources.map((s) => [s.id, s.cached]))

      const citationByAttrId = new Map()
      for (const cit of citations || []) {
        if (citationByAttrId.has(cit.citation_object_id)) continue
        citationByAttrId.set(cit.citation_object_id, {
          id: cit.id,
          display: shortCitation(stripHtml(cit.citation_source_body || '')),
          citation_source_body: sourceMap.get(cit.source_id) || cit.citation_source_body || ''
        })
      }

      for (const attr of matches) {
        const citation = citationByAttrId.get(attr.id)
        if (!citation) continue
        if (!reassessmentCache.has(attr.attribute_subject_id)) {
          reassessmentCache.set(attr.attribute_subject_id, [])
        }
        reassessmentCache.get(attr.attribute_subject_id).push({ value: attr.value, citation })
      }
    }

    adIds.forEach((id) => {
      if (!reassessmentCache.has(id)) reassessmentCache.set(id, [])
    })
  } catch {
    adIds.forEach((id) => {
      if (!reassessmentCache.has(id)) reassessmentCache.set(id, [])
    })
  } finally {
    reassessmentsByItemId.value = new Map(
      props.items.map((item) => [item.id, reassessmentCache.get(item.id) || []])
    )
  }
}

// A regular AD label is "{target.label} in {area} [{type}]".
// A BA-linked AD has a relationship verb phrase after the target label instead of " in ".
// This works regardless of which side of the BA the target OTU is on.
function isBaLinked(item, target) {
  if (!target?.label || !item?.label) return false
  if (!item.label.startsWith(target.label)) return true
  const afterTarget = item.label.slice(target.label.length)
  return !afterTarget.startsWith(' in ')
}

watch(
  () => props.items,
  async (items) => {
    resolveTypeSpecimens(items) // independent fetch; own cache

    // ── Citations for AD items ────────────────────────────────────────────────
    const adIds = items
      .filter((item) => AD_TYPES.includes(item.type) && !citationCache.has(item.id))
      .map((item) => item.id)

    citationsByItemId.value = new Map(
      items.map((item) => [item.id, citationCache.get(item.id) || []])
    )
    reassessmentsByItemId.value = new Map(
      items.map((item) => [item.id, reassessmentCache.get(item.id) || []])
    )

    // ── BA OTU details for BA-linked ADs ─────────────────────────────────────
    const baItems = items
      .map((item, i) => ({ item, i }))
      .filter(({ item, i }) => AD_TYPES.includes(item.type) && isBaLinked(item, props.targets?.[i]))

    if (baItems.length) {
      const uncached = baItems.filter(({ item }) => !baDetailsCache.has(item.label))

      if (uncached.length) {
        baLoading.value = true
        try {
          const targetIds = [
            ...new Set(uncached.map(({ i }) => props.targets?.[i]?.id).filter(Boolean))
          ]

          for (const targetId of targetIds) {
            if (!baByTargetId.has(targetId)) {
              try {
                const { data } = await makeAPIRequest.get('/biological_associations/basic', {
                  params: { 'otu_id[]': targetId }
                })
                baByTargetId.set(targetId, data)
              } catch {
                baByTargetId.set(targetId, [])
              }
            }
          }

          for (const { item, i } of uncached) {
            const targetId = props.targets?.[i]?.id
            const records = targetId ? (baByTargetId.get(targetId) || []) : []
            let matched = null

            for (const rec of records) {
              const subjLabel = rec.subject?.label
              if (subjLabel && item.label.startsWith(subjLabel)) {
                const isSubjTarget = rec.subject.id === targetId
                matched = {
                  baId: rec.id,
                  otherId: isSubjTarget ? rec.object.id : rec.subject.id,
                  otherLabel: isSubjTarget ? rec.object.label : subjLabel
                }
                break
              }
            }

            baDetailsCache.set(item.label, matched)
          }
        } catch {
          // uncached entries stay undefined → fall back to label text
        } finally {
          baLoading.value = false
        }
      }

      baDetailsMap.value = new Map(
        baItems.map(({ item }) => [item.id, baDetailsCache.get(item.label) || null])
      )
    }

    // ── Fetch AD citations ────────────────────────────────────────────────────
    if (!adIds.length) return

    citationsLoading.value = true
    fetchReassessments(adIds) // independent fetch; own cache/loading state
    try {
      const params = new URLSearchParams()
      params.append('citation_object_type', 'AssertedDistribution')
      adIds.forEach((id) => params.append('citation_object_id[]', id))

      const { data: citations } = await makeAPIRequest.get(`/citations?${params.toString()}`)

      if (citations.length) {
        const sourceIds = [...new Set(citations.map((c) => c.source_id))]
        const srcParams = new URLSearchParams()
        sourceIds.forEach((id) => srcParams.append('source_id[]', id))
        const { data: sources } = await makeAPIRequest.get(`/sources?${srcParams.toString()}`)
        const sourceMap = new Map(sources.map((s) => [s.id, s.cached]))

        for (const cit of citations) {
          if (!citationCache.has(cit.citation_object_id)) {
            citationCache.set(cit.citation_object_id, [])
          }
          citationCache.get(cit.citation_object_id).push({
            id: cit.id,
            display: shortCitation(stripHtml(cit.citation_source_body || '')),
            citation_source_body: sourceMap.get(cit.source_id) || cit.citation_source_body || ''
          })
        }
      }

      adIds.forEach((id) => {
        if (!citationCache.has(id)) citationCache.set(id, [])
      })
    } catch {
      adIds.forEach((id) => {
        if (!citationCache.has(id)) citationCache.set(id, [])
      })
    } finally {
      citationsLoading.value = false
      citationsByItemId.value = new Map(
        props.items.map((item) => [item.id, citationCache.get(item.id) || []])
      )
    }
  },
  { immediate: true }
)

function areaNameFor(item) {
  const m = item.label?.match(/ in (.+?) \[/)
  return m ? m[1] : item.label
}

// Strips the area suffix and returns the relationship sentence for fallback display
function parseBaRelationship(label) {
  if (!label) return ''
  const m = label.match(/^(.+?) in .+? \[/)
  return m ? m[1] : label
}

// Name / authorship split for an OTU label, by the shared italicising rules
function splitName(label) {
  const { italic, plain } = splitScientificName(label)
  return { name: italic, author: plain }
}

</script>
