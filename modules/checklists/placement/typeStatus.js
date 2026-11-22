// Undetermined type specimens: their name from the DwC typeStatus.
//
// Purpose: the user never adds a determination to a type specimen (the type
// status is its identification), so its DwC row has no otu_id, scientificName
// or taxonRank and the build's screening dropped it (722 rows on 2026-11-22).
// The name in the type status is resolved through TaxonWorks to the valid name
// and its OTU, as the species map does (panels/_shared/typeMaterialSpecimen.js),
// and the row is then screened and placed like any specimen.
//
// Input:  a DwC typeStatus text ("paratype of Phaeopholus vietnamensis
//         Legalov, 2026"); for resolveTypeName a `get(path, params)` that
//         returns TaxonWorks JSON (download.mjs in the build, makeAPIRequest
//         on the curator page), so both use this one function.
// Output: typeStatusName: the status, the name as printed, the authorship;
//         resolveTypeName: { taxonName, valid, otuId } or { error };
//         typeRow: the DwC row completed with the valid name, or { unplaced }.
// Requests (resolveTypeName):
//   GET /taxon_names?name=<name>&name_exact=true   the name exactly as printed,
//       subgenus and "var." included (only then does the exact search find it;
//       without name_exact it is a substring search: "Larinus latus" gives 7)
//   GET /taxon_names/:id                            the valid name of a synonym
//   GET /otus?taxon_name_id[]=<valid id>            its OTU
// Purity: no state; resolveTypeName talks to TaxonWorks only through `get`.

// Rank words between epithets ("var. vicinus").
const RANK_WORD = /^(var|subsp|ssp|ab|f|forma|morpha|nat)\.$/
const EPITHET = /^[a-zà-ÿ][a-zà-ÿ'-]*$/
const SUBGENUS = /^\([A-Z][a-zà-ÿ]+\)$/
const SIC = /^\[sic\]$/i

/**
 * The name a type status refers to, as printed: the part after the last
 * " of ", split into the name (genus, a subgenus in parentheses, epithets and
 * rank words) and the authorship after it.
 * @param {string|null|undefined} typeStatus
 * @returns {{ status: string, name: string, author: string }|null}  null without
 *   " of " or with several statuses (";" or "|")
 * @example
 *   typeStatusName('holotype of Aus (Bus) cus (Smith, 1900)')
 *   // { status: 'holotype', name: 'Aus (Bus) cus', author: '(Smith, 1900)' }
 */
export function typeStatusName(typeStatus) {
  const parts = String(typeStatus ?? '').split(/\s*[;|]\s*/).filter(Boolean).map(oneStatus)
  if (!parts.length || parts.some((part) => !part)) return null
  // Several statuses: only when they all name the same taxon (a repeated status).
  return parts.every((part) => part.name === parts[0].name && part.author === parts[0].author) ? parts[0] : null
}

// One "<status> of <name> <author>".
function oneStatus(text) {
  const at = text.lastIndexOf(' of ')
  if (at < 0) return null
  const tokens = text.slice(at + 4).trim().split(/\s+/)
  if (!/^[A-Z]/.test(tokens[0] ?? '')) return null
  let end = 1
  const skip = () => { while (SIC.test(tokens[end] ?? '')) end++ }
  skip()
  if (SUBGENUS.test(tokens[end] ?? '')) end++
  skip()
  while (end < tokens.length && (EPITHET.test(tokens[end]) || (RANK_WORD.test(tokens[end]) && EPITHET.test(tokens[end + 1] ?? '')))) {
    end++
    skip()
  }
  return { status: text.slice(0, at).trim(), name: tokens.slice(0, end).join(' '), author: tokens.slice(end).join(' ') }
}

// The epithets of a name: its words after the genus, without a subgenus in
// parentheses, [sic] and rank words ("var.").
function epithetCount(name) {
  return String(name ?? '').trim().split(/\s+/).slice(1)
    .filter((word) => !SUBGENUS.test(word) && !SIC.test(word) && !RANK_WORD.test(word)).length
}

// An authorship for comparing: without parentheses and case, spaces collapsed.
const authorKey = (author) => String(author ?? '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The one taxon name the exact search means. Rows without rank (Combination
 * rows next to their protonym) are dropped; when they name several valid
 * taxa, those with the type status name's number of epithets are kept (a
 * species, not its nominotypical subspecies), then those with its author
 * (homonyms); one valid name must remain.
 * @param {Object[]|null} hits  GET /taxon_names rows (id, cached, cached_author_year, rank, cached_valid_taxon_name_id)
 * @param {{ name: string, author: string }} [parsed]  from typeStatusName
 * @returns {Object|null}
 */
export function pickTaxonName(hits, parsed) {
  const validOf = (hit) => hit.cached_valid_taxon_name_id ?? hit.id
  const one = (list) => (list.length && new Set(list.map(validOf)).size === 1 ? list[0] : null)
  let names = (Array.isArray(hits) ? hits : []).filter((hit) => hit.rank != null)
  if (one(names) || !parsed) return one(names)
  const sameEpithets = names.filter((hit) => epithetCount(hit.cached) === epithetCount(parsed.name))
  if (sameEpithets.length) names = sameEpithets
  if (one(names)) return one(names)
  return one(names.filter((hit) => authorKey(hit.cached_author_year) === authorKey(parsed.author)))
}

/**
 * The valid name and OTU of a type status name (see the header for the requests).
 * @param {{ name: string }} parsed  from typeStatusName
 * @param {(path: string, params?: Object) => Promise<any>} get  TaxonWorks JSON
 * @returns {Promise<{ taxonName: Object, valid: Object, otuId: number } | { error: string }>}
 */
export async function resolveTypeName(parsed, get) {
  const hits = await get('/taxon_names', { name: parsed.name, name_exact: true })
  const named = (Array.isArray(hits) ? hits : []).filter((hit) => hit.rank != null)
  if (!named.length) return { error: 'type status name not found in TaxonWorks' }
  const taxonName = pickTaxonName(named, parsed)
  if (!taxonName) return { error: 'type status name is ambiguous in TaxonWorks' }
  const validId = taxonName.cached_valid_taxon_name_id ?? taxonName.id
  const valid = validId === taxonName.id ? taxonName : await get(`/taxon_names/${validId}`)
  const otus = await get('/otus', { taxon_name_id: [validId] })
  const list = Array.isArray(otus) ? otus : []
  if (!list.length) return { error: 'no OTU' }
  // Several OTUs on the name: the unnamed ones (an OTU with a name of its own is
  // a concept of its own), the lowest id of them. Two unnamed OTUs on one name
  // are a duplicate in TaxonWorks with the same name and classification, so
  // the choice changes nothing in the checklists.
  const unnamed = list.filter((otu) => !otu.name)
  const pick = (unnamed.length ? unnamed : list).map((otu) => otu.id).sort((a, b) => a - b)[0]
  return { taxonName, valid, otuId: pick }
}

/**
 * The key of a type status name in `typeNames` (download part type_names.json):
 * the name and the authorship as printed, so homonyms stay apart.
 * @param {{ name: string, author: string }} parsed
 * @returns {string}  'Curculio brunnipes Fabricius, 1798'
 */
export function typeNameKey(parsed) {
  return [parsed.name, parsed.author].filter(Boolean).join(' ')
}

/**
 * A DwC row of an undetermined type specimen, completed from its resolved
 * type status name: otu_id, scientificName (with authorship, as TaxonWorks'
 * DwC writes it), scientificNameAuthorship, taxonRank and typeLabel; the
 * build's screening then takes the classification from the OTU's parents.
 * Any other row comes back unchanged.
 * @param {Object} row  a DwC row (CSV strings)
 * @param {Object} typeNames  { [typeNameKey]: resolveTypeName result } (download part type_names.json)
 * @returns {Object|{ unplaced: string }}
 */
export function typeRow(row, typeNames) {
  if (row.dwc_occurrence_object_type !== 'CollectionObject' || row.otu_id || !String(row.typeStatus ?? '').trim()) return row
  const parsed = typeStatusName(row.typeStatus)
  if (!parsed) return { unplaced: 'type status names no single taxon' }
  const resolved = typeNames?.[typeNameKey(parsed)]
  if (!resolved) return { unplaced: 'type status name not looked up' }
  if (resolved.error) return { unplaced: resolved.error }
  const { valid, otuId } = resolved
  return {
    ...row,
    otu_id: String(otuId),
    scientificName: [valid.cached, valid.cached_author_year].filter(Boolean).join(' '),
    scientificNameAuthorship: valid.cached_author_year ?? '',
    taxonRank: valid.rank ?? '',
    typeLabel: `${parsed.status}, no determination`
  }
}
