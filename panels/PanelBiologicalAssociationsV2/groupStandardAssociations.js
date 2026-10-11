import { makeStandardParticipant } from './makeBiologicalAssociation.js'
import { emptyStandardCounts, standardRowMark } from './standardEvidence.js'

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
export const alphabetical = (a, b) => collator.compare(a || '', b || '')

function sortedValues(values) {
  return [...values].sort(alphabetical)
}

function displayValue(value) {
  const text = value?.trim?.() || ''
  return /^(?:not available|not specified)$/i.test(text) ? '' : text
}

// A record without a readable AnatomicalPart names the plant, not an organ of
// it. The Field Assistant leaves that cell blank: every one of its rows is a
// plant already, so a symbol saying so told nobody anything. Raw data and
// Advanced still spell the term out.
function plantPart(participant) {
  return displayValue(participant.part)
}

/** Keep only the genus and species epithet used by the compact Standard view. */
export function genusSpeciesName(value) {
  const text = value?.trim?.() || ''
  const words = text.split(/\s+/)
  if (words.length < 2) return text

  let index = 1
  if (words[index].startsWith('(')) {
    while (index < words.length && !words[index].endsWith(')')) index++
    index++
  }

  if (words[index] === '×' && /^\p{Ll}/u.test(words[index + 1] || '')) {
    return `${words[0]} × ${words[index + 1]}`
  }
  if (/^(?:×)?\p{Ll}/u.test(words[index] || '')) {
    return `${words[0]} ${words[index]}`
  }
  return text
}

export const UNSPECIFIED_RELATIONSHIP = 'No relationship specified'

export function relationshipValue(row) {
  return row?.relationship?.trim() || UNSPECIFIED_RELATIONSHIP
}

export function filterRowsByRelationships(rows, selectedRelationships) {
  const selected = new Set(selectedRelationships)
  return rows.filter(row => selected.has(relationshipValue(row)))
}

function compareFamilies(a, b) {
  const familyA = a.families.join(', ')
  const familyB = b.families.join(', ')
  if (!familyA && familyB) return 1
  if (familyA && !familyB) return -1
  return alphabetical(familyA, familyB)
}

/**
 * Equivalent to group_by(taxon_id) and summarise() in R.
 * Call separately for each direction, including on higher-rank pages.
 */
export function groupStandardAssociations(
  rows,
  currentSide,
  otuById = new Map(),
  dwcBySpecimen = new Map(),
  familyRows = rows
) {
  const otherSide = currentSide === 'subject' ? 'object' : 'subject'
  const participants = rows.map(row => ({
    row,
    other: makeStandardParticipant(row, otherSide, otuById, dwcBySpecimen),
    current: makeStandardParticipant(row, currentSide, otuById, dwcBySpecimen)
  }))
  // A specimen/part index may lack the family while another record for the
  // very same taxon has it. Share that classification, including when the row
  // carrying it is hidden by the relationship filter.
  const familiesByTaxon = new Map()
  for (const row of familyRows) {
    const other = makeStandardParticipant(row, otherSide, otuById, dwcBySpecimen)
    if (!familiesByTaxon.has(other.key)) familiesByTaxon.set(other.key, new Set())
    const family = displayValue(other.family)
    if (family) familiesByTaxon.get(other.key).add(family)
  }

  const groups = new Map()
  for (const { row, other, current } of participants) {
    const key = other.key
    if (!groups.has(key)) {
      groups.set(key, {
        key, name: other.unlinked ? other.name : genusSpeciesName(other.name),
        italic: other.italic, otuId: other.otuId,
        families: sortedValues(familiesByTaxon.get(other.key)),
        pending: other.pending,
        parts: new Set(), ids: new Set(), counts: emptyStandardCounts()
      })
    }
    const group = groups.get(key)
    group.pending = group.pending || other.pending
    // Biological-association data model animals as Subjects and plants as
    // Objects. Show the plant anatomy on both page directions: the associated
    // Object on an animal page, or the current Object on a plant page.
    const plant = currentSide === 'subject' ? other : current
    const part = plantPart(plant)
    if (part) group.parts.add(part)
    // Count before adding: ids is a Set, and one record must mark its group
    // exactly once even if a direction lists it twice.
    if (!group.ids.has(row.id)) group.counts[standardRowMark(row)]++
    group.ids.add(row.id)
  }

  return [...groups.values()].map(group => ({
    ...group,
    parts: sortedValues(group.parts),
    ids: [...group.ids],
    count: group.ids.size
  })).sort((a, b) =>
    compareFamilies(a, b)
    || alphabetical(a.name, b.name)
    || alphabetical(a.key, b.key)
  )
}
