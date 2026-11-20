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
    .replace(/[̀-ͯ]/g, '')
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
