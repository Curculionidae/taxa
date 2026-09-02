// Catalogue of Life synonymy for a taxon, via GBIF's CoL mirror. GBIF's
// occurrence search and v2 match use an alphanumeric usage key; the v1
// synonyms route needs the integer key, which /v1/species?datasetKey=&name=
// carries alongside. See the design spec, section 5.2. No ChecklistBank.
import { matchKey, matchTier } from './gbifNameMatch.js'

const V1 = 'https://api.gbif.org/v1/species'
const cache = new Map()

export function fetchChecklistConcept(validName, twNodes, opts = {}) {
  const { checklistKey, fetchImpl } = opts
  const key = `${checklistKey}|${validName}`
  if (!cache.has(key)) {
    cache.set(key, resolve(validName, twNodes, checklistKey, fetchImpl || fetch))
  }
  return cache.get(key)
}

async function getJson(f, url) {
  const res = await f(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function resolve(validName, twNodes, checklistKey, f) {
  let search
  try {
    search = await getJson(
      f,
      `${V1}?datasetKey=${checklistKey}&name=${encodeURIComponent(validName)}`
    )
  } catch {
    return null
  }
  const rows = search?.results || []
  if (!rows.length) return null

  // prefer an accepted usage; follow a synonym to its accepted key
  let usage =
    rows.find((r) => r.taxonomicStatus === 'ACCEPTED') || rows[0]
  if (usage.taxonomicStatus !== 'ACCEPTED' && usage.acceptedKey) {
    try {
      usage = await getJson(f, `${V1}/${usage.acceptedKey}`)
    } catch {
      /* keep the synonym usage */
    }
  }

  const intKey = usage.key
  const alphaKey = usage.taxonID || null

  let synRes = { results: [] }
  try {
    synRes = await getJson(f, `${V1}/${intKey}/synonyms?limit=200`)
  } catch {
    /* no synonyms is valid */
  }

  const bucketed = { synonyms: [], misapplied: [] }
  for (const r of synRes.results || []) {
    const name = r.scientificName
    if (!name) continue
    const ck = matchKey(name)
    const entry = {
      name,
      status: r.taxonomicStatus || 'SYNONYM',
      matchKey: ck,
      matchTier: bestTier(twNodes, ck, name)
    }
    if (r.taxonomicStatus === 'MISAPPLIED') bucketed.misapplied.push(entry)
    else bucketed.synonyms.push(entry)
  }

  return {
    accepted: {
      name: usage.scientificName || validName,
      alphaKey,
      intKey
    },
    synonyms: bucketed.synonyms,
    misapplied: bucketed.misapplied
  }
}

// the strongest tier this single CoL name reaches against any TaxonWorks node.
// Only the one name being graded goes into colNameStrings, so the homotypic
// branch means "this CoL name shares a protonym with a TaxonWorks node's
// original combination", not "somewhere in the whole concept".
function bestTier(twNodes, colKey, colName) {
  const rank = { homotypic: 3, probable: 2, weak: 1, none: 0 }
  let best = 'none'
  for (const node of twNodes) {
    const t = matchTier(node.matchKey, colKey, {
      twOriginalCombination: node.originalCombination,
      colNameStrings: [colName]
    })
    if (rank[t] > rank[best]) best = t
  }
  return best
}
