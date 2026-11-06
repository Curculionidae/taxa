// Data attributes for the distribution table, pure helpers (the requests are
// in ../PanelAssertedDistributions.vue).

const predicateOf = (attr) => attr.predicate_name || attr.import_predicate || ''

// The attributes whose predicate is one of `predicates`, case ignored. Used for
// a biological association's attributes: only these are shown under the
// distributions derived from it (default: Reassessment), not its Microhabitat
// or Activity pattern.
export function withPredicates(list, predicates) {
  const wanted = new Set((predicates || []).map((p) => String(p).toLowerCase()))
  return (list || []).filter((a) => wanted.has(predicateOf(a).toLowerCase()))
}

// Map<subjectId, { id, predicate, value, citation }[]>, citation from
// `citationByAttrId` (null when the attribute has none).
export function attributesBySubject(list, citationByAttrId) {
  const result = new Map()
  for (const attr of list || []) {
    const id = attr.attribute_subject_id
    if (!result.has(id)) result.set(id, [])
    result.get(id).push({
      id: attr.id,
      predicate: predicateOf(attr),
      value: attr.value,
      citation: citationByAttrId.get(attr.id) || null
    })
  }
  return result
}
