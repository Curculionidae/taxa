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
import { ISO_ALIAS_SPELLINGS, DIVERGENT_SPELLING_ISOS } from '../lib/geoData.js'
import { mapPool } from '../../../panels/_shared/concurrencyPool.js'

// One flat presence probe per (terminal, country) at a time, capped here. The
// spike (design spec section 2) measured ~1 s for 34 requests at this limit.
const PROBE_CONCURRENCY = 8

// Note on homonyms: the flat-column probe matches dwc_occurrences' bare
// family/subfamily/tribe/genus string columns, which carry no authorship, so a
// same-rank homonym elsewhere in the data would have its occurrences
// misattributed. An earlier version forced such terminals onto the ID-exact
// /otus/:id/inventory/dwc.json call, but that call is unbounded (~172 s / 100 MB
// for a family) and the guard fired on benign name + synonym collisions. Within
// a single-superfamily curated dataset the ICZN forbids two valid same-rank
// homonyms, so the flat probe is kept for every flat-rank terminal and the
// guard was removed (code review, 2026-09-08). A cross-family deployment that
// genuinely needs it should scope by valid taxa only.

// Presence sweep with per item early exit.
//
// No consumer needs a taxon's COMPLETE set of selected countries: territoryStatus,
// leadGeoStatus and buildCompletenessReport's geographic pass all resolve 'in' on
// the FIRST selected country the taxon is present in, and the picker shows no per
// country counts. So once an item probes present anywhere in the selection, its
// remaining countries are never requested. With the Europe preset (47 countries)
// a widely distributed taxon costs one probe instead of 47; only a narrow endemic
// pays the full sweep.
//
// Probing runs in rounds so the pool stays saturated: each round hands every
// still-unresolved item the next slice of the country list, the slice sized
// ceil(limit / itemsLeft), which is 1 while many items remain (maximum breadth,
// minimum wasted probes) and grows to `limit` once a single stubborn item is
// left (so it is not reduced to one sequential request at a time).
//
// `run(item, countryKey)` must resolve to the presence boolean and is
// responsible for recording its own result. `onRound` fires after each settled
// round, for progressive UI fill.
async function earlyExitPool(items, countryKeys, limit, run, shouldStop, onRound) {
  let active = items.slice()
  let offset = 0
  while (active.length && offset < countryKeys.length) {
    if (shouldStop?.()) return
    const chunk = Math.max(1, Math.ceil(limit / active.length))
    const slice = countryKeys.slice(offset, offset + chunk)
    offset += slice.length
    const pairs = []
    for (const item of active) for (const ck of slice) pairs.push({ item, ck })
    const hit = new Set()
    await mapPool(
      pairs,
      limit,
      async ({ item, ck }) => {
        if (hit.has(item)) return // already present: skip the rest of its slice
        if (await run(item, ck)) hit.add(item)
      },
      shouldStop
    )
    if (shouldStop?.()) return
    if (hit.size) active = active.filter((it) => !hit.has(it))
    onRound?.()
  }
}

// The dwc_occurrences.country string(s) to probe for one territory key. For
// almost every country the cache stores the canonical ISO_NAME spelling, so that
// is all that is sent. Only the ISO codes in DIVERGENT_SPELLING_ISOS get the
// fall-through to their alias spellings ("Macedonia" for MK, "Ivory Coast" for
// CI, ...); probing every spelling for every country blew the request budget
// (GB has eight aliases, all wasted). F7. Deduped case-insensitively.
function countryProbeStrings(countryKey) {
  const iso = String(countryKey || '').toUpperCase()
  const canonical = countryName(countryKey) ?? territoryLabel(countryKey)
  if (!DIVERGENT_SPELLING_ISOS.has(iso)) {
    return canonical ? [canonical] : []
  }
  const out = []
  const seen = new Set()
  for (const s of [canonical, ...(ISO_ALIAS_SPELLINGS[iso] || [])]) {
    const k = String(s || '').trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
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
  let terminals = new Map() // otuId -> { rank, name, cached, tnId }
  // Shared presence caches. probeCache is keyed by country then probe signature;
  // probeTaxa reuses it so an in-key terminal that is also a completeness target
  // is fetched once. These hold SETTLED values only, because recomputeTerritories
  // and recomputeHasData read them synchronously.
  let probeCache = new Map() // countryKey -> Map<sig, boolean>
  let hasDataBySig = new Map() // sig -> boolean (no-country probe)
  let inventoryCountryCache = new Map() // otuId -> Set<countryKey> (fallback terminals)
  // In-flight request dedup, kept SEPARATE from the settled caches above so a
  // pending promise can never be read as a value. syncSelection and probeTaxa
  // both fire on the same geoEffective change and share every signature, so
  // without this an identical request goes out up to PROBE_CONCURRENCY times
  // (worst case: parallel /otus/:id/inventory/dwc.json for one fallback OTU).
  // Each entry is deleted as its request settles.
  let probeInflight = new Map() // `${countryKey}|${sig}` -> Promise<boolean>
  let hasDataInflight = new Map() // sig -> Promise<boolean>
  let inventoryInflight = new Map() // otuId -> Promise<Set<countryKey>>
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

  // probeParams for a resolved terminal. Uses `cached` (the full binomial for a
  // species) so probeParams can split genus + epithet; bare `name` alone would
  // reduce a species to the inventory fallback. C2. subgenus / nameless
  // terminals return { fallback: 'inventory' } from probeParams itself.
  function descriptorFor(t) {
    if (!t) return { fallback: 'inventory' }
    return probeParams({ rank: t.rank, name: t.cached || t.name })
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

  // Present? for one (probe signature, country). Cached in probeCache (settled
  // values only). Concurrent identical callers (syncSelection + probeTaxa share
  // every signature) collapse onto one request via probeInflight (I5). A caught
  // error resolves false and is NOT cached, so a later selection retries (M10).
  async function probeOne(sig, params, countryKey, shouldStop) {
    const bucket = probeCache.get(countryKey)
    if (bucket && bucket.has(sig)) return bucket.get(sig)
    if (shouldStop?.()) return false

    const flightKey = `${countryKey}|${sig}`
    let pending = probeInflight.get(flightKey)
    if (!pending) {
      pending = (async () => {
        let present = false
        // I3: the country column stores one of several spellings per country
        // ("Macedonia" not "North Macedonia", "Congo" not "Republic of the
        // Congo"). Probe each in turn, stop at the first hit.
        for (const country of countryProbeStrings(countryKey)) {
          const res = await makeAPIRequest.get('/dwc_occurrences', {
            params: { ...params, country, ...PRESENCE_PARAMS }
          })
          if (readPresence(res)) {
            present = true
            break
          }
        }
        if (!probeCache.has(countryKey)) probeCache.set(countryKey, new Map())
        probeCache.get(countryKey).set(sig, present)
        return present
      })()
        .catch(() => false) // M10: not cached, so a later run retries
        .finally(() => probeInflight.delete(flightKey))
      probeInflight.set(flightKey, pending)
    }
    return pending
  }

  // Present anywhere? for one probe signature (no country). Cached in
  // hasDataBySig; concurrent callers share one request (I5); a caught error is
  // an uncached false (M10).
  async function probeHasData(sig, params, shouldStop) {
    if (hasDataBySig.has(sig)) return hasDataBySig.get(sig)
    if (shouldStop?.()) return false

    let pending = hasDataInflight.get(sig)
    if (!pending) {
      pending = makeAPIRequest
        .get('/dwc_occurrences', { params: { ...params, ...PRESENCE_PARAMS } })
        .then((res) => {
          const present = readPresence(res)
          hasDataBySig.set(sig, present)
          return present
        })
        .catch(() => false)
        .finally(() => hasDataInflight.delete(sig))
      hasDataInflight.set(sig, pending)
    }
    return pending
  }

  // Fallback path (subgenus / nameless / homonym terminals): one
  // /otus/:id/inventory/dwc.json, collect the country of every row that has one.
  // Cached per OTU; one fetch covers has-data (non-empty) and every country
  // (membership). Cheap only because this path is restricted to small taxa.
  async function inventoryCountries(otuId, shouldStop) {
    const cached = inventoryCountryCache.get(otuId)
    if (cached) return cached
    if (shouldStop?.()) return new Set()

    let pending = inventoryInflight.get(otuId)
    if (!pending) {
      pending = makeAPIRequest
        .get(`/otus/${otuId}/inventory/dwc.json`)
        .then(({ data }) => {
          const set = new Set()
          const rows =
            data?.data || data?.rows || (Array.isArray(data) ? data : [])
          for (const r of rows) {
            const c = r?.country
            if (!c) continue
            // M8: an explicit non-present status (absent, doubtful, ...) is not
            // a presence record. A missing status is treated as present, to
            // match the flat probe's occurrenceStatus=present filter, which
            // AD-sourced rows carry but many specimen rows do not.
            const status = r?.occurrenceStatus
            if (status && String(status).toLowerCase() !== 'present') continue
            const norm = normalizeCountryString(c)
            if (norm?.key) set.add(norm.key)
          }
          inventoryCountryCache.set(otuId, set)
          return set
        })
        .catch(() => new Set()) // M10: not cached, so a later run retries
        .finally(() => inventoryInflight.delete(otuId))
      inventoryInflight.set(otuId, pending)
    }
    return pending
  }

  // --- terminal resolution ---------------------------------------------------

  // Resolve terminal OTUs to { rank, name, cached, tnId }. No distribution fetch.
  async function resolveTerminals(otuIds, sig) {
    const myGen = ++gen
    // F3: only mark this signature "done" once resolution SUCCEEDS. Setting it up
    // front meant a transient /otus or /taxon_names error left loadedFor set with
    // terminals empty, so every later ensureLoaded() early-returned and the
    // filter was silently dead until a route change.
    terminals = new Map()
    hasDataDone = false
    if (!otuIds.length) {
      loadedFor = sig
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
      const nameByTn = new Map() // bare `name` column
      const cachedByTn = new Map() // `cached` (full binomial for a species terminal)
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
          cachedByTn.set(t.id, t.cached || t.name)
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
              cachedByTn.set(t.id, t.cached || t.name)
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
          // bare `name` column; `cached` (full binomial) is what the flat probe
          // uses, so a species terminal probes genus + epithet rather than the
          // bare epithet (which probeParams rejects as fallback). C2.
          name: tnId != null ? nameByTn.get(tnId) || '' : '',
          cached: tnId != null ? cachedByTn.get(tnId) || '' : ''
        })
      }
      loadedFor = sig // F3: resolution succeeded
    } catch {
      /* the /otus or /taxon_names batch failed: `terminals` stays the empty Map
         set at the top of this function, so syncSelection no-ops and no geography
         filtering is applied. Safer than probing every terminal blind through the
         inventory fallback. M11. loadedFor stays null (F3) so the next
         ensureLoaded() retries rather than treating the empty set as final. */
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

    if (!terminals.size || !keys.size) {
      if (!stale()) loading.value = false // M9: the latest run always clears loading
      return
    }

    const descByOtu = new Map()
    for (const [otuId, t] of terminals) descByOtu.set(otuId, descriptorFor(t))
    const flat = []
    const fallback = []
    for (const [otuId, desc] of descByOtu) {
      ;(desc.fallback === 'inventory' ? fallback : flat).push({ otuId, desc })
    }

    loading.value = true
    try {
      // has-data batch, once per gen. Its result is NOT published here (F1):
      // publishing hasDataByOtu before the presence sweep fills territoriesByOtu
      // would flash every recorded terminal as "out of area" (hasData true +
      // still-empty territory set) for the seconds the sweep takes. Both land
      // together at the end.
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
      }

      // Fallback terminals: one country-independent inventory fetch each
      // (cached; also covers a retry after an earlier fetch error, M10).
      await mapPool(
        fallback,
        PROBE_CONCURRENCY,
        ({ otuId }) => inventoryCountries(otuId, stale),
        stale
      )
      if (stale()) return

      // Flat terminals: a terminal already known present in a still-selected
      // country needs no probe (every consumer resolves 'in' on the first hit).
      // Everyone else gets the early-exit sweep over the CURRENT selection,
      // reusing cached true/false and only hitting the network for genuinely
      // unknown pairs. Correct whether the selection grew or shrank (F8): a
      // shrink to a country a terminal skipped last time re-probes it here.
      const needProbe = flat.filter(({ otuId, desc }) => {
        for (const ck of keys) if (presentIn(desc, otuId, ck)) return false
        return true
      })
      if (needProbe.length) {
        await earlyExitPool(
          needProbe,
          [...keys],
          PROBE_CONCURRENCY,
          ({ otuId, desc }, ck) => probeOne(desc.sig, desc.params, ck, stale),
          stale,
          () => {
            if (!stale()) recomputeTerritories()
          }
        )
        if (stale()) return
      }
      recomputeTerritories()
      recomputeHasData() // F1: publish has-data now, alongside territories
    } finally {
      if (!stale()) loading.value = false
    }
  }

  // --- completeness pill -------------------------------------------------

  // Probe a set of expected modal-rank taxa (in-key targets and gaps) the same
  // way, sharing probeCache / hasDataBySig. Does NOT mutate territoriesByOtu /
  // hasDataByOtu (those are terminal scoped). A taxon whose rank has no flat
  // column (modal rank = subgenus, ...) uses the /inventory/dwc.json fallback
  // when the caller passes its `otuId` (F4); with no otuId it stays unknown.
  // Returns `{ ..., stale }`: true when the composable's gen bumped mid-probe,
  // so the caller must discard the partial result (F5).
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
      return { territoriesByTaxonId, hasDataByTaxonId, stale: shouldStop() }
    }

    const descByTn = new Map()
    for (const t of list) {
      descByTn.set(t.tnId, probeParams({ rank: t.rank, name: t.name }))
      territoriesByTaxonId.set(t.tnId, new Set())
    }
    const flatList = list.filter((t) => !descByTn.get(t.tnId).fallback)
    // F4: fallback taxa the caller gave an otuId for -> one inventory fetch each.
    const invList = list.filter(
      (t) => descByTn.get(t.tnId).fallback && t.otuId != null
    )

    // has-data per taxon (once, shared cache).
    await mapPool(
      [...flatList, ...invList],
      PROBE_CONCURRENCY,
      async (t) => {
        const desc = descByTn.get(t.tnId)
        if (desc.fallback) {
          const set = await inventoryCountries(t.otuId, shouldStop)
          if (set.size) hasDataByTaxonId.add(t.tnId)
          return
        }
        const present = await probeHasData(desc.sig, desc.params, shouldStop)
        if (present) hasDataByTaxonId.add(t.tnId)
      },
      shouldStop
    )
    if (shouldStop()) {
      return { territoriesByTaxonId, hasDataByTaxonId, stale: true }
    }

    // presence per (taxon, country), shared cache. Early exit per taxon (I6):
    // the pill only needs whether each expected taxon occurs in the selection at
    // all, so probing stops once a taxon is present in one selected country.
    await earlyExitPool(
      flatList,
      [...keys],
      PROBE_CONCURRENCY,
      async (t, ck) => {
        const desc = descByTn.get(t.tnId)
        const present = await probeOne(desc.sig, desc.params, ck, shouldStop)
        if (present) territoriesByTaxonId.get(t.tnId).add(ck)
        return present
      },
      shouldStop
    )
    // Fallback taxa: intersect the cached inventory country set with the selection.
    for (const t of invList) {
      const set = inventoryCountryCache.get(t.otuId)
      if (!set) continue
      for (const ck of keys) if (set.has(ck)) territoriesByTaxonId.get(t.tnId).add(ck)
    }

    return { territoriesByTaxonId, hasDataByTaxonId, stale: shouldStop() }
  }

  // --- lifecycle ----------------------------------------------------------

  function reset() {
    gen++
    syncSeq++
    terminals = new Map()
    probeCache = new Map()
    hasDataBySig = new Map()
    inventoryCountryCache = new Map()
    probeInflight = new Map()
    hasDataInflight = new Map()
    inventoryInflight = new Map()
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
