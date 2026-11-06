// Map<biologicalAssociationId, assertedDistributionId[]> over /asserted_distributions
// records: which distributions are derived from which association (read from the
// record itself, `asserted_distribution_object_type`). Plain ADs are left out.
// Used by ../components/MapPopup.vue to file an association's reassessment under
// its distributions.
export function associationAdIds(ads) {
  const byBa = new Map()
  for (const ad of ads || []) {
    if (ad?.asserted_distribution_object_type !== 'BiologicalAssociation') continue
    const baId = ad.asserted_distribution_object_id
    if (!byBa.has(baId)) byBa.set(baId, [])
    byBa.get(baId).push(ad.id)
  }
  return byBa
}
