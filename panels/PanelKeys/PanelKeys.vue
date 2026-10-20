<template>
  <VCard v-if="count">
    <VCardHeader>Keys ({{ count }})</VCardHeader>
    <VCardContent>
      <template v-for="(group, key) in shownKeys" :key="key">
        <div v-if="[...group.matrices, ...group.leads].length">
          <VTable>
            <VTableHeader>
              <VTableHeaderRow>
                <VTableHeaderCell>{{ key }}</VTableHeaderCell>
              </VTableHeaderRow>
            </VTableHeader>
            <VTableBody>
              <VTableBodyRow v-for="{ id, name, is_media } in group.matrices" :key="id">
                <VTableBodyCell>
                  <RouterLink
                    :to="{
                      name: is_media ? 'image-matrices-id' : 'interactive-key',
                      params: { id }
                    }"
                    v-text="name"
                  /><span
                    v-if="via[`m:${id}`]"
                    class="text-base-soft"
                    v-html="via[`m:${id}`]"
                  />
                </VTableBodyCell>
              </VTableBodyRow>
              <VTableBodyRow v-for="{ text, id, is_virtual } in group.leads" :key="id">
                <VTableBodyCell>
                  <SimpleKeyChip v-if="is_virtual" /><RouterLink
                    :to="{ name: 'dichotomous-key', params: { id } }"
                    v-text="text"
                  /><span
                    v-if="via[`l:${id}`]"
                    class="text-base-soft"
                    v-html="via[`l:${id}`]"
                  />
                </VTableBodyCell>
              </VTableBodyRow>
            </VTableBody>
          </VTable>
        </div>
      </template>
    </VCardContent>
  </VCard>
</template>

<script setup>
import TaxonWorks from '@/modules/otus/services/TaxonWorks.js'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest.js'
import { makeAPIRequest } from '@/utils/request'
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { loadSimpleKeys, loadSimpleKeyOtus } from './simpleKeys.js'
import SimpleKeyChip from '../_shared/SimpleKeyChip.vue'
import { escHtml } from '../_shared/scientificName.js'

const props = defineProps({
  otuId: { type: Number },
  // taxon.id is the taxon-name id — used to find this taxon's coordinate OTUs.
  taxon: { type: Object, default: undefined }
})

const controller = new AbortController()
const keys = ref({ to: {}, in: {} })
// "l:<leadId>" / "m:<matrixId>" -> HTML suffix " (as <i>Synonym</i> Author, Year)"
// for keys found only through a synonym of this taxon.
const via = ref({})

// TaxonWorks lists a key scoped to this taxon under both "scoped" and "in". A key
// belongs under "to" only, so "in" leaves out whatever "to" already has.
const shownKeys = computed(() => {
  const { to, in: inKeys } = keys.value
  if (!to.leads) return keys.value
  const notIn = (list) => {
    const ids = new Set(list.map((x) => x.id))
    return (x) => !ids.has(x.id)
  }
  return {
    to,
    in: {
      matrices: inKeys.matrices.filter(notIn(to.matrices)),
      leads: inKeys.leads.filter(notIn(to.leads))
    }
  }
})

const count = computed(
  () =>
    [...Object.values(shownKeys.value.to), ...Object.values(shownKeys.value.in)].flat()
      .length
)

// Merge one /otus/:id/inventory/keys response into acc, deduped by id. Returns the
// rows that were new, so the caller can label where they came from.
function mergeInventory(acc, data) {
  const added = []
  const pushNew = (list, items, prefix) => {
    for (const it of items || []) {
      if (!list.some((x) => x.id === it.id)) {
        list.push(it)
        added.push(`${prefix}:${it.id}`)
      }
    }
  }
  pushNew(acc.to.matrices, data.observation_matrices?.scoped, 'm')
  pushNew(acc.to.leads, data.leads?.scoped, 'l')
  pushNew(acc.in.matrices, data.observation_matrices?.in, 'm')
  pushNew(acc.in.leads, data.leads?.in, 'l')
  return added
}

function getKeys(otuId) {
  return makeAPIRequest
    .get(`/otus/${otuId}/inventory/keys`, { signal: controller.signal })
    .then((r) => r.data)
    .catch(() => null)
}

// /otus/:id/inventory/keys matches a key's leaf lead by its EXACT otu_id. A key
// whose terminal points at a *coordinate* OTU of this taxon (same taxon name,
// different OTU — e.g. "Brentidae (except Nanophyinae)") is therefore invisible
// on this taxon's page. Server has no param for this (Lead.public_root_leads_for_leaf_otus
// uses otu.leads directly), so the coordinate OTUs' keys are fetched client-side.
async function fetchCoordinateOtuIds() {
  if (!props.taxon?.id) return []
  const { data } = await makeAPIRequest.get('/otus', {
    params: { 'taxon_name_id[]': [props.taxon.id], per: 50 },
    signal: controller.signal
  })
  return (Array.isArray(data) ? data : [])
    .map((o) => o.id)
    .filter((id) => id && id !== props.otuId)
}

// A key written for a name that has since been sunk (key 35046: Rhinonus, now a
// synonym of Stenancylus) hangs off the synonym's OTU, so the valid taxon's page
// never lists it. synonymify=true returns the name plus its synonyms; their OTUs'
// keys are fetched like the coordinate ones. Returns Map<synonym OTU id, name HTML>.
async function fetchSynonymOtus() {
  const synOtus = new Map()
  if (!props.taxon?.id) return synOtus
  const { data: names } = await makeAPIRequest.get('/taxon_names', {
    params: { 'taxon_name_id[]': [props.taxon.id], synonymify: true, per: 100 },
    signal: controller.signal
  })
  const synonyms = (Array.isArray(names) ? names : []).filter(
    (n) => n.id !== props.taxon.id && n.cached_is_valid === false
  )
  if (!synonyms.length) return synOtus
  const nameById = new Map(synonyms.map((n) => [n.id, n]))

  const { data: otus } = await makeAPIRequest.get('/otus', {
    params: { 'taxon_name_id[]': [...nameById.keys()], per: 200 },
    signal: controller.signal
  })
  for (const o of Array.isArray(otus) ? otus : []) {
    if (!o.id || o.id === props.otuId) continue
    synOtus.set(o.id, synonymLabelHtml(nameById.get(o.taxon_name_id)))
  }
  return synOtus
}

// "<i>Rhinonus</i> Kuschel, 1959": the name with its authorship, so two
// synonyms spelled alike can be told apart. Plain text is escaped for v-html.
function synonymLabelHtml(name) {
  if (!name) return ''
  const nameHtml = name.cached_html || escHtml(name.cached)
  const author = name.cached_author_year ? ` ${escHtml(name.cached_author_year)}` : ''
  return nameHtml ? nameHtml + author : ''
}

// The project's simple keys, each with the OTU ids it lists (both cached per
// session). A key whose root is this page's OTU goes under "to" whatever it
// lists, so its OTU list is not fetched.
async function fetchSimpleKeys() {
  const list = await loadSimpleKeys()
  const otuIds = await Promise.all(
    list.map((l) => (l.otu_id === props.otuId ? new Set() : loadSimpleKeyOtus(l.id)))
  )
  return list.map((lead, i) => ({ lead, otuIds: otuIds[i] }))
}

// otuLabels: Map<OTU id, '' | synonym name HTML> for every OTU that stands for
// this taxon (its own, coordinate and synonym OTUs). A simple key whose root is
// one of them goes under "to"; one that lists one of them among its OTUs goes
// under "in".
function mergeSimpleKeys(acc, simpleKeys, otuLabels, labels) {
  const addTo = (list, lead, otuId) => {
    if (list.some((x) => x.id === lead.id)) return
    list.push({ id: lead.id, text: lead.text, is_virtual: true })
    const html = otuLabels.get(otuId)
    if (html && !labels[`l:${lead.id}`]) labels[`l:${lead.id}`] = ` (as ${html})`
  }
  for (const { lead, otuIds } of simpleKeys) {
    if (otuLabels.has(lead.otu_id)) {
      addTo(acc.to.leads, lead, lead.otu_id)
      continue
    }
    const hit = [...otuIds].find((id) => otuLabels.has(id))
    if (hit != null) addTo(acc.in.leads, lead, hit)
  }
}

// Every source starts at once: the page OTU's keys, the coordinate OTUs', the
// synonym OTUs' and the simple keys. Each OTU's keys are requested as soon as that
// OTU is known. The panel renders once, with everything.
onMounted(async () => {
  const params = { otu_id: props.otuId }
  const mainP = useOtuPageRequest('panel keys', () =>
    TaxonWorks.getKeys(props.otuId, { signal: controller.signal, params })
  )
  const coordP = fetchCoordinateOtuIds().catch(() => [])
  const synP = fetchSynonymOtus().catch(() => new Map())
  const simpleP = fetchSimpleKeys().catch(() => [])
  const coordKeysP = coordP.then((ids) => Promise.all(ids.map(getKeys)))
  const synKeysP = synP.then((m) => Promise.all([...m.keys()].map(getKeys)))

  let data
  try {
    ;({ data } = await mainP)
  } catch {
    return
  }
  const [coordIds, coordKeys, synOtus, synKeys, simpleKeys] = await Promise.all([
    coordP,
    coordKeysP,
    synP,
    synKeysP,
    simpleP
  ])
  if (controller.signal.aborted) return

  const acc = {
    to: {
      matrices: [...data.observation_matrices.scoped],
      leads: [...data.leads.scoped]
    },
    in: {
      matrices: [...data.observation_matrices.in],
      leads: [...data.leads.in]
    }
  }
  const labels = {}
  for (const d of coordKeys) if (d) mergeInventory(acc, d)
  const synOtuIds = [...synOtus.keys()]
  synKeys.forEach((d, i) => {
    if (!d) return
    const html = synOtus.get(synOtuIds[i])
    for (const k of mergeInventory(acc, d)) {
      if (html && !labels[k]) labels[k] = ` (as ${html})`
    }
  })
  const otuLabels = new Map([props.otuId, ...coordIds].map((id) => [id, '']))
  synOtus.forEach((html, id) => {
    if (!otuLabels.has(id)) otuLabels.set(id, html)
  })
  mergeSimpleKeys(acc, simpleKeys, otuLabels, labels)

  keys.value = acc
  via.value = labels
})

onBeforeUnmount(() => {
  controller?.abort()
})
</script>
