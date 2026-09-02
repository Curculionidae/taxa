// Distribution data for the key geography filter (design spec section 6).
//
// Given the key's terminal OTU ids, it fetches:
//   1. one batched GET /asserted_distributions?otu_id[]=... (curated statements)
//   2. GET /otus/:id/inventory/dwc.json per terminal, bounded concurrency
//      (specimen-derived country strings)
// and normalises every shape / country string with lib/geoNormalize.js.
//
// Instantiated once in KeyView, provided as `keyGeo`. KeyView is reused across
// /key/:id navigations, so KeyView.load() must call reset().

import { ref, computed, watch } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import { normalizeShape, normalizeCountryString } from '../lib/geoNormalize.js'

const DWC_CONCURRENCY = 6

async function mapPool(items, limit, fn) {
  const out = []
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export function useKeyGeography(terminalListRef) {
  // otuId -> Set<territoryKey>
  const territoriesByOtu = ref(new Map())
  // territoryKey -> label (accumulated as territories are seen)
  const labelByKey = ref(new Map())
  const loading = ref(false)
  let gen = 0

  function reset() {
    gen++
    territoriesByOtu.value = new Map()
    labelByKey.value = new Map()
    loading.value = false
  }

  function add(otuId, territory) {
    if (!territory) return
    const map = territoriesByOtu.value
    if (!map.has(otuId)) map.set(otuId, new Set())
    map.get(otuId).add(territory.key)
    if (!labelByKey.value.has(territory.key)) {
      labelByKey.value.set(territory.key, territory.label || territory.key)
    }
  }

  async function load(otuIds) {
    const myGen = ++gen
    territoriesByOtu.value = new Map()
    labelByKey.value = new Map()
    if (!otuIds.length) {
      loading.value = false
      return
    }
    loading.value = true

    // 1. asserted distributions, one call
    try {
      const q = new URLSearchParams()
      otuIds.forEach((id) => q.append('otu_id[]', id))
      q.set('per', '1000')
      const { data } = await makeAPIRequest.get(`/asserted_distributions?${q}`)
      if (myGen !== gen) return
      for (const row of Array.isArray(data) ? data : []) {
        if (row?.is_absent) continue
        add(row.otu_id, normalizeShape(row.asserted_distribution_shape))
      }
      // trigger reactivity for the Map mutations above
      territoriesByOtu.value = new Map(territoriesByOtu.value)
      labelByKey.value = new Map(labelByKey.value)
    } catch {
      /* no AD layer; the specimen pass may still populate the picker */
    }

    // 2. specimen countries, per terminal, bounded concurrency
    await mapPool(otuIds, DWC_CONCURRENCY, async (otuId) => {
      try {
        const { data } = await makeAPIRequest.get(
          `/otus/${otuId}/inventory/dwc.json`
        )
        if (myGen !== gen) return
        const rows = data?.data || data?.rows || (Array.isArray(data) ? data : [])
        const seen = new Set()
        for (const r of rows) {
          const c = r?.country
          if (!c || seen.has(c)) continue
          seen.add(c)
          add(otuId, normalizeCountryString(c))
        }
        territoriesByOtu.value = new Map(territoriesByOtu.value)
        labelByKey.value = new Map(labelByKey.value)
      } catch {
        /* one terminal short on data is tolerable */
      }
    })

    if (myGen === gen) loading.value = false
  }

  // Picker options: every territory at least one terminal is recorded from.
  const allTerritories = computed(() => {
    const count = new Map()
    for (const set of territoriesByOtu.value.values()) {
      for (const k of set) count.set(k, (count.get(k) || 0) + 1)
    }
    return [...count.entries()]
      .map(([key, otuCount]) => ({
        key,
        label: labelByKey.value.get(key) || key,
        otuCount
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  })

  const unknownOtuIds = computed(() => {
    const s = new Set()
    for (const t of terminalListRef.value || []) {
      const set = territoriesByOtu.value.get(t.id)
      if (!set || set.size === 0) s.add(t.id)
    }
    return s
  })

  watch(
    terminalListRef,
    (list) => load([...new Set((list || []).map((t) => t.id).filter(Boolean))]),
    { immediate: true }
  )

  return { territoriesByOtu, allTerritories, unknownOtuIds, loading, reset }
}
