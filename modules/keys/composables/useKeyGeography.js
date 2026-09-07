// Distribution data for the key geography filter (design spec
// docs/superpowers/specs/2026-09-07-key-geography-lazy-per-country-design.md).
//
// Lazy, per country. Nothing is fetched on key load. Lifecycle:
//
//   1. ensureLoaded(): resolve the key's terminal OTUs to
//      { rank, name, tnId } (the /otus + /taxon_names calls, plus the
//      effectiveTaxonNameId synonym redirect). No distribution call.
//   2. The picker shows the full static country list (allTerritories); every
//      country is selectable. No fetch.
//   3. syncSelection(effectiveKeys): on the first non-empty selection, one
//      "has data anywhere" probe per terminal (a flat dwc_occurrences column +
//      occurrenceStatus=present + per=1, no country). Then, for every newly
//      selected country, one presence probe per terminal against that country,
//      concurrency 8. Removing a country is a pure recompute from cache.
//   4. probeTaxa(taxa, effectiveKeys): the same per country presence probe for
//      the completeness pill's expected modal-rank taxa, sharing probeCache so a
//      taxon that is also an in-key terminal is fetched once.
//
// family / subfamily / tribe / genus / species terminals use the flat
// dwc_occurrences columns (see lib/geoProbe.js). subgenus, nameless and
// homonym-ambiguous terminals fall back to one /otus/:id/inventory/dwc.json
// call, client filtered by country.
//
// Instantiated once in KeyView, provided as `keyGeo`. KeyView is reused across
// /key/:id navigations, so KeyView.load() must call reset().

import { ref, computed, watch } from 'vue'
import { makeAPIRequest } from '@/utils/request'
import {
  normalizeCountryString,
  countryName,
  territoryLabel,
  allCountries
} from '../lib/geoNormalize.js'
import { normRank } from '../lib/completeness.js'
import { effectiveTaxonNameId } from '../lib/validTaxonName.js'
import { probeParams, PRESENCE_PARAMS } from '../lib/geoProbe.js'

// One flat presence probe per (terminal, country) at a time, capped here. The
// spike (design spec section 2) measured ~1 s for 34 requests at this limit.
const PROBE_CONCURRENCY = 8

// The single-column dwc_occurrences fields a bare name string can be probed
// against. A terminal whose probe reduces to exactly one of these is exposed to
// the same-rank homonym risk findHomonymTnIds guards (a species probe pins
// genus= as well, so it is not).
const FLAT_FIELDS = new Set(['family', 'subfamily', 'tribe', 'genus'])

// The flat-column probe matches by bare name string (no taxon_name_id scoping
// is possible: dwc_occurrences' family/genus/subfamily/tribe columns are plain
// strings). A homonym at the same rank elsewhere in this project's data (a
// different lineage that happens to share the exact name) would have its
// occurrences misattributed to this terminal. One batched /taxon_names lookup
// (name_exact + epithet_only, so it matches the bare `name` column the flat
// probe itself uses) finds any such collision up front; `epithet_only` is
// required, otherwise name_exact matches against `cached` (the authored name),
// which the bare epithet here would never match. Returns the set of candidate
// tnIds that collide with a same-rank different-id taxon_name and so must not
// use the flat pass.
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
    return new Set() // lookup failure: proceed as before rather than block the pass
  }
}

// `shouldStop`, checked before each item, lets a caller abandon the remaining
// queue once its result is no longer wanted (a key change or a newer selection
// racing a large batch).
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

// Read presence off a /dwc_occurrences response: the Pagination-Total header
// first (per=1 keeps the body tiny), body length as the fallback, so
// correctness never depends on the header being present.
function readPresence(res) {
  const headerTotal = parseInt(res?.headers?.['pagination-total'] ?? '0', 10)
  const bodyTotal = Array.isArray(res?.data) ? res.data.length : 0
  return headerTotal > 0 || bodyTotal > 0
}

// The static country list, built once: allCountries() returns canonical entries
// first, then the alias spellings, so a dedupe by key keeps the canonical
// { key, label } for every ISO code and drops the alias-only rows (those existed
// solely as probe targets for the removed eager sweep; the lazy probe sends
// countryName(iso)). Sorted by label.
const STATIC_COUNTRIES = (() => {
  const seen = new Set()
  const out = []
  for (const c of allCountries()) {
    if (!c?.key || seen.has(c.key)) continue
    seen.add(c.key)
    out.push({ key: c.key, label: c.label || c.key })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
})()

export function useKeyGeography(terminalListRef) {
  // Per terminal, the SELECTED countries it probed present in. Kept as a plain
  // Map<number, Set<string>> keyed by OTU id: GuidedView / TaxonLink / FullKeyView
  // inject this and call .get(Number(id)).
  const territoriesByOtu = ref(new Map())
  // Per terminal, whether it has any present record in ANY country (the
  // one-time no-country probe). Distinguishes "unknown" from "out of area".
  const hasDataByOtu = ref(new Map())
  const loading = ref(false)

  let gen = 0 // bumped by reset() and by every terminal re-resolve
  let syncSeq = 0 // "latest selection wins" guard for rapid country toggling
  let started = false // ensureLoaded has been called at least once
  let loadedFor = null // JSON of the OTU id list the current `terminals` is for
  let resolvePromise = Promise.resolve() // in-flight ensureLoaded resolution

  // Terminal descriptors (from ensureLoaded). Keyed by Number(otuId).
  let terminals = new Map() // otuId -> { rank, name, tnId, forceInventory? }
  // Shared presence caches. probeCache is keyed by country then probe signature;
  // probeTaxa reuses it so an in-key terminal that is also a completeness target
  // is fetched once.
  let probeCache = new Map() // countryKey -> Map<sig, boolean>
  let hasDataBySig = new Map() // sig -> boolean (no-country probe)
  let inventoryCountryCache = new Map() // otuId -> Set<countryKey> (fallback terminals)
  let hasDataDone = false // the no-country batch has run for this gen
  let selectedKeys = new Set() // the countries the last syncSelection applied

  function currentOtuIds() {
    return [
      ...new Set(
        (terminalListRef.value || [])
          .map((t) => Number(t?.id))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    ]
  }

  // probeParams for a resolved terminal, honouring the homonym / fallback flag.
  function descriptorFor(t) {
    if (!t || t.forceInventory) return { fallback: 'inventory' }
    return probeParams({ rank: t.rank, name: t.name })
  }

  // Is `countryKey` fully covered by cache for the current terminal set? (a flat
  // descriptor: its sig cached for that country; a fallback terminal: its
  // inventory set cached, which is country independent.)
  function countryCovered(ck, descByOtu) {
    const bucket = probeCache.get(ck)
    for (const [otuId, desc] of descByOtu) {
      if (desc.fallback === 'inventory') {
        if (!inventoryCountryCache.has(otuId)) return false
      } else if (!bucket || !bucket.has(desc.sig)) {
        return false
      }
    }
    return true
  }

  function presentIn(desc, otuId, ck) {
    if (desc.fallback === 'inventory') {
      return inventoryCountryCache.get(otuId)?.has(ck) ?? false
    }
    return probeCache.get(ck)?.get(desc.sig) ?? false
  }

  // Rebuild territoriesByOtu from cache: for each terminal, the subset of the
  // current selection it is present in. A fresh Map each call so Vue re-renders
  // (the "bump" of the old design).
  function recomputeTerritories() {
    const out = new Map()
    for (const [otuId, t] of terminals) {
      const desc = descriptorFor(t)
      const set = new Set()
      for (const ck of selectedKeys) {
        if (presentIn(desc, otuId, ck)) set.add(ck)
      }
      out.set(otuId, set)
    }
    territoriesByOtu.value = out
  }

  // Rebuild hasDataByOtu from the no-country cache. Country independent, so this
  // only needs to run after the has-data batch.
  function recomputeHasData() {
    const out = new Map()
    for (const [otuId, t] of terminals) {
      const desc = descriptorFor(t)
      if (desc.fallback === 'inventory') {
        out.set(otuId, (inventoryCountryCache.get(otuId)?.size ?? 0) > 0)
      } else {
        out.set(otuId, hasDataBySig.get(desc.sig) ?? false)
      }
    }
    hasDataByOtu.value = out
  }

  // --- probes -------------------------------------------------------------

  // Present? for one (probe signature, country). Cached in probeCache. Any error
  // is a false ("one country short on data is tolerable").
  async function probeOne(sig, params, countryKey, shouldStop) {
    const bucket = probeCache.get(countryKey)
    if (bucket && bucket.has(sig)) return bucket.get(sig)
    if (shouldStop?.()) return false
    let present = false
    try {
      const country = countryName(countryKey) ?? territoryLabel(countryKey)
      const res = await makeAPIRequest.get('/dwc_occurrences', {
        params: { ...params, country, ...PRESENCE_PARAMS }
      })
      present = readPresence(res)
    } catch {
      present = false
    }
    if (!probeCache.has(countryKey)) probeCache.set(countryKey, new Map())
    probeCache.get(countryKey).set(sig, present)
    return present
  }

  // Present anywhere? for one probe signature (no country). Cached in hasDataBySig.
  async function probeHasData(sig, params, shouldStop) {
    if (hasDataBySig.has(sig)) return hasDataBySig.get(sig)
    if (shouldStop?.()) return false
    let present = false
    try {
      const res = await makeAPIRequest.get('/dwc_occurrences', {
        params: { ...params, ...PRESENCE_PARAMS }
      })
      present = readPresence(res)
    } catch {
      present = false
    }
    hasDataBySig.set(sig, present)
    return present
  }

  // Fallback path (subgenus / nameless / homonym terminals): one
  // /otus/:id/inventory/dwc.json, collect the country of every row that has one.
  // Cached per OTU; one fetch covers has-data (non-empty) and every country
  // (membership). Cheap only because this path is restricted to small taxa.
  async function inventoryCountries(otuId, shouldStop) {
    const cached = inventoryCountryCache.get(otuId)
    if (cached) return cached
    const set = new Set()
    if (shouldStop?.()) return set
    try {
      const { data } = await makeAPIRequest.get(
        `/otus/${otuId}/inventory/dwc.json`
      )
      const rows = data?.data || data?.rows || (Array.isArray(data) ? data : [])
      for (const r of rows) {
        const c = r?.country
        if (!c) continue
        const norm = normalizeCountryString(c)
        if (norm?.key) set.add(norm.key)
      }
    } catch {
      /* one terminal short on data is tolerable */
    }
    inventoryCountryCache.set(otuId, set)
    return set
  }

  // --- terminal resolution ---------------------------------------------------

  // Resolve terminal OTUs to { rank, name, tnId }. No distribution fetch.
  async function resolveTerminals(otuIds, sig) {
    const myGen = ++gen
    loadedFor = sig
    terminals = new Map()
    hasDataDone = false
    if (!otuIds.length) {
      loading.value = false
      return
    }
    loading.value = true
    try {
      const q = new URLSearchParams()
      otuIds.forEach((id) => q.append('otu_id[]', id))
      q.set('per', '1000')
      const { data: otus } = await makeAPIRequest.get(`/otus?${q}`)
      if (myGen !== gen) return

      const otuToTn = new Map()
      for (const o of Array.isArray(otus) ? otus : []) {
        if (o?.id && o.taxon_name_id) otuToTn.set(Number(o.id), o.taxon_name_id)
      }

      const rankByTn = new Map()
      const nameByTn = new Map()
      const tnIds = [...new Set(otuToTn.values())]
      if (tnIds.length) {
        const tq = new URLSearchParams()
        tnIds.forEach((id) => tq.append('taxon_name_id[]', id))
        tq.set('per', '1000')
        const { data: tns } = await makeAPIRequest.get(`/taxon_names?${tq}`)
        if (myGen !== gen) return
        const rows = Array.isArray(tns) ? tns : []
        for (const t of rows) {
          rankByTn.set(t.id, t.rank)
          nameByTn.set(t.id, t.name)
        }

        // A key terminal can be linked to a synonym taxon_name rather than the
        // valid one (KeyView's completeness pass resolves the same case, via the
        // same effectiveTaxonNameId rule). Every flat probe is built from the
        // VALID name string, so redirect synonym-linked terminals up front, or
        // they probe a name with no distribution data of its own and read as
        // absent everywhere.
        const validIdByTn = new Map()
        for (const t of rows) {
          const validId = effectiveTaxonNameId(t)
          if (validId && validId !== t.id) validIdByTn.set(t.id, validId)
        }
        if (validIdByTn.size) {
          const missing = [...new Set(validIdByTn.values())].filter(
            (id) => !rankByTn.has(id)
          )
          if (missing.length) {
            const vq = new URLSearchParams()
            missing.forEach((id) => vq.append('taxon_name_id[]', id))
            vq.set('per', '1000')
            const { data: validTns } = await makeAPIRequest.get(
              `/taxon_names?${vq}`
            )
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
        }
      }

      for (const otuId of otuIds) {
        const tnId = otuToTn.get(Number(otuId))
        terminals.set(Number(otuId), {
          tnId: tnId ?? null,
          rank: tnId != null ? normRank(rankByTn.get(tnId)) : null,
          name: tnId != null ? nameByTn.get(tnId) || '' : ''
        })
      }

      // Homonym guard: a bare-name flat probe (family/subfamily/tribe/genus)
      // whose name+rank collides with a different taxon_name elsewhere in the
      // project is forced onto the inventory fallback (ID exact) instead.
      const flatCandidates = []
      for (const [otuId, t] of terminals) {
        const desc = descriptorFor(t)
        if (desc.fallback) continue
        const fields = Object.keys(desc.params)
        if (fields.length === 1 && FLAT_FIELDS.has(fields[0])) {
          flatCandidates.push({
            otuId,
            tnId: t.tnId,
            rank: t.rank,
            name: desc.params[fields[0]]
          })
        }
      }
      if (flatCandidates.length) {
        const homonymTnIds = await findHomonymTnIds(flatCandidates)
        if (myGen !== gen) return
        for (const c of flatCandidates) {
          if (c.tnId != null && homonymTnIds.has(c.tnId)) {
            const t = terminals.get(c.otuId)
            if (t) t.forceInventory = true
          }
        }
      }
    } catch {
      /* leave `terminals` as best effort; an unresolved terminal probes via
         the inventory fallback (no name -> { fallback: 'inventory' }) */
    } finally {
      if (myGen === gen) loading.value = false
    }
  }

  // Fetch on first demand (picker opened, or a restored non-empty selection),
  // and re-resolve whenever the key's terminals change after that.
  function ensureLoaded() {
    started = true
    const ids = currentOtuIds()
    const sig = JSON.stringify(ids)
    if (sig === loadedFor) return
    resolvePromise = resolveTerminals(ids, sig)
  }
  watch(terminalListRef, () => {
    if (started) ensureLoaded()
  })

  // --- selection sync ------------------------------------------------------

  // Called by KeyView whenever the effective country selection changes. Runs the
  // one-time has-data batch (first non-empty selection) and a presence batch for
  // any newly selected country; a removal is a pure recompute from cache.
  async function syncSelection(effectiveKeys) {
    const mySeq = ++syncSeq
    const keys =
      effectiveKeys instanceof Set
        ? new Set(effectiveKeys)
        : new Set(effectiveKeys || [])

    ensureLoaded()
    try {
      await resolvePromise
    } catch {
      /* resolveTerminals swallows its own errors */
    }
    const myGen = gen
    const stale = () => myGen !== gen || mySeq !== syncSeq
    if (stale()) return

    selectedKeys = new Set(keys)
    recomputeTerritories() // immediate feedback (a removal needs nothing more)

    if (!terminals.size || !keys.size) return

    const descByOtu = new Map()
    for (const [otuId, t] of terminals) descByOtu.set(otuId, descriptorFor(t))

    loading.value = true
    try {
      // has-data batch, once per gen.
      if (!hasDataDone) {
        await mapPool(
          [...terminals.keys()],
          PROBE_CONCURRENCY,
          async (otuId) => {
            const desc = descByOtu.get(otuId)
            if (desc.fallback === 'inventory') {
              await inventoryCountries(otuId, stale)
            } else {
              await probeHasData(desc.sig, desc.params, stale)
            }
          },
          stale
        )
        if (stale()) return
        hasDataDone = true
        recomputeHasData()
      }

      // presence batch: only countries not already covered by cache.
      const newCountries = [...keys].filter((ck) => !countryCovered(ck, descByOtu))
      if (newCountries.length) {
        const remaining = new Map(newCountries.map((ck) => [ck, descByOtu.size]))
        const pairs = []
        for (const ck of newCountries) {
          for (const [otuId, desc] of descByOtu) pairs.push({ ck, otuId, desc })
        }
        await mapPool(
          pairs,
          PROBE_CONCURRENCY,
          async ({ ck, otuId, desc }) => {
            if (desc.fallback === 'inventory') {
              await inventoryCountries(otuId, stale)
            } else {
              await probeOne(desc.sig, desc.params, ck, stale)
            }
            const left = (remaining.get(ck) || 1) - 1
            remaining.set(ck, left)
            if (left <= 0 && !stale()) recomputeTerritories() // progressive fill
          },
          stale
        )
        if (stale()) return
      }
      recomputeTerritories()
    } finally {
      if (!stale()) loading.value = false
    }
  }

  // --- completeness pill -------------------------------------------------

  // Probe a set of expected modal-rank taxa (in-key targets and gaps) the same
  // way, sharing probeCache / hasDataBySig. Does NOT mutate territoriesByOtu /
  // hasDataByOtu (those are terminal scoped). A taxon with no flat column
  // (subgenus / no name) has no OTU id here, so it is left as unknown.
  async function probeTaxa(taxa, effectiveKeys) {
    const keys =
      effectiveKeys instanceof Set
        ? new Set(effectiveKeys)
        : new Set(effectiveKeys || [])
    const myGen = gen
    const shouldStop = () => myGen !== gen

    const territoriesByTaxonId = new Map()
    const hasDataByTaxonId = new Set()
    const list = (taxa || []).filter((t) => t && t.tnId != null)
    if (!list.length || shouldStop()) {
      return { territoriesByTaxonId, hasDataByTaxonId }
    }

    const descByTn = new Map()
    for (const t of list) {
      descByTn.set(t.tnId, probeParams({ rank: t.rank, name: t.name }))
      territoriesByTaxonId.set(t.tnId, new Set())
    }

    // has-data per taxon (once, shared cache).
    await mapPool(
      list,
      PROBE_CONCURRENCY,
      async (t) => {
        const desc = descByTn.get(t.tnId)
        if (desc.fallback) return
        const present = await probeHasData(desc.sig, desc.params, shouldStop)
        if (present) hasDataByTaxonId.add(t.tnId)
      },
      shouldStop
    )
    if (shouldStop()) return { territoriesByTaxonId, hasDataByTaxonId }

    // presence per (taxon, country), shared cache.
    const pairs = []
    for (const t of list) {
      for (const ck of keys) pairs.push({ t, ck })
    }
    await mapPool(
      pairs,
      PROBE_CONCURRENCY,
      async ({ t, ck }) => {
        const desc = descByTn.get(t.tnId)
        if (desc.fallback) return
        const present = await probeOne(desc.sig, desc.params, ck, shouldStop)
        if (present) territoriesByTaxonId.get(t.tnId).add(ck)
      },
      shouldStop
    )

    return { territoriesByTaxonId, hasDataByTaxonId }
  }

  // --- lifecycle ----------------------------------------------------------

  function reset() {
    gen++
    syncSeq++
    terminals = new Map()
    probeCache = new Map()
    hasDataBySig = new Map()
    inventoryCountryCache = new Map()
    selectedKeys = new Set()
    hasDataDone = false
    loading.value = false
    loadedFor = null
    territoriesByOtu.value = new Map()
    hasDataByOtu.value = new Map()
    // The re-resolve for the new key is driven by the terminalListRef watch once
    // the new key's nodes populate.
  }

  // Static country list, every ISO code, sorted by label. Region presets are
  // added by KeyView, not here. Exposed as a computed for API stability.
  const allTerritories = computed(() => STATIC_COUNTRIES)

  return {
    allTerritories,
    territoriesByOtu,
    hasDataByOtu,
    loading,
    reset,
    ensureLoaded,
    syncSelection,
    probeTaxa
  }
}
