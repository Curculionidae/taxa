import { alphabetical, relationshipValue } from './groupStandardAssociations.js'
import { anatomicalPartName, displayFamily, hasTaxonName, plainText, resolveSpecimenRef, specimenKey } from './makeBiologicalAssociation.js'
import { isReferenceCitation, rankName } from './loadAdvancedAssociations.js'
import { citationWithoutPages } from '../_shared/citationText.js'
export { advancedScope } from './browserSessionStorage.js'

const participantColumns = side => [
  ['family', 'Family'], ['subfamily', 'Subfamily', true], ['tribe', 'Tribe', true], ['genus', 'Genus'],
  ['subgenus', 'Subgenus', true], ['species', 'Species'],
  ['part', 'Anatomical part']
].map(([field, label, optional]) => ({ key: `${side}.${field}`, side, field, label, optional: !!optional }))

export const ADVANCED_COLUMNS = [
  ...participantColumns('subject'),
  { key: 'relationship', label: 'Relationship', side: 'biological' },
  ...participantColumns('object'),
  ...[['depictions', 'Depictions', true], ['area', 'Area', true], ['citations', 'Citations'],
    ['tags', 'Tags', true], ['attribute', 'Data attribute', true], ['value', 'Data value', true]]
    .map(([key, label, optional]) => ({ key, label, side: 'metadata', optional: !!optional }))
]
export const DEFAULT_COLUMNS = ADVANCED_COLUMNS.filter(column => !column.optional).map(column => column.key)

/** `-aceae` under the ICN and `-idae` under the ICZN are family endings; no
 * genus in either code can end this way. Only consulted for an OTU that carries
 * no TaxonName at all, where nothing else records a rank. */
const FAMILY_ENDING = /(?:aceae|idae)$/

export function defaultAdvancedSettings() {
  return { columns: [...DEFAULT_COLUMNS], filters: {}, sort: null,
    original: { subject: false, object: false }, showAuthorship: false, per: 50 }
}

export function normalizeAdvancedSettings(value) {
  const defaults = defaultAdvancedSettings()
  if (!value || typeof value !== 'object') return defaults
  const keys = new Set(ADVANCED_COLUMNS.map(column => column.key))
  const columns = Array.isArray(value.columns) ? value.columns.filter(key => keys.has(key)) : defaults.columns
  // One menu option controls the two aligned attribute columns, including
  // preferences saved when they could still be selected independently.
  if (columns.includes('attribute') || columns.includes('value')) columns.push('attribute', 'value')
  const filters = Object.fromEntries(Object.entries(value.filters || {}).filter(([key, values]) =>
    keys.has(key) && Array.isArray(values) && values.every(item => typeof item === 'string')))
  // The citation filter selects publications. A selection saved while it still
  // offered single pages keeps selecting the same publications.
  if (filters.citations) filters.citations = [...new Set(filters.citations.map(citationWithoutPages))]
  return {
    columns: columns.length ? [...new Set(columns)] : defaults.columns,
    filters,
    sort: keys.has(value.sort?.key) && ['asc', 'desc'].includes(value.sort?.direction) ? value.sort : defaults.sort,
    original: { subject: value.original?.subject === true, object: value.original?.object === true },
    showAuthorship: value.showAuthorship === true,
    per: [50, 100].includes(Number(value.per)) ? Number(value.per) : 50
  }
}

/** Preserve all epithets; keep authorship separate so it can remain roman. */
export function splitAdvancedName(name, authorship = '') {
  const text = plainText(name)
  const match = text.match(/^(\S+)(?:\s+\(([^)]+)\)(?=\s+[\p{Ll}×]))?(?:\s+(.*))?$/u)
  if (!match) return { genus: '', subgenus: '', species: text, authorship }
  const [, genus, subgenus = '', rest = ''] = match
  const words = rest.split(/\s+/).filter(Boolean)
  let index = 0
  while (index < words.length && /^(?:\p{Ll}|×)/u.test(words[index])) index++
  return { genus, subgenus, species: words.slice(0, index).join(' '),
    authorship: plainText(authorship) || words.slice(index).join(' ') }
}

export function advancedParticipant(row, side, taxa, original = false, classification = new Map(), showAuthorship = false, allowUnlinked = false) {
  const entity = row[side] || {}
  const otuId = row[`${side}_otu_id`] || (entity.type === 'Otu' ? entity.id : null)
  const otu = taxa.otuById.get(String(otuId))
  const taxon = (!original && otu?.accepted_taxon_name) || otu?.taxon_name
  const specimen = resolveSpecimenRef({ base_class: entity.type, id: entity.id, object_label: entity.label })
  const dwc = specimen && taxa.dwcBySpecimen.get(specimenKey(specimen))
  const part = anatomicalPartName(entity)
  const label = part ? entity.label.slice(entity.label.indexOf(': ') + 2) : entity.label
  // The legacy /basic response already contains the display label and OTU id,
  // but not necessarily a separately loaded OTU object. In that mode an OTU
  // id is enough to retain the old panel's row; the normal V2 path still
  // requires an explicit TaxonName.
  const linked = hasTaxonName(otu) || (allowUnlinked && !!otuId)
  const scientificName = taxon?.cached || dwc?.scientificName || (linked && !specimen ? label : null)
  const name = scientificName || otu?.name || label || ''
  const names = linked && scientificName ? splitAdvancedName(name, taxon?.cached_author_year) :
    { genus: '', subgenus: '', species: plainText(name), authorship: '' }
  const taxonomy = classification.get(String(taxon?.id)) || {}
  const indexFamily = displayFamily(taxonomy.family || entity.family || dwc?.family)
  const genusOnly = !!names.genus && !names.species
  // The Genus column may only hold a genus. TaxonWorks files a family-group OTU
  // under a one-word name, and splitAdvancedName can read a one-word name as
  // nothing but a genus. Either the Family column already says the very same
  // thing, or it is empty and the name is itself a family name. A tribe or
  // subfamily resolves to a different, non-empty family and is left where it is:
  // its name would otherwise disappear, because those columns are optional and
  // hidden by default.
  const familyLevel = genusOnly && (names.genus === indexFamily
    || (!indexFamily && (rankName(taxon) === 'family' || (!taxon && FAMILY_ENDING.test(names.genus)))))
  const family = familyLevel ? indexFamily || names.genus : indexFamily
  const participant = {
    ...names, family, subfamily: taxonomy.subfamily || '', tribe: taxonomy.tribe || '',
    genusOtuId: taxonomy.genusOtuId || null,
    part: displayFamily(part),
    otuId: linked && family ? (!original && otu?.accepted_otu_id) || otuId : null,
    specimen, italic: linked && !!scientificName, dwc, hasTaxonName: linked
  }
  const synonym = original && otu?.accepted_taxon_name
    && String(otu.accepted_taxon_name.id) !== String(otu.taxon_name?.id || otu.taxon_name_id)
  const fullName = value => [value.genus, value.subgenus ? `(${value.subgenus})` : '', value.species].filter(Boolean).join(' ')
  // A name kept as a synonym is not a destination: only the accepted name is a
  // link, and it leads to the OTU that actually carries the records.
  const speciesNames = [{ name: synonym ? fullName(names) : names.species,
    authorship: showAuthorship ? names.authorship : '', otuId: synonym ? null : participant.otuId }]
  if (synonym) {
    const accepted = advancedParticipant(row, side, taxa, false, classification, showAuthorship, allowUnlinked)
    const acceptedNames = splitAdvancedName(otu.accepted_taxon_name.cached, otu.accepted_taxon_name.cached_author_year)
    speciesNames.push({ name: fullName(acceptedNames), authorship: showAuthorship ? acceptedNames.authorship : '', otuId: accepted.otuId })
  }
  // Authorship reads as part of a species name. An OTU with no epithet -- a
  // genus, or a tribe or subfamily left here because its family is a different
  // one -- reaches the reader through the Genus column, and is shown there
  // without authorship, the way the Family column already is.
  const genusNames = genusOnly ? speciesNames.map(value => ({ ...value,
    name: value.name || names.genus, authorship: '' })) : [{ name: names.genus, authorship: '', otuId: participant.genusOtuId }]
  if (genusOnly) speciesNames.length = 0
  // A family is roman and carries no authorship here, and the cell has to read
  // exactly like the value the filter, the sorting and the clipboard see.
  const familyNames = [{ name: family, authorship: '', otuId: familyLevel ? participant.otuId : null }]
  if (familyLevel) { genusNames.length = 0; speciesNames.length = 0 }
  return { ...participant, speciesNames, genusNames, familyNames,
    genus: genusNames.map(value => [value.name, value.authorship].filter(Boolean).join(' ')).join(' now '),
    species: speciesNames.map(value => [value.name, value.authorship].filter(Boolean).join(' ')).join(' now ') }
}

export function makeAdvancedRows(rows, taxa, settings, metadata = {}, classification = new Map(), allowUnlinked = false) {
  return rows.map(row => {
    const subject = advancedParticipant(row, 'subject', taxa, settings.original.subject, classification, settings.showAuthorship, allowUnlinked)
    const object = advancedParticipant(row, 'object', taxa, settings.original.object, classification, settings.showAuthorship, allowUnlinked)
    const attrs = metadata.attributes?.get(String(row.id)) || []
    const distributions = metadata.distributions?.get(String(row.id)) || []
    const locality = subject.dwc || object.dwc
    // Split what TaxonWorks keeps in one column: references a reader can open,
    // and names of people. The /basic index puts the collector or determiner
    // into `citations` whenever the record has no citation of its own, and the
    // specimen's `recordedBy` is the last fallback -- neither is a source.
    const citations = metadata.citations?.get(String(row.id)) || []
    const references = citations.filter(isReferenceCitation)
    const notes = citations.filter(citation => !isReferenceCitation(citation))
      .map(citation => plainText(citation.short))
    const labels = citations.map(citation => plainText(citation.short))
    const collector = plainText(row.citations) || subject.dwc?.recordedBy || object.dwc?.recordedBy || ''
    return { id: row.id, subject, object, relationship: relationshipValue(row),
      depictions: (metadata.depictions?.get(String(row.id)) || []).length ? 'Present' : 'Absent',
      area: distributions.length ? distributions.map(item => item.isAbsent ? `${item.area} (absent)` : item.area) :
        [[locality?.country, locality?.stateProvince, locality?.county].filter(Boolean).join(', ')].filter(Boolean),
      citationList: references,
      citationNotes: (citations.length ? notes : [collector]).filter(Boolean),
      // One combined value, so sorting and copying keep seeing the column
      // exactly as it reads.
      citations: citations.length ? labels : collector,
      // The filter offers one term per publication, not one per cited page.
      citationFilter: citations.length ? [...new Set(labels.map(citationWithoutPages))] : collector,
      tags: metadata.tags?.get(String(row.id)) || [],
      attributes: attrs, attribute: attrs.map(item => item.name), value: attrs.map(item => item.value)
    }
  }).filter(row => allowUnlinked || (row.subject.hasTaxonName && row.object.hasTaxonName))
}

export function columnValues(row, key) {
  const [side, field] = key.split('.')
  const value = field ? row[side]?.[field] : row[key]
  return Array.isArray(value) ? value.length ? value : [''] : [String(value ?? '')]
}

/** Columns whose filter offers coarser terms than the cell reads. A citation
 * reads "Author, Year:page"; its filter selects the publication. */
const FILTER_FIELDS = { citations: 'citationFilter' }
export function filterValues(row, key) { return columnValues(row, FILTER_FIELDS[key] || key) }

export function selectedColumnValues(rows, settings, key) {
  return settings.filters[key] ?? [...new Set(rows.flatMap(row => filterValues(row, key)))]
}

/** Filter before paginating, like filter() then arrange() then slice() in R. */
export function filterAdvancedRows(rows, settings) {
  const filters = Object.entries(settings.filters)
  return rows.filter(row => {
    // When both attribute columns are filtered, the key and value must belong
    // to the same annotation, not two unrelated attributes on the association.
    const attributeKeys = settings.filters.attribute
    const attributeValues = settings.filters.value
    if (attributeKeys && attributeValues) {
      const attributes = row.attributes.length ? row.attributes : [{ name: '', value: '' }]
      if (!attributes.some(item => attributeKeys.includes(item.name) && attributeValues.includes(item.value))) return false
    }
    return filters.every(([key, selected]) => filterValues(row, key).some(value => selected.includes(value)))
  })
}

/** A display-name switch preserves selected taxa by translating the active
 * name terms through the same records. Absent terms from another taxon page
 * remain saved until that page is visited again.
 */
export function translateNameFilters(before, after, filters, side) {
  const translated = { ...filters }
  const nextById = new Map(after.map(row => [row.id, row]))
  for (const field of ['family', 'subfamily', 'tribe', 'genus', 'subgenus', 'species']) {
    const key = `${side}.${field}`
    if (!filters[key]) continue
    const values = new Map()
    for (const row of before) {
      const value = row[side][field]
      if (!values.has(value)) values.set(value, new Set())
      values.get(value).add(nextById.get(row.id)[side][field])
    }
    translated[key] = [...new Set(filters[key].flatMap(value => values.has(value) ? [...values.get(value)] : [value]))]
  }
  return translated
}

export function sortAdvancedRows(rows, sort) {
  sort ||= { key: 'subject.genus', direction: 'asc' }
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => direction * alphabetical(
    columnValues(a, sort.key).join(', '), columnValues(b, sort.key).join(', ')
  ) || alphabetical(a.subject.genus, b.subject.genus)
    || alphabetical(a.subject.species, b.subject.species)
    || alphabetical(a.object.genus, b.object.genus)
    || alphabetical(a.object.species, b.object.species) || Number(a.id) - Number(b.id))
}

/** A null sort restores the initial alphabetical order without marking a
 * column as manually sorted. */
export function nextAdvancedSort(sort, key) {
  if (sort?.key !== key) return { key, direction: 'asc' }
  return sort.direction === 'asc' ? { key, direction: 'desc' } : null
}
