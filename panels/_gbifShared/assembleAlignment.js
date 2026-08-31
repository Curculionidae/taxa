// Pure assembly of the concept alignment model from already-fetched data.
// No IO. The orchestrator (gbifConceptAlignment.js) feeds it. See spec
// sections 4 and 7.
import { deriveRelation, relationLabel } from './conceptRelation.js'
import { matchKey, keysMatch } from './gbifNameMatch.js'
import { canonicalName, shortName } from './gbifNameFilter.js'

const BOLD_OR_BLANK = /^(BOLD:|incertae|\s*$)/i

// Collapse match keys that keysMatch (same name, one-year author-date tolerance)
// to one representative, so N, G and the facet counts all compare on one key per name.
function buildCanon(keyLists) {
  const reps = []
  const map = new Map()
  for (const list of keyLists) {
    for (const k of list) {
      if (!k || map.has(k)) continue
      const rep = reps.find((r) => keysMatch(r, k))
      if (rep) map.set(k, rep)
      else {
        reps.push(k)
        map.set(k, k)
      }
    }
  }
  return (k) => map.get(k) || k
}

// One row per distinct canonical key. N raw synonyms that canonicalise together
// (the same name written in several genera) become a single survivor row; each
// extra entry's full name string is collected onto survivor.otherCombinations,
// which the panel renders as "Also written X, Y". First entry seen wins.
function dedupeByCanon(entries, canonFn) {
  const survivors = []
  const byKey = new Map()
  for (const e of entries) {
    const k = canonFn(e.matchKey)
    const seen = byKey.get(k)
    if (seen) {
      seen.otherCombinations.push(e.name)
      continue
    }
    const survivor = { ...e, otherCombinations: [] }
    byKey.set(k, survivor)
    survivors.push(survivor)
  }
  return { survivors }
}

export function buildAlignmentModel(input) {
  const {
    twName,
    colAcceptedName,
    twAcceptedIsColSynonym = false,
    twNodes,
    colConcept,
    facetCounts = [],
    summaryCounts = {},
    matchDiagnostics = {},
    urls = {}
  } = input

  // ---- record counts by match key ----
  const byMatchKey = new Map()
  const inDataOnly = []
  for (const { name, count } of facetCounts) {
    if (!name || BOLD_OR_BLANK.test(name) || !canonicalName(name).includes(' ')) {
      inDataOnly.push({ name, count })
      continue
    }
    const k = matchKey(name)
    byMatchKey.set(k, (byMatchKey.get(k) || 0) + count)
  }

  // ---- G members (exclude misapplied) ----
  const colSyn = colConcept ? colConcept.synonyms : []
  const colMisapplied = colConcept ? colConcept.misapplied : []
  const gEntries = colConcept
    ? [
        {
          name: colConcept.accepted.name,
          short: shortName(colConcept.accepted.name),
          matchKey: matchKey(colConcept.accepted.name),
          matchTier: 'homotypic',
          colRole: 'accepted'
        },
        ...colSyn.map((s) => ({
          name: s.name,
          short: shortName(s.name),
          matchKey: s.matchKey,
          matchTier: s.matchTier,
          colRole: 'colSynonym'
        }))
      ]
    : []

  // ---- N members ----
  const nEntries = twNodes.map((n) => ({
    name: n.name,
    short: n.short || shortName(n.name),
    matchKey: n.matchKey,
    role: n.role,
    colMatched: n.colMatched
  }))
  const unmatched = nEntries.filter((e) => !e.colMatched).map((e) => e.name)

  // ---- canonicalise every key (Ruling 1) ----
  const canon = buildCanon([
    nEntries.filter((e) => e.colMatched).map((e) => e.matchKey),
    gEntries.map((e) => e.matchKey),
    [...byMatchKey.keys()]
  ])

  const Gk = [...new Set(gEntries.map((e) => canon(e.matchKey)))]
  const Nk = [
    ...new Set(nEntries.filter((e) => e.colMatched).map((e) => canon(e.matchKey)))
  ]

  // re-key the record counts onto canonical keys
  const byCanon = new Map()
  for (const [mk, n] of byMatchKey) {
    const c = canon(mk)
    byCanon.set(c, (byCanon.get(c) || 0) + n)
  }

  // ---- relation ----
  const weakKeysInPlay = gEntries.some(
    (e) => e.matchTier === 'weak' && Nk.includes(canon(e.matchKey))
  )
  const relation = deriveRelation(Nk, Gk, {
    unmatchedCount: unmatched.length,
    acceptedMatchType: matchDiagnostics.acceptedMatchType || 'EXACT',
    acceptedIsSynonymChain: !!matchDiagnostics.acceptedIsSynonymChain,
    weakKeysInPlay,
    synonymyReconstructed: !colConcept
  })
  relation.plain = relationLabel(relation, { twName, colAcceptedName })
  relation.checkedNames = Nk.length
  relation.totalNames = nEntries.length
  if (relation.alternative) {
    relation.alternative.plain = relationLabel(relation.alternative, {
      twName,
      colAcceptedName
    })
  }

  // ---- zones ----
  const NkSet = new Set(Nk)
  const GkSet = new Set(Gk)
  const inG = (e) => GkSet.has(canon(e.matchKey))
  const inN = (e) => NkSet.has(canon(e.matchKey))
  const withRecords = (e) => ({
    ...e,
    records: byCanon.has(canon(e.matchKey)) ? byCanon.get(canon(e.matchKey)) : null
  })

  const consensus = dedupeByCanon(
    nEntries.filter((e) => e.colMatched && inG(e)),
    canon
  ).survivors.map((e) => {
    const g = gEntries.find((x) => canon(x.matchKey) === canon(e.matchKey))
    return withRecords({ ...e, matchTier: g ? g.matchTier : 'weak' })
  })

  const twKeepsIn = dedupeByCanon(
    nEntries.filter((e) => e.colMatched && !inG(e)),
    canon
  ).survivors.map((e) => withRecords({ ...e, colRole: 'colSeparateAccepted' }))

  const colFoldsIn = dedupeByCanon(
    gEntries.filter((e) => e.colRole === 'colSynonym' && !inN(e)),
    canon
  ).survivors.map((e) => withRecords({ ...e, twPlacement: null }))

  const misapplied = dedupeByCanon(
    colMisapplied.map((m) => ({
      name: m.name,
      short: shortName(m.name),
      matchKey: m.matchKey
    })),
    canon
  ).survivors

  const notComparable = unmatched

  return {
    twName,
    colAcceptedName,
    twAcceptedIsColSynonym,
    tw: {
      accepted: twName,
      synonyms: twNodes.filter((n) => n.role === 'twSynonym').map((n) => n.name)
    },
    gbif: colConcept
      ? { accepted: colConcept.accepted, ourNameIsColSynonym: twAcceptedIsColSynonym }
      : null,
    relation,
    zones: { consensus, twKeepsIn, colFoldsIn, misapplied, inDataOnly, notComparable },
    counts: {
      total: summaryCounts.total ?? null,
      withImage: summaryCounts.withImage ?? null,
      withCoordinate: summaryCounts.withCoordinate ?? null,
      byMatchKey
    },
    urls
  }
}
