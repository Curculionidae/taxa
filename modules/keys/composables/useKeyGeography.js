// Distribution data for the key geography filter (design spec section 6).
//
// Given the key's terminal OTU ids it resolves, on first demand (ensureLoaded):
//   0. terminal OTU -> taxon-name id + rank
//   1. asserted distributions stated directly on the terminal OTUs (paged)
//   2. for terminals above species rank, descendant asserted distributions —
//      page 1 first (to read the total), then pages 2..N in parallel
//   3. GET /otus/:id/inventory/dwc.json for specimen countries, but ONLY for
//      terminals where that call is cheap (species, small informal OTUs, and
//      genus/subgenus terminals that aren't huge) — see lib/geoScope.js. A
//      family/tribe or giant-genus terminal is covered by step 2 alone; its
//      inventory call would be ~100 MB / minutes for a few specimen-only
//      countries.
// normalising every shape / country string with lib/geoNormalize.js.
//
// Nothing is fetched until ensureLoaded() is called (the picker opening, or a
// restored non-empty selection), so a key page the reader never filters pays
// nothing. Instantiated once in KeyView, provided as `keyGeo`. KeyView is reused
// across /key/:id navigations, so KeyView.load() must call reset().

import { ref, computed, watch } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import { normalizeShape, normalizeCountryString } from '../lib/geoNormalize.js'
import { needsDescendantAd, needsSpecimenPass } from '../lib/geoScope.js'

const DWC_CONCURRENCY = 6
const AD_PER = 1000
// Safety ceiling only — a real key terminal is far under this. Curculionidae,
// the worst case seen, is 49 pages.
const AD_MAX_PAGES = 200
// Pages 2..N of one AD query, fetched concurrently. Nested inside step 2's
// per-terminal pool, but in practice only one terminal per key is large, so the
// effective width for that terminal is ~this. AD pages are light indexed reads.
const AD_PAGE_CONCURRENCY = 6
const SPECIMEN_TYPES = new Set(['CollectionObject', 'FieldOccurrence'])

// An asserted_distributions row links to its OTU via
// asserted_distribution_object_{type,id}; the top-level `otu_id` is null.
function adOtuId(row) {
  return row?.asserted_distribution_object_type === 'Otu'
    ? row.asserted_distribution_object_id
    : null
}

// GET /asserted_distributions for baseParams — every page. Page 1 is fetched to
// learn the count (Pagination-Total / -Total-Pages headers); pages 2..N then run
// in a pool. Paging this endpoint is cheap (a normal indexed query), unlike
// /inventory/dwc.json. Returns { rows, total }.
async function fetchAllAD(baseParams) {
  const pageUrl = (page) => {
    const q = new URLSearchParams(baseParams)
    q.set('per', String(AD_PER))
    q.set('page', String(page))
    return `/asserted_distributions?${q}`
  }

  const first = await makeAPIRequest.get(pageUrl(1))
  const rows = Array.isArray(first.data) ? [...first.data] : []
  const total =
    parseInt(first.headers?.['pagination-total'] || '', 10) || rows.length
  const totalPages = Math.min(
    parseInt(first.headers?.['pagination-total-pages'] || '1', 10) || 1,
    AD_MAX_PAGES
  )

  if (totalPages > 1) {
    const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
    await mapPool(pages, AD_PAGE_CONCURRENCY, async (page) => {
      try {
        const { data } = await makeAPIRequest.get(pageUrl(page))
        if (Array.isArray(data)) rows.push(...data)
      } catch {
        /* a dropped page just loses some territories */
      }
    })
  }
  return { rows, total }
}

async function mapPool(items, limit, fn) {
  let i = 0
  const worker = async () => {
    while (i < items.length) await fn(items[i++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export function useKeyGeography(terminalListRef) {
  const territoriesByOtu = ref(new Map()) // otuId -> Set<territoryKey>
  const labelByKey = ref(new Map()) // territoryKey -> label
  const otuToTnRef = ref(new Map()) // terminal otuId -> taxon-name id
  const loading = ref(false)
  let gen = 0
  let started = false // ensureLoaded has been called at least once
  let loadedFor = null // JSON of the otu id list the current data is for

  function reset() {
    gen++
    territoriesByOtu.value = new Map()
    labelByKey.value = new Map()
    otuToTnRef.value = new Map()
    loading.value = false
    loadedFor = null
    // The re-fetch for the new key is driven by the terminalListRef watch once
    // the new key's nodes populate (calling reset here would race stale nodes).
  }

  function currentOtuIds() {
    return [
      ...new Set((terminalListRef.value || []).map((t) => t.id).filter(Boolean))
    ]
  }

  // Fetch on first demand (picker opened, or a restored non-empty selection),
  // and re-fetch whenever the key's terminals change after that.
  function ensureLoaded() {
    started = true
    const ids = currentOtuIds()
    const sig = JSON.stringify(ids)
    if (sig === loadedFor) return
    load(ids, sig)
  }
  watch(terminalListRef, () => {
    if (started) ensureLoaded()
  })

  function add(otuId, territory) {
    // otuId is null for a BiologicalAssociation-linked asserted distribution
    // (asserted_distribution_object_type !== 'Otu'); those describe an
    // interaction, not a terminal's range, so they must not count.
    if (otuId == null || !territory) return
    const map = territoriesByOtu.value
    if (!map.has(otuId)) map.set(otuId, new Set())
    map.get(otuId).add(territory.key)
    if (!labelByKey.value.has(territory.key)) {
      labelByKey.value.set(territory.key, territory.label || territory.key)
    }
  }
  // One reactive replacement per pass, not per pooled task.
  function bump() {
    territoriesByOtu.value = new Map(territoriesByOtu.value)
    labelByKey.value = new Map(labelByKey.value)
  }

  async function load(otuIds, sig) {
    const myGen = ++gen
    territoriesByOtu.value = new Map()
    labelByKey.value = new Map()
    loadedFor = sig
    if (!otuIds.length) {
      loading.value = false
      return
    }
    loading.value = true

    // 0. terminal OTU -> taxon-name id + rank
    const otuToTn = new Map()
    otuToTnRef.value = new Map()
    const rankByTn = new Map()
    const higherRankOtus = []
    // step 2 fills this: terminal otuId -> its descendant-AD Pagination-Total,
    // the "how big is this taxon" signal step 3 gates on.
    const adTotalByOtu = new Map()
    try {
      const q = new URLSearchParams()
      otuIds.forEach((id) => q.append('otu_id[]', id))
      q.set('per', '1000')
      const { data } = await makeAPIRequest.get(`/otus?${q}`)
      if (myGen !== gen) return
      for (const o of Array.isArray(data) ? data : []) {
        if (o?.id && o.taxon_name_id) otuToTn.set(o.id, o.taxon_name_id)
      }
      otuToTnRef.value = new Map(otuToTn)
      const tnIds = [...new Set(otuToTn.values())]
      if (tnIds.length) {
        const tq = new URLSearchParams()
        tnIds.forEach((id) => tq.append('taxon_name_id[]', id))
        tq.set('per', '1000')
        const { data: tns } = await makeAPIRequest.get(`/taxon_names?${tq}`)
        if (myGen !== gen) return
        for (const t of Array.isArray(tns) ? tns : []) rankByTn.set(t.id, t.rank)
        for (const [otuId, tnId] of otuToTn) {
          if (needsDescendantAd(rankByTn.get(tnId))) higherRankOtus.push(otuId)
        }
      }
    } catch {
      /* fall back to the otu_id[] AD call only */
    }

    // 1. asserted distributions stated directly on the terminal OTUs.
    try {
      const base = new URLSearchParams()
      otuIds.forEach((id) => base.append('otu_id[]', id))
      const { rows } = await fetchAllAD(base)
      if (myGen !== gen) return
      for (const row of rows) {
        if (row?.is_absent) continue
        add(adOtuId(row), normalizeShape(row.asserted_distribution_shape))
      }
      bump()
    } catch {
      /* the descendant / specimen passes may still populate it */
    }

    // 2. descendant distributions for the higher-rank terminals.
    await mapPool(higherRankOtus, DWC_CONCURRENCY, async (otuId) => {
      const tnId = otuToTn.get(otuId)
      if (!tnId) return
      try {
        const base = new URLSearchParams()
        base.append('taxon_name_id[]', tnId)
        base.set('descendants', 'true')
        const { rows, total } = await fetchAllAD(base)
        if (myGen !== gen) return
        adTotalByOtu.set(otuId, total)
        for (const row of rows) {
          if (row?.is_absent) continue
          if (row.asserted_distribution_object_type !== 'Otu') continue
          add(otuId, normalizeShape(row.asserted_distribution_shape))
        }
      } catch {
        /* tolerate */
      }
    })
    if (myGen !== gen) return
    bump()

    // 3. specimen countries. dwc.json also returns AssertedDistribution rows
    //    (individualCount null) — allow-list the two specimen types so this pass
    //    is specimen-only. Skip terminals where the call is expensive
    //    (family/tribe, or a giant genus): step 2 already covers them, and the
    //    inventory endpoint rebuilds the whole DWC set server-side per request
    //    so there is no cheap way to probe size first.
    const specimenOtus = otuIds.filter((otuId) => {
      const tnId = otuToTn.get(otuId)
      return needsSpecimenPass({
        rank: tnId == null ? undefined : rankByTn.get(tnId),
        hasName: tnId != null,
        adTotal: adTotalByOtu.get(otuId) || 0
      })
    })
    await mapPool(specimenOtus, DWC_CONCURRENCY, async (otuId) => {
      try {
        const { data } = await makeAPIRequest.get(
          `/otus/${otuId}/inventory/dwc.json`
        )
        if (myGen !== gen) return
        const rows = data?.data || data?.rows || (Array.isArray(data) ? data : [])
        const seen = new Set()
        for (const r of rows) {
          if (!SPECIMEN_TYPES.has(r?.dwc_occurrence_object_type)) continue
          const c = r?.country
          if (!c || seen.has(c)) continue
          seen.add(c)
          add(otuId, normalizeCountryString(c))
        }
      } catch {
        /* one terminal short on data is tolerable */
      }
    })
    if (myGen !== gen) return
    bump()

    loading.value = false
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

  // Same data as territoriesByOtu, keyed by the terminal's taxon-name id, so the
  // completeness pass can reuse it for the taxa that are in the key (no second
  // fetch).
  const territoriesByTn = computed(() => {
    const out = new Map()
    const o2t = otuToTnRef.value
    for (const [otuId, set] of territoriesByOtu.value) {
      const tn = o2t.get(otuId)
      if (tn == null) continue
      if (!out.has(tn)) out.set(tn, new Set())
      for (const k of set) out.get(tn).add(k)
    }
    return out
  })

  return {
    territoriesByOtu,
    territoriesByTn,
    allTerritories,
    unknownOtuIds,
    loading,
    reset,
    ensureLoaded
  }
}
