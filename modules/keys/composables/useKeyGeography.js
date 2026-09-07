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
import {
  normalizeShape,
  normalizeCountryString,
  allCountries
} from '../lib/geoNormalize.js'
import { needsDescendantAd, needsSpecimenPass, fieldForRank } from '../lib/geoScope.js'
import { normRank } from '../lib/completeness.js'

const DWC_CONCURRENCY = 6
const AD_PER = 1000
// Safety ceiling only — a real key terminal is far under this. Curculionidae,
// the worst case seen, is 49 pages.
const AD_MAX_PAGES = 200
// Pages of one AD query fetched together. Bounded against step 2's per-terminal
// pool (AD_TERMINAL_CONCURRENCY) so peak parallel AD requests ≈ the product.
const AD_PAGE_CONCURRENCY = 5
// Higher-rank terminals processed at once in step 2. Low, because fetchAllAD
// already parallelises each terminal's own pages.
const AD_TERMINAL_CONCURRENCY = 3
const SPECIMEN_TYPES = new Set(['CollectionObject', 'FieldOccurrence'])

// Flat-column pass (see docs/feasibility_key_geography_filter.md, "2026-09-05
// update"): for a terminal whose rank has a well-populated dwc_occurrences
// column (family, subfamily, tribe, genus), one presence probe per candidate
// country replaces both the descendant-AD pass (step 2) and the specimen pass
// (step 3) for that terminal, measured ~2x faster on the worst case in the
// system (key 5024, Curculionidae), and it sees specimen-only occurrences too
// in the same request, unlike the AD-only path those ranks otherwise get.
const FLAT_COUNTRY_CONCURRENCY = 8
const FLAT_TERMINAL_CONCURRENCY = 2

// An asserted_distributions row links to its OTU via
// asserted_distribution_object_{type,id}; the top-level `otu_id` is null.
function adOtuId(row) {
  return row?.asserted_distribution_object_type === 'Otu'
    ? row.asserted_distribution_object_id
    : null
}

// GET /asserted_distributions for baseParams — every page, a batch at a time so
// pages come back in parallel. Stops at the first short page (or a page error),
// so correctness does not depend on the Pagination headers. Paging this endpoint
// is cheap (a normal indexed query), unlike /inventory/dwc.json.
// Returns { rows, total } where total is the real fetched row count.
async function fetchAllAD(baseParams) {
  const pageUrl = (page) => {
    const q = new URLSearchParams(baseParams)
    q.set('per', String(AD_PER))
    q.set('page', String(page))
    return `/asserted_distributions?${q}`
  }

  const first = await makeAPIRequest.get(pageUrl(1))
  const rows = Array.isArray(first.data) ? [...first.data] : []
  let done = rows.length < AD_PER
  let next = 2
  while (!done && next <= AD_MAX_PAGES) {
    const batch = []
    for (
      let p = next;
      p < next + AD_PAGE_CONCURRENCY && p <= AD_MAX_PAGES;
      p++
    ) {
      batch.push(p)
    }
    const parts = await Promise.all(
      batch.map((p) =>
        makeAPIRequest
          .get(pageUrl(p))
          .then((r) => (Array.isArray(r.data) ? r.data : []))
          .catch(() => null)
      )
    )
    for (const part of parts) {
      if (part === null) {
        done = true // a page error — stop (keep what we have)
        continue
      }
      rows.push(...part)
      if (part.length < AD_PER) done = true
    }
    next += batch.length
  }
  return { rows, total: rows.length }
}

// One terminal, every candidate country, one presence probe each. Reads
// presence primarily off the `pagination-total` response header (`per: 1`),
// falling back to the body's own row count if that header is ever missing —
// same reasoning as fetchAllAD above: correctness should not depend on the
// Pagination headers being present.
// `shouldStop`, when it starts returning true (the key changed mid-load), is
// checked before each new probe, so a stale terminal stops dispatching further
// requests rather than running its full country list to completion.
async function fetchFlatColumnCountries(field, name, candidates, shouldStop) {
  const hits = []
  await mapPool(
    candidates,
    FLAT_COUNTRY_CONCURRENCY,
    async ({ key, label }) => {
      try {
        const res = await makeAPIRequest.get('/dwc_occurrences', {
          params: {
            [field]: name,
            country: label,
            occurrenceStatus: 'present',
            per: 1
          }
        })
        const headerTotal = parseInt(res.headers?.['pagination-total'] ?? '0', 10)
        const bodyTotal = Array.isArray(res.data) ? res.data.length : 0
        if (headerTotal > 0 || bodyTotal > 0) hits.push({ key, label })
      } catch {
        /* one country short on data is tolerable */
      }
    },
    shouldStop
  )
  return hits
}

// The flat-column pass matches by bare name string (no taxon_name_id
// scoping — dwc_occurrences' family/genus/subfamily/tribe columns are plain
// strings, there is nothing else to scope by). A homonym at the same rank
// elsewhere in this project's data — a different lineage that happens to
// share the exact name — would have its occurrences misattributed to this
// terminal. One batched /taxon_names lookup (name_exact + epithet_only, so it
// matches the bare `name` column the flat probe itself uses) finds any such
// collision up front; `epithet_only` is required, otherwise name_exact
// matches against `cached` (the authored name), which the bare epithet here
// would never match. Returns the set of candidate tnIds that collide with a
// same-rank different-id taxon_name and so must not use the flat pass.
async function findHomonymTnIds(candidates) {
  const names = [...new Set(candidates.map((c) => c.name).filter(Boolean))]
  if (!names.length) return new Set()
  const q = new URLSearchParams()
  names.forEach((n) => q.append('name[]', n))
  q.set('name_exact', 'true')
  q.set('epithet_only', 'true')
  q.set('per', '1000')
  try {
    const { data } = await makeAPIRequest.get(`/taxon_names?${q}`)
    const idsByKey = new Map() // `${rank}|${name}` -> Set<taxon_name id>
    for (const t of Array.isArray(data) ? data : []) {
      const key = `${normRank(t.rank)}|${t.name}`
      if (!idsByKey.has(key)) idsByKey.set(key, new Set())
      idsByKey.get(key).add(t.id)
    }
    const homonymTnIds = new Set()
    for (const c of candidates) {
      const ids = idsByKey.get(`${c.rank}|${c.name}`)
      if (ids && ids.size > 1) homonymTnIds.add(c.tnId)
    }
    return homonymTnIds
  } catch {
    return new Set() // lookup failure — proceed as before rather than block the pass
  }
}

// `shouldStop`, checked before each item, lets a caller abandon the remaining
// queue once its result is no longer wanted (see fetchFlatColumnCountries and
// its caller in load(), both racing a key change against a large batch).
async function mapPool(items, limit, fn, shouldStop) {
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      if (shouldStop?.()) return
      await fn(items[i++])
    }
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
    const nameByTn = new Map()
    const higherRankOtus = []
    // Higher-rank terminals whose rank has a flat dwc_occurrences column --
    // handled by the flat-column pass instead of higherRankOtus's AD walk.
    const flatFieldOtus = []
    // step 2 fills this: terminal otuId -> its descendant-AD row count, the
    // "how big is this taxon" signal step 3 gates on.
    const adTotalByOtu = new Map()
    // Only true once ranks are actually known. If it stays false the rank-based
    // gate in step 3 has nothing to work with, so step 3 is skipped rather than
    // risk a family-sized /inventory/dwc.json call for every terminal.
    let ranksResolved = false
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
      if (!tnIds.length) {
        ranksResolved = true // nothing to resolve — every terminal is name-less
      } else {
        const tq = new URLSearchParams()
        tnIds.forEach((id) => tq.append('taxon_name_id[]', id))
        tq.set('per', '1000')
        const { data: tns } = await makeAPIRequest.get(`/taxon_names?${tq}`)
        if (myGen !== gen) return
        for (const t of Array.isArray(tns) ? tns : []) {
          rankByTn.set(t.id, t.rank)
          nameByTn.set(t.id, t.name)
        }

        // A key terminal can be linked to a synonym taxon_name rather than
        // the valid one (KeyView.vue's completeness pass resolves the same
        // case via cached_valid_taxon_name_id — proof this is a real,
        // recurring situation in this project's keys). Both the flat-column
        // probe and the descendant-AD walk below are built from the VALID
        // name's own name string / lineage, so redirect every synonym-linked
        // terminal to its valid taxon_name id up front. Otherwise it
        // silently probes/walks a name with no distribution data of its own
        // and reports as absent everywhere.
        const validIdByTn = new Map()
        for (const t of Array.isArray(tns) ? tns : []) {
          if (t?.cached_is_valid === false && t.cached_valid_taxon_name_id) {
            validIdByTn.set(t.id, t.cached_valid_taxon_name_id)
          }
        }
        if (validIdByTn.size) {
          const missing = [...new Set(validIdByTn.values())].filter(
            (id) => !rankByTn.has(id)
          )
          if (missing.length) {
            const vq = new URLSearchParams()
            missing.forEach((id) => vq.append('taxon_name_id[]', id))
            vq.set('per', '1000')
            const { data: validTns } = await makeAPIRequest.get(`/taxon_names?${vq}`)
            if (myGen !== gen) return
            for (const t of Array.isArray(validTns) ? validTns : []) {
              rankByTn.set(t.id, t.rank)
              nameByTn.set(t.id, t.name)
            }
          }
          for (const [otuId, tnId] of otuToTn) {
            const validId = validIdByTn.get(tnId)
            if (validId) otuToTn.set(otuId, validId)
          }
          otuToTnRef.value = new Map(otuToTn)
        }

        ranksResolved = true
        for (const [otuId, tnId] of otuToTn) {
          if (!needsDescendantAd(rankByTn.get(tnId))) continue
          const field = fieldForRank(rankByTn.get(tnId))
          const name = nameByTn.get(tnId)
          if (field && name) {
            flatFieldOtus.push({ otuId, tnId, field, name, rank: normRank(rankByTn.get(tnId)) })
          } else {
            higherRankOtus.push(otuId)
          }
        }

        // Homonym guard (see findHomonymTnIds): a candidate whose name+rank
        // collides with a different taxon_name elsewhere in the project falls
        // back to the ID-scoped descendant-AD walk instead of the flat probe.
        if (flatFieldOtus.length) {
          const homonymTnIds = await findHomonymTnIds(flatFieldOtus)
          if (myGen !== gen) return
          if (homonymTnIds.size) {
            const kept = []
            for (const c of flatFieldOtus) {
              if (homonymTnIds.has(c.tnId)) higherRankOtus.push(c.otuId)
              else kept.push(c)
            }
            flatFieldOtus.length = 0
            flatFieldOtus.push(...kept)
          }
        }
      }
    } catch {
      /* fall back to the otu_id[] AD call only; step 3 is skipped */
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
    await mapPool(higherRankOtus, AD_TERMINAL_CONCURRENCY, async (otuId) => {
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

    // 2b. flat-column pass: family / subfamily / tribe / genus terminals. One
    // request per candidate country (per=1, occurrenceStatus=present), reading
    // presence off pagination-total. Replaces both the descendant-AD walk
    // above and the specimen pass below for these terminals: it already
    // returns a mix of AssertedDistribution- and specimen-sourced rows (the
    // cache is a union of both), so nothing further is needed for them.
    const candidateCountries = allCountries()
    const isStale = () => myGen !== gen
    await mapPool(
      flatFieldOtus,
      FLAT_TERMINAL_CONCURRENCY,
      async ({ otuId, field, name }) => {
        const hits = await fetchFlatColumnCountries(field, name, candidateCountries, isStale)
        if (isStale()) return
        for (const territory of hits) add(otuId, territory)
      },
      isStale
    )
    if (myGen !== gen) return
    bump()
    const flatFieldOtuIds = new Set(flatFieldOtus.map((f) => f.otuId))

    // 3. specimen countries. dwc.json also returns AssertedDistribution rows
    //    (individualCount null) — allow-list the two specimen types so this pass
    //    is specimen-only. Skip terminals where the call is expensive
    //    (family/tribe, or a giant genus): step 2 already covers them, and the
    //    inventory endpoint rebuilds the whole DWC set server-side per request
    //    so there is no cheap way to probe size first. Skip the whole pass when
    //    ranks never resolved — without them we cannot tell a family terminal
    //    (a ~100 MB call) from a species one.
    const specimenOtus = ranksResolved
      ? otuIds.filter((otuId) => {
          if (flatFieldOtuIds.has(otuId)) return false // already covered above
          const tnId = otuToTn.get(otuId)
          return needsSpecimenPass({
            rank: tnId == null ? undefined : rankByTn.get(tnId),
            hasName: tnId != null,
            adTotal: adTotalByOtu.get(otuId) || 0
          })
        })
      : []
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
