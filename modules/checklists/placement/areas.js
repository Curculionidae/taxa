// Areas as the placement engine sees them, and the name matching it shares.
//
// Purpose: TaxonWorks delivers the place of a distribution as a "shape" that
// is either a geographic area (GA) or a gazetteer (GZ), with different fields.
// toArea turns either into one flat Area, so the rest of the engine never
// looks at raw TaxonWorks JSON. normalizeName and containsName are the one way
// names are compared anywhere in the engine (accent and case insensitive).
//
// Input:  toArea gets the shape type ('GeographicArea' or 'Gazetteer') and the
//         `asserted_distribution_shape` JSON of one distribution.
// Output: an Area (see the typedef). Fields TaxonWorks does not give are null.

/**
 * @typedef {'GA' | 'GZ'} AreaKind
 *
 * @typedef {Object} Area
 * @property {string} key         'GA 78' or 'GZ 10453', the id used in the rules file
 * @property {AreaKind} kind      geographic area or gazetteer
 * @property {number} id          TaxonWorks id inside its kind
 * @property {string} name
 * @property {string|null} origin  data_origin of a GA ('ne_countries', 'tdwg_l3', ...)
 * @property {string|null} type    geographic_area_type name of a GA ('Country', 'TDWG Level 3', ...)
 * @property {string|null} tdwg    TDWG code of a GA ('12FRA')
 * @property {string|null} iso2    ISO 3166-1 alpha-2 code
 * @property {number|null} level0  id of the country-level area above a GA (itself for a country)
 * @property {number|null} level1  id of the first subdivision above a GA
 * @property {number|null} level2  id of the second subdivision above a GA (a county)
 * @property {number|null} parentId
 * @property {string|null} parentName
 */

/**
 * Turn a TaxonWorks shape into an Area.
 * @param {'GeographicArea' | 'Gazetteer'} shapeType
 * @param {Object} shape  `asserted_distribution_shape` as TaxonWorks delivers it
 * @returns {Area}
 */
export function toArea(shapeType, shape) {
  const kind = shapeType === 'Gazetteer' ? 'GZ' : 'GA'
  return {
    key: `${kind} ${shape.id}`,
    kind,
    id: shape.id,
    name: shape.name ?? '',
    origin: shape.data_origin ?? null,
    type: shape.geographic_area_type?.name ?? null,
    tdwg: shape.tdwgID ?? null,
    iso2: shape.iso_3166_a2 ?? null,
    level0: shape.level0_id ?? null,
    level1: shape.level1_id ?? null,
    level2: shape.level2_id ?? null,
    parentId: shape.parent_id ?? null,
    parentName: shape.parent?.name ?? null
  }
}

/**
 * Normal form of a name for comparing: accents removed, lower case, every run
 * of other characters collapsed to one space, trimmed.
 * @param {string} text
 * @returns {string}  'São Tomé, and Principe' gives 'sao tome and principe'
 */
export function normalizeName(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Whole-word test: does the normalized text contain the normalized name?
 * @param {string} text  e.g. 'REU-00 (Reunion aggregation)'
 * @param {string} name  e.g. 'Réunion'
 * @returns {boolean}  false for an empty name
 */
export function containsName(text, name) {
  const wanted = normalizeName(name)
  if (!wanted) return false
  return ` ${normalizeName(text)} `.includes(` ${wanted} `)
}

/**
 * Geographic area types that are a country, as in TaxonWorks
 * (GeographicAreaType::COUNTRY_LEVEL_TYPES, app/models/geographic_area_type.rb).
 */
export const COUNTRY_LEVEL_TYPES = ['Country', 'Governorate']

/**
 * Is the area a country area? The same test as TaxonWorks'
 * GeographicArea#categorize (app/models/geographic_area.rb): its id is its own
 * level0 id, or its type is a country-level type, or its parent is Earth and
 * it is not a TDWG area (data origin contains "tdwg"). So GA 33412 "United
 * States of America" (type Country, parent Earth, level0 empty) is a country.
 * @param {Area} area
 * @returns {boolean}  always false for gazetteers
 */
export function isCountryArea(area) {
  if (area.kind !== 'GA') return false
  if (area.level0 != null && area.id === area.level0) return true
  if (COUNTRY_LEVEL_TYPES.includes(area.type)) return true
  return normalizeName(area.parentName) === 'earth' && !String(area.origin ?? '').includes('tdwg')
}

/**
 * Geographic area types that are a state or province, as in TaxonWorks
 * (GeographicAreaType::STATE_LEVEL_TYPES, app/models/geographic_area_type.rb).
 */
export const STATE_LEVEL_TYPES = ['State', 'Province', 'District', 'Prefecture', 'Region', 'Territory', 'Republic', 'Area', 'Oblast', 'Krai']

/**
 * Is the area a state (first subdivision of a country)? The state test of
 * TaxonWorks' GeographicArea#categorize (app/models/geographic_area.rb), after
 * its country test (isCountryArea): its type is a state-level type, or its data
 * origin is ne_states (Natural Earth states), or its id is its own level1 id, or
 * its parent is a country. TaxonWorks tests the parent with parent.id ==
 * parent.level0_id; an Area only knows its own level0, so the caller says
 * whether the parent is a country (the engine: the parent is an area of the
 * checklist). The gadm US states (GA 26386 Texas: type Unknown, no level ids,
 * parent GA 237 United States) are states only that way. A county (GA 30398
 * Colorado, type County, level1 GA 26386 Texas) is not, whatever its name.
 * TaxonWorks' last clause (grandparent Earth) is left out: an Area does not
 * know its grandparent.
 * @param {Area} area
 * @param {boolean} [parentIsCountry]  the area's parent is a country area
 * @returns {boolean}  always false for gazetteers, TDWG areas and countries
 */
export function isStateArea(area, parentIsCountry = false) {
  if (area.kind !== 'GA' || isCountryArea(area) || String(area.origin ?? '').includes('tdwg')) return false
  if (STATE_LEVEL_TYPES.includes(area.type)) return true
  if (area.origin === 'ne_states') return true
  if (area.level1 != null && area.id === area.level1) return true
  if (area.parentId != null && area.parentId === area.level0) return true
  return parentIsCountry
}
