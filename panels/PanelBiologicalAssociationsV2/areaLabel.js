/**
 * Display label for an asserted-distribution shape (`asserted_distribution_shape`
 * as serialised by /asserted_distributions).
 *
 * A subdivision is never named without its country: "Antioquia" becomes
 * "Colombia: Antioquia" — same order as the specimen-derived
 * "country: stateProvince" text.
 *
 * The country is only prefixed when the shape is a *direct child* of its
 * country (`parent_id === level0_id`), because `parent.name` is the only
 * ancestor name the API returns. Deeper areas (a county whose parent is a
 * state) and areas whose parent is not a country (TDWG regions, gazetteers)
 * keep their bare name — their country name is not in the response.
 */
export function areaLabel(shape) {
  const name = shape?.name || ''
  const country = shape?.parent?.name
  const isDirectChildOfCountry =
    shape?.level0_id != null &&
    shape.parent_id === shape.level0_id &&
    shape.id !== shape.level0_id
  return name && country && isDirectChildOfCountry ? `${country}: ${name}` : name
}
