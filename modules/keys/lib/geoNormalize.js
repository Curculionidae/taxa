// Pure. Turn a heterogeneous TaxonWorks distribution shape, or a specimen DwC
// `country` string, into one { key, label } territory or null. `key` is an
// ISO 3166-1 alpha-2 code where one applies, otherwise a lowercase slug
// (`russia-european`, `west-siberia`). No Vue, no network. See the design spec,
// section 4.

import {
  ISO_NAME, NAME_ALIASES_DISPLAY, ASIAN_RUSSIA, SLUG_LABEL, EUROPEAN_RUSSIA
} from './geoData.js'

// Lowercased lookup used by nameToIso() below — derived from the display
// table above so the two never drift apart.
const NAME_ALIASES = Object.fromEntries(
  Object.entries(NAME_ALIASES_DISPLAY).map(([display, iso]) => [norm(display), iso])
)

function norm(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Country name (any casing / spacing, plus the alias table) -> ISO2, or null.
const NAME_ISO = Object.fromEntries(
  Object.entries(ISO_NAME).map(([iso, name]) => [norm(name), iso])
)
export function nameToIso(name) {
  const n = norm(name)
  if (!n) return null
  return NAME_ISO[n] || NAME_ALIASES[n] || null
}

export function countryName(iso) {
  return ISO_NAME[String(iso || '').toUpperCase()] || null
}

// Every country this module knows how to normalize, as { key, label } pairs --
// the module's single source of truth for a geography-probe candidate list
// (see composables/useKeyGeography.js's flat-column pass), so results key
// identically to shapes/specimen strings normalized elsewhere in the module.
// Includes the alias spellings too (canonical labels first, so labelByKey in
// useKeyGeography.js keeps the canonical label when both hit): the flat-pass
// probe does an exact string match against whatever the specimen record
// actually spelled, and specimen data is confirmed to use these alternate
// spellings (that's why NAME_ALIASES exists), so the canonical label alone
// would silently miss them.
export function allCountries() {
  const canonical = Object.entries(ISO_NAME).map(([key, label]) => ({ key, label }))
  const aliases = Object.entries(NAME_ALIASES_DISPLAY).map(([label, key]) => ({ key, label }))
  return [...canonical, ...aliases]
}

// A display label for any territory key, independent of which key is loaded
// (the picker's own list only carries the current key's territories). ISO2 ->
// country name; known slugs -> their label; anything else -> title-cased slug.
export function territoryLabel(key) {
  if (!key) return ''
  return (
    countryName(key) ||
    SLUG_LABEL[key] ||
    String(key).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function russiaTerritory(name) {
  const n = norm(name)
  if (n === 'russia' || n === 'russian federation') return { key: 'RU', label: 'Russia' }
  if (/european russia$/.test(n) || n === 'european russia') return EUROPEAN_RUSSIA
  if (ASIAN_RUSSIA.has(n)) return { key: slug(name), label: String(name).trim() }
  // A bare region name ("Siberia", "Central Siberia") is not a territory.
  if (/siberia/.test(n)) return null
  // "Russia" qualified some other way (e.g. "Russia South") -> fall back to RU.
  return { key: 'RU', label: 'Russia' }
}

export function normalizeShape(shape) {
  if (!shape) return null
  const name = String(shape.name || '').trim()
  if (!name) return null
  const iso = shape.iso_3166_a2 ? String(shape.iso_3166_a2).toUpperCase() : null
  const gtype = shape.geographic_area_type?.name || null
  const n = norm(name)

  // 1. Region-level TDWG statements cannot be pinned to a territory (checked
  //    first so "Siberia" as a TDWG Level 2 region is not mis-pinned to RU).
  if (gtype === 'TDWG Level 2') return null

  // 2. Russia special-case: the "European Russia" gazetteer carries iso RU, and
  //    the Urals split matters, so branch by name before trusting the ISO.
  if (iso === 'RU' || /\brussia\b|\bsiberia\b/.test(n)) return russiaTerritory(name)

  // 3. An explicit ISO wins.
  if (iso) return { key: iso, label: countryName(iso) || name }

  // 4. The shape's own name is a country -- but not when the shape is a
  //    sub-national GADM / Natural Earth unit that merely shares a name with an
  //    unrelated country (the municipality of "Albania" in Caqueta, Colombia;
  //    the Shire of "Denmark" in Western Australia; the US state of "Georgia").
  //    Those carry GADM hierarchy pointers to a level-0 country that is not the
  //    shape itself; a genuine country record has level0_id null or equal to
  //    its own id. Step 5 still gets a chance to resolve them via the parent.
  const isSubnational =
    (shape.level0_id != null && shape.level0_id !== shape.id) ||
    shape.level1_id != null ||
    shape.level2_id != null
  const byName = isSubnational ? null : nameToIso(name)
  if (byName) return { key: byName, label: countryName(byName) }

  // 5. The parent is a country (TDWG Level 4, subdivision shapes).
  const byParent = nameToIso(shape.parent?.name)
  if (byParent) return { key: byParent, label: countryName(byParent) }

  // 6. Unresolvable (Caucasus, Illyria, Eastern Europe, ...).
  return null
}

// Specimen DwC `country` strings: alias table, then the name map. Bare "Russia"
// stays RU here (a specimen locality is not evidence of European vs Asian).
export function normalizeCountryString(str) {
  const iso = nameToIso(str)
  return iso ? { key: iso, label: countryName(iso) } : null
}
