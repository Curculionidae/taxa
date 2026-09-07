// Pure. Turn a heterogeneous TaxonWorks distribution shape, or a specimen DwC
// `country` string, into one { key, label } territory or null. `key` is an
// ISO 3166-1 alpha-2 code where one applies, otherwise a lowercase slug
// (`russia-european`, `west-siberia`). No Vue, no network. See the design spec,
// section 4.

// ISO 3166-1 alpha-2 -> canonical English short name. Not exhaustive of every
// dependent territory, but every sovereign state plus the ones the weevil
// distribution data turns up.
const ISO_NAME = {
  AD: 'Andorra', AE: 'United Arab Emirates', AF: 'Afghanistan',
  AG: 'Antigua and Barbuda', AL: 'Albania', AM: 'Armenia', AO: 'Angola',
  AR: 'Argentina', AT: 'Austria', AU: 'Australia', AZ: 'Azerbaijan',
  BA: 'Bosnia and Herzegovina', BB: 'Barbados', BD: 'Bangladesh', BE: 'Belgium',
  BF: 'Burkina Faso', BG: 'Bulgaria', BH: 'Bahrain', BI: 'Burundi', BJ: 'Benin',
  BN: 'Brunei', BO: 'Bolivia', BR: 'Brazil', BS: 'Bahamas', BT: 'Bhutan',
  BW: 'Botswana', BY: 'Belarus', BZ: 'Belize', CA: 'Canada',
  CD: 'Democratic Republic of the Congo', CF: 'Central African Republic',
  CG: 'Republic of the Congo', CH: 'Switzerland', CI: "Cote d'Ivoire",
  CL: 'Chile', CM: 'Cameroon', CN: 'China', CO: 'Colombia', CR: 'Costa Rica',
  CU: 'Cuba', CV: 'Cape Verde', CY: 'Cyprus', CZ: 'Czech Republic',
  DE: 'Germany', DJ: 'Djibouti', DK: 'Denmark', DM: 'Dominica',
  DO: 'Dominican Republic', DZ: 'Algeria', EC: 'Ecuador', EE: 'Estonia',
  EG: 'Egypt', ER: 'Eritrea', ES: 'Spain', ET: 'Ethiopia', FI: 'Finland',
  FJ: 'Fiji', FM: 'Micronesia', FO: 'Faroe Islands', FR: 'France', GA: 'Gabon',
  GB: 'United Kingdom', GD: 'Grenada', GE: 'Georgia', GH: 'Ghana',
  GL: 'Greenland', GM: 'Gambia', GN: 'Guinea', GQ: 'Equatorial Guinea',
  GR: 'Greece', GT: 'Guatemala', GW: 'Guinea-Bissau', GY: 'Guyana',
  HN: 'Honduras', HR: 'Croatia', HT: 'Haiti', HU: 'Hungary', ID: 'Indonesia',
  IE: 'Ireland', IL: 'Israel', IN: 'India', IQ: 'Iraq', IR: 'Iran',
  IS: 'Iceland', IT: 'Italy', JM: 'Jamaica', JO: 'Jordan', JP: 'Japan',
  KE: 'Kenya', KG: 'Kyrgyzstan', KH: 'Cambodia', KI: 'Kiribati',
  KM: 'Comoros', KP: 'North Korea', KR: 'South Korea', KW: 'Kuwait',
  KZ: 'Kazakhstan', LA: 'Laos', LB: 'Lebanon', LI: 'Liechtenstein',
  LK: 'Sri Lanka', LR: 'Liberia', LS: 'Lesotho', LT: 'Lithuania',
  LU: 'Luxembourg', LV: 'Latvia', LY: 'Libya', MA: 'Morocco', MC: 'Monaco',
  MD: 'Moldova', ME: 'Montenegro', MG: 'Madagascar', MK: 'North Macedonia',
  ML: 'Mali', MM: 'Myanmar', MN: 'Mongolia', MR: 'Mauritania', MT: 'Malta',
  MU: 'Mauritius', MV: 'Maldives', MW: 'Malawi', MX: 'Mexico', MY: 'Malaysia',
  MZ: 'Mozambique', NA: 'Namibia', NE: 'Niger', NG: 'Nigeria', NI: 'Nicaragua',
  NL: 'Netherlands', NO: 'Norway', NP: 'Nepal', NZ: 'New Zealand', OM: 'Oman',
  PA: 'Panama', PE: 'Peru', PG: 'Papua New Guinea', PH: 'Philippines',
  PK: 'Pakistan', PL: 'Poland', PT: 'Portugal', PY: 'Paraguay', QA: 'Qatar',
  RO: 'Romania', RS: 'Serbia', RU: 'Russia', RW: 'Rwanda', SA: 'Saudi Arabia',
  SB: 'Solomon Islands', SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden',
  SG: 'Singapore', SI: 'Slovenia', SJ: 'Svalbard and Jan Mayen', SK: 'Slovakia',
  SL: 'Sierra Leone', SM: 'San Marino', SN: 'Senegal', SO: 'Somalia',
  SR: 'Suriname', SS: 'South Sudan', ST: 'Sao Tome and Principe',
  SV: 'El Salvador', SY: 'Syria', SZ: 'Eswatini', TD: 'Chad', TG: 'Togo',
  TH: 'Thailand', TJ: 'Tajikistan', TL: 'Timor-Leste', TM: 'Turkmenistan',
  TN: 'Tunisia', TR: 'Turkey', TT: 'Trinidad and Tobago', TW: 'Taiwan',
  TZ: 'Tanzania', UA: 'Ukraine', UG: 'Uganda', US: 'United States',
  UY: 'Uruguay', UZ: 'Uzbekistan', VA: 'Vatican City',
  VC: 'Saint Vincent and the Grenadines', VE: 'Venezuela', VN: 'Vietnam',
  VU: 'Vanuatu', WS: 'Samoa', YE: 'Yemen', ZA: 'South Africa', ZM: 'Zambia',
  ZW: 'Zimbabwe'
}

// Common name variants that are not the canonical ISO_NAME value, in their
// natural display casing (this is also the literal string a flat-column
// probe sends the API — see allCountries() below — so the casing here has to
// be a plausible match for what a specimen record actually spells).
const NAME_ALIASES_DISPLAY = {
  USA: 'US', 'U.S.A.': 'US', 'U.S.A': 'US', 'United States of America': 'US',
  'Great Britain': 'GB', England: 'GB', Scotland: 'GB', Wales: 'GB',
  'Northern Ireland': 'GB', 'U.K.': 'GB', UK: 'GB', Britain: 'GB',
  Czechia: 'CZ', 'Czech Rep.': 'CZ',
  Macedonia: 'MK', 'Republic of Macedonia': 'MK', 'FYR Macedonia': 'MK',
  'Bosnia-Herzegovina': 'BA', 'Bosnia Herzegovina': 'BA', Bosnia: 'BA',
  Holland: 'NL', 'The Netherlands': 'NL',
  'Russian Federation': 'RU', Russia: 'RU',
  'Republic of Ireland': 'IE',
  Vatican: 'VA', 'Vatican City State': 'VA', 'Holy See': 'VA',
  'Ivory Coast': 'CI',
  'South Korea': 'KR', 'Korea, South': 'KR', 'Republic of Korea': 'KR',
  'North Korea': 'KP', 'Korea, North': 'KP',
  Moldavia: 'MD', 'Republic of Moldova': 'MD',
  'Slovak Republic': 'SK',
  Turkiye: 'TR', Türkiye: 'TR',
  'Swiss Confederation': 'CH',
  Kirghizia: 'KG', Kirgizia: 'KG',
  'White Russia': 'BY', Byelorussia: 'BY'
}

// Lowercased lookup used by nameToIso() below — derived from the display
// table above so the two never drift apart.
const NAME_ALIASES = Object.fromEntries(
  Object.entries(NAME_ALIASES_DISPLAY).map(([display, iso]) => [norm(display), iso])
)

// Russian WGSRPD units east of the Urals (Siberia + Russian Far East). Each keeps
// its own key and stays out of the "Europe" grouping.
const ASIAN_RUSSIA = new Set([
  'altay', 'altai', 'amur', 'buryatiya', 'buryatia', 'chita', 'east siberia',
  'irkutsk', 'kamchatka', 'khabarovsk', 'krasnoyarsk',
  'kuril islands', 'kurile is.', 'kuril is.', 'magadan', 'primorye', 'sakhalin',
  'russian far east', 'tuva', 'west siberia', 'western siberia', 'yakutiya',
  'yakutia', 'sakha'
])

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
const SLUG_LABEL = { 'russia-european': 'European Russia' }
export function territoryLabel(key) {
  if (!key) return ''
  return (
    countryName(key) ||
    SLUG_LABEL[key] ||
    String(key).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

const EUROPEAN_RUSSIA = { key: 'russia-european', label: 'European Russia' }

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
