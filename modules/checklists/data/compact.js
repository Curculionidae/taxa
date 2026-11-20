// Compact form of a country checklist file (public/checklists/countries/<id>.json).
//
// The build (modules/checklists/scripts/build.mjs) writes compactChecklist(records),
// the page reads expandChecklist(file) and gets the same records back, so
// nothing after loading changes. What makes it small, per country:
//   - taxa: each distinct taxon (name, authorship, rank, higher taxa, OTU)
//     once; a record names it by index (`t`).
//   - kinds: each distinct (dwc_occurrence_object_type, basisOfRecord) pair
//     once (`k`).
//   - refs: each full reference text once; a citation is [id, ref, pages],
//     a reassessment source a ref index.
//   - country: the most common DwC country once; a record carries `country`
//     only when it differs.
// Every other field stays as it is. Tables are per country, not global, so a
// small country does not download the dictionaries of the large ones.

export const TAXON_FIELDS = [
  'otu_id', 'scientificName', 'scientificNameAuthorship', 'taxonRank',
  'superfamily', 'family', 'subfamily', 'tribe', 'subtribe', 'genus'
]
const KIND_FIELDS = ['dwc_occurrence_object_type', 'basisOfRecord']
const FORMAT = 1

function tableIndex(table, lookup, key, value) {
  if (!lookup.has(key)) {
    lookup.set(key, table.length)
    table.push(value)
  }
  return lookup.get(key)
}

// A field missing on a record is stored as null in its tuple and left out
// again when expanded (null never occurs as a value in these records).
const tupleOf = (record, fields) => fields.map((field) => (field in record ? record[field] : null))

function mostCommon(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  let best = null
  for (const [value, count] of counts) if (best === null || count > counts.get(best)) best = value
  return best
}

export function compactChecklist(records) {
  const taxa = []
  const kinds = []
  const refs = []
  const taxonLookup = new Map()
  const kindLookup = new Map()
  const refLookup = new Map()
  const ref = (full) => tableIndex(refs, refLookup, full, full)
  const country = mostCommon(records.map((record) => record.country).filter((value) => value !== undefined))

  const rows = records.map((record) => {
    const taxon = tupleOf(record, TAXON_FIELDS)
    const kind = tupleOf(record, KIND_FIELDS)
    const row = {
      t: tableIndex(taxa, taxonLookup, JSON.stringify(taxon), taxon),
      k: tableIndex(kinds, kindLookup, JSON.stringify(kind), kind)
    }
    for (const [field, value] of Object.entries(record)) {
      if (TAXON_FIELDS.includes(field) || KIND_FIELDS.includes(field)) continue
      if (field === 'country') {
        if (value !== country) row.country = value
      } else if (field === 'citations') {
        row.citations = value.map((citation) => [citation.id, ref(citation.full), citation.pages])
      } else if (field === 'reassessed') {
        row.reassessed = value.map((entry) => ({ ...entry, sources: entry.sources.map(ref) }))
      } else {
        row[field] = value
      }
    }
    // A record without a country (none so far) must not get the default back.
    if (!('country' in record)) row.country = null
    return row
  })

  return { format: FORMAT, country, taxa, kinds, refs, records: rows }
}

function assignTuple(record, fields, tuple) {
  fields.forEach((field, index) => {
    if (tuple[index] !== null) record[field] = tuple[index]
  })
}

export function expandChecklist(file) {
  // Files written before the compact form are the plain record array.
  if (Array.isArray(file)) return file
  const { country, taxa, kinds, refs } = file

  return file.records.map((row) => {
    const record = {}
    assignTuple(record, KIND_FIELDS, kinds[row.k])
    assignTuple(record, TAXON_FIELDS, taxa[row.t])
    if (!('country' in row) && country !== null) record.country = country
    for (const [field, value] of Object.entries(row)) {
      if (field === 't' || field === 'k') continue
      if (field === 'country') {
        if (value !== null) record.country = value
      } else if (field === 'citations') {
        record.citations = value.map(([id, full, pages]) => ({ id, full: refs[full], pages }))
      } else if (field === 'reassessed') {
        record.reassessed = value.map((entry) => ({ ...entry, sources: entry.sources.map((source) => refs[source]) }))
      } else {
        record[field] = value
      }
    }
    return record
  })
}
