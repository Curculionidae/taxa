// Orchestrates the concept alignment for PanelGbifTaxon. It fetches the
// TaxonWorks name set (with original combinations), the Catalogue of Life
// synonymy, the occurrence facet and the summary counts, then hands everything
// to buildAlignmentModel. Memoised per page load, the same pattern as
// resolveGbifTaxonScope. See the design spec, sections 5 to 7.
import { makeAPIRequest } from '@/utils/request'
import {
  matchGbifKey,
  matchGbifRaw,
  isSpeciesGroupMatch,
  CHECKLIST_KEY,
  GBIF_TAXON_BASE,
  GBIF_OCCURRENCE_BASE
} from './useGbifMatch'
import { resolveGbifTaxonScope } from './gbifTaxonScope'
import { fetchChecklistConcept } from './gbifChecklistConcept'
import { buildAlignmentModel } from './assembleAlignment'
import { matchKey } from './gbifNameMatch'
import { shortName } from './gbifNameFilter'

const OCC = 'https://api.gbif.org/v1/occurrence/search'
const V1_MATCH = 'https://api.gbif.org/v1/species/match'
const BACKBONE_TAXON = 'https://www.gbif.org/species'
const CHECKLIST_LABEL = 'Catalogue of Life'

const cache = new Map()

export function resolveConceptAlignment(primaryName, taxonId, opts = {}) {
  const key = `${taxonId}|${primaryName}`
  if (!cache.has(key)) cache.set(key, resolve(primaryName, taxonId, opts))
  return cache.get(key)
}

async function resolve(primaryName, taxonId, opts) {
  const forName = primaryName
  try {
    // Confident Catalogue of Life match gate. No match, the panel shows only
    // the no-match line (spec section 7).
    const raw = await matchGbifRaw(primaryName)
    if (!raw) return { matched: false }

    // Bare, case-preserving canonical for the Catalogue of Life concept lookup,
    // which misses when the string carries parenthetical authorship. primaryName
    // stays for display and the cache key only. raw.usage.canonicalName is
    // GBIF's own properly-cased canonical, shortName(primaryName) the fallback.
    const lookupName = raw?.usage?.canonicalName || shortName(primaryName)

    // 1. TaxonWorks name set, with author-year and original combinations, then
    //    the section 4.4 match key on every node. fetchChecklistConcept grades
    //    each Catalogue of Life name against these keys, so they must be set
    //    before it runs.
    const baseNodes = await fetchTwNodes(primaryName, taxonId)
    if (primaryName !== forName) return { matched: false }
    const twNodes = baseNodes.map((n) => ({
      ...n,
      matchKey: matchKey(n.canonical, { author: n.authorYear })
    }))

    // 2. GBIF match plus the scope key union (reuses the shared resolver and
    //    its promise cache).
    const scope = await resolveGbifTaxonScope(primaryName, taxonId, {
      rejectHigherRank: opts.rejectHigherRank !== false
    })
    if (!scope.keys.length) return { matched: false }

    // Rank gate (Ruling 2). resolveGbifTaxonScope with rejectHigherRank keeps a
    // genuine genus or family EXACT match, so a non-empty scope is not proof of
    // a species-group page. When this is false the panel (Task 6) suppresses
    // the comparison, but the model is still assembled and returned.
    const rankEligible = isSpeciesGroupMatch(raw)

    // 3. Catalogue of Life synonymy.
    const colConcept = await fetchChecklistConcept(lookupName, twNodes, {
      checklistKey: CHECKLIST_KEY
    })
    const colAcceptedName = colConcept ? colConcept.accepted.name : primaryName

    // 4. Occurrence facet plus summary counts across the whole scope key union.
    const [facetCounts, summaryCounts] = await Promise.all([
      fetchFacet(scope.keys),
      fetchSummary(scope.keys)
    ])
    if (primaryName !== forName) return { matched: false }

    // 5. Backbone integer key, only for the two entry-point links. If this call
    //    fails both links are null and everything else still works.
    const backboneKey = await fetchBackboneKey(primaryName)

    // 6. Mark each TaxonWorks node as known to Catalogue of Life or not.
    const colKeys = new Set(
      colConcept
        ? [
            matchKey(colConcept.accepted.name),
            ...colConcept.synonyms.map((s) => s.matchKey)
          ]
        : []
    )
    const withKeys = []
    for (const n of twNodes) {
      withKeys.push({ ...n, colMatched: await nodeIsInCol(n, colKeys) })
    }

    // Ruling 2: real match diagnostics rather than the hardcoded pair.
    const acceptedMatchType =
      raw?.diagnostics?.matchType === 'FUZZY'
        ? 'FUZZY'
        : raw?.usage?.status === 'AMBIGUOUS_SYNONYM'
          ? 'AMBIGUOUS'
          : 'EXACT'
    const acceptedIsSynonymChain =
      raw?.usage?.status === 'SYNONYM' && !!raw?.acceptedUsage

    const model = buildAlignmentModel({
      twName: primaryName,
      colAcceptedName,
      twAcceptedIsColSynonym: colConcept
        ? matchKey(colConcept.accepted.name) !== withKeys[0]?.matchKey
        : false,
      twNodes: withKeys,
      colConcept,
      facetCounts,
      summaryCounts,
      matchDiagnostics: { acceptedMatchType, acceptedIsSynonymChain },
      urls: buildUrls(colConcept, backboneKey, scope.keys)
    })

    return {
      matched: true,
      rankEligible,
      checklist: { key: CHECKLIST_KEY, label: CHECKLIST_LABEL },
      ...model
    }
  } catch (e) {
    return { matched: false, error: true }
  }
}

// The valid name node plus one node per TaxonWorks synonym. Node 0 is fetched
// by id from GET /taxon_names/{taxonId} so a subgenus in the stored name string
// cannot make a name lookup miss. The synonym rows come from the same two-step
// twSynonymNames.js uses (invalidating relationships whose object is this name);
// the full rows are kept for cached_original_combination and cached_author_year,
// both present on the list response (verified against the live API on
// 2026-08-31).
async function fetchTwNodes(primaryName, taxonId) {
  // Seed with the subgenus-stripped short name so a stored subgenus in
  // primaryName cannot leak into the bare node if the by-id refine below fails.
  const nodes = [nodeFromTw({ cached: shortName(primaryName) }, 'accepted')]

  let synIds = []
  try {
    const { data: rels } = await makeAPIRequest.get('/taxon_name_relationships', {
      params: { 'object_taxon_name_id[]': taxonId, per: 500 }
    })
    synIds = [
      ...new Set(
        (rels || [])
          .filter((r) => r.type?.includes('Invalidating'))
          .map((r) => r.subject_taxon_name_id)
          .filter((id) => id && id !== Number(taxonId))
      )
    ]
  } catch {
    synIds = []
  }

  if (synIds.length) {
    try {
      const p = new URLSearchParams()
      synIds.forEach((id) => p.append('taxon_name_id[]', id))
      p.append('per', '500')
      const { data: names } = await makeAPIRequest.get(`/taxon_names?${p}`)
      for (const n of names || []) nodes.push(nodeFromTw(n, 'twSynonym'))
    } catch {
      // No synonym rows. The accepted node still stands.
    }
  }

  // Refine the accepted node from its own TaxonWorks record. Fetched by id, not
  // by name, so a stored subgenus (Otiorhynchus (Podoropelmus) fullo) cannot
  // drop the author-year and original combination the grader needs.
  try {
    const { data } = await makeAPIRequest.get(`/taxon_names/${taxonId}`)
    if (data && data.id) nodes[0] = nodeFromTw(data, 'accepted')
  } catch {
    // Keep the bare accepted node.
  }

  return nodes
}

function nodeFromTw(row, role) {
  const name = row.cached || row.name || ''
  const authorYear = row.cached_author_year || ''
  const originalCombination =
    row.original_combination ||
    (row.cached_original_combination
      ? `${row.cached_original_combination}${
          authorYear ? ' ' + stripParens(authorYear) : ''
        }`
      : null)
  return {
    name: authorYear ? `${name} ${authorYear}` : name,
    short: name,
    canonical: name,
    authorYear,
    originalCombination,
    role
  }
}

const stripParens = (s) => String(s).replace(/[()]/g, '')

async function nodeIsInCol(node, colKeys) {
  if (colKeys.has(node.matchKey)) return true
  // Catalogue of Life may hold this TaxonWorks synonym under its own key,
  // folded into a different accepted name. That still counts as known.
  try {
    return !!(await matchGbifKey(node.canonical, { rejectHigherRank: true }))
  } catch {
    return false
  }
}

async function fetchFacet(keys) {
  try {
    const u = new URL(OCC)
    keys.forEach((k) => u.searchParams.append('taxonKey', k))
    u.searchParams.set('checklistKey', CHECKLIST_KEY)
    u.searchParams.set('limit', '0')
    u.searchParams.set('facet', 'scientificName')
    u.searchParams.set('facetLimit', '200')
    const res = await fetch(u)
    if (!res.ok) return []
    const data = await res.json()
    return (data.facets?.[0]?.counts || []).map((c) => ({
      name: c.name,
      count: c.count
    }))
  } catch {
    return []
  }
}

async function fetchSummary(keys) {
  const base = () => {
    const u = new URL(OCC)
    keys.forEach((k) => u.searchParams.append('taxonKey', k))
    u.searchParams.set('checklistKey', CHECKLIST_KEY)
    u.searchParams.set('limit', '0')
    return u
  }
  const count = async (u) => {
    try {
      const res = await fetch(u)
      return res.ok ? (await res.json()).count ?? null : null
    } catch {
      return null
    }
  }
  const plain = base()
  const img = base()
  img.searchParams.set('mediaType', 'StillImage')
  const geo = base()
  geo.searchParams.set('hasCoordinate', 'true')
  const [total, withImage, withCoordinate] = await Promise.all([
    count(plain),
    count(img),
    count(geo)
  ])
  return { total, withImage, withCoordinate }
}

async function fetchBackboneKey(name) {
  try {
    const res = await fetch(`${V1_MATCH}?name=${encodeURIComponent(name)}`)
    if (!res.ok) return null
    const d = await res.json()
    return d.acceptedUsageKey || d.usageKey || null
  } catch {
    return null
  }
}

function buildUrls(colConcept, backboneKey, scopeKeys) {
  const colTaxon = colConcept?.accepted?.alphaKey
    ? `${GBIF_TAXON_BASE}/${colConcept.accepted.alphaKey}`
    : null
  const scoped = new URLSearchParams()
  scoped.set('checklist_key', CHECKLIST_KEY)
  scopeKeys.forEach((k) => scoped.append('taxon_key', k))
  return {
    colTaxon,
    backboneTaxon: backboneKey ? `${BACKBONE_TAXON}/${backboneKey}` : null,
    backboneOccurrence: backboneKey
      ? `${GBIF_OCCURRENCE_BASE}?taxon_key=${backboneKey}`
      : null,
    scopedOccurrence: `${GBIF_OCCURRENCE_BASE}?${scoped}`
  }
}

// Lazy reverse lookup for the "Catalogue of Life places elsewhere" zone. The
// panel calls this when the zone is first expanded, once per distinct name
// string, and caches the result per string.
const placementCache = new Map()

export function fetchTwPlacement(nameString) {
  if (!placementCache.has(nameString)) {
    placementCache.set(nameString, resolvePlacement(nameString))
  }
  return placementCache.get(nameString)
}

async function resolvePlacement(nameString) {
  try {
    const canonical = nameString
      .replace(/\s*\(.*$/, '')
      .replace(/,.*$/, '')
      .trim()
    const { data } = await makeAPIRequest.get('/taxon_names', {
      params: { name: canonical, per: 20 }
    })
    const lastToken = (s) => s.toLowerCase().split(' ').slice(-1)[0]
    const target = lastToken(canonical)
    const hits = (data || []).filter(
      (r) => lastToken(r.cached || '') === target
    )
    if (!hits.length) return { known: false }
    if (hits.length > 1 && hits.filter((h) => h.cached_is_valid).length !== 1) {
      return { known: true, ambiguous: true }
    }
    const row = hits.find((h) => h.cached_is_valid) || hits[0]
    const validId = row.cached_is_valid
      ? row.id
      : row.cached_valid_taxon_name_id
    const otuId = await resolveOtuId(validId)
    if (row.cached_is_valid) {
      return {
        known: true,
        valid: true,
        validName: row.cached,
        targetAuthor: row.cached_author_year || '',
        otuId
      }
    }
    let validName = null
    let targetAuthor = ''
    if (validId) {
      try {
        const { data: v } = await makeAPIRequest.get(`/taxon_names/${validId}`)
        validName = v?.cached || null
        targetAuthor = v?.cached_author_year || ''
      } catch {
        // Leave validName null.
      }
    }
    return { known: true, valid: false, synonymOf: validName, targetAuthor, otuId }
  } catch {
    return { known: false, error: true }
  }
}

// The OTU carrying a given valid taxon-name id, if one exists. /otus returns a
// bare array (the shape PanelGallery and ImageLightbox also consume). Null on
// any miss, so the panel just renders the placement name without a link.
async function resolveOtuId(taxonNameId) {
  if (!taxonNameId) return null
  try {
    const { data } = await makeAPIRequest.get('/otus', {
      params: { 'taxon_name_id[]': taxonNameId, per: 1 }
    })
    const rows = Array.isArray(data) ? data : data?.results
    return rows?.[0]?.id ?? null
  } catch {
    return null
  }
}
