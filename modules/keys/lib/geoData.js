// The single home for every hard-coded geographic set the dichotomous-key
// geography filter relies on: the country list, the alternate-spelling map, the
// Asian-Russia WGSRPD units, slug labels, and the named region presets. Pure
// data, no Vue, no network. Consumers (geoNormalize.js functions, geoProbe.js,
// KeyView's picker) import from here; nothing else may define country names,
// codes, aliases, or groupings. See docs/superpowers/specs/2026-09-07-key-geography-lazy-per-country-design.md section 7a.

// ISO 3166-1 alpha-2 -> canonical English short name. Not exhaustive of every
// dependent territory, but every sovereign state plus the ones the weevil
// distribution data turns up.
export const ISO_NAME = {
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
// probe sends the API, so the casing here has to
// be a plausible match for what a specimen record actually spells).
export const NAME_ALIASES_DISPLAY = {
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

// Russian WGSRPD units east of the Urals (Siberia + Russian Far East). Each keeps
// its own key and stays out of the "Europe" grouping.
export const ASIAN_RUSSIA = new Set([
  'altay', 'altai', 'amur', 'buryatiya', 'buryatia', 'chita', 'east siberia',
  'irkutsk', 'kamchatka', 'khabarovsk', 'krasnoyarsk',
  'kuril islands', 'kurile is.', 'kuril is.', 'magadan', 'primorye', 'sakhalin',
  'russian far east', 'tuva', 'west siberia', 'western siberia', 'yakutiya',
  'yakutia', 'sakha'
])

export const SLUG_LABEL = { 'russia-european': 'European Russia' }

export const EUROPEAN_RUSSIA = { key: 'russia-european', label: 'European Russia' }

// Named region groupings. Each expands to its FULL member list regardless of
// which members the current key reaches, so the geographic-completeness
// denominator is never silently narrowed. `members` are territory keys as
// geoNormalize.js emits them (ISO 3166-1 alpha-2 plus the `russia-european` slug).
// Add a grouping = add an entry. Edit what counts as "Europe" = edit the array.
export const GEOGRAPHY_PRESETS = [
  {
    id: 'europe',
    label: 'Europe',
    members: [
      'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE',
      'FO', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT',
      'LU', 'MT', 'MD', 'MC', 'ME', 'MK', 'NL', 'NO', 'PL', 'PT', 'RO', 'SM',
      'RS', 'SK', 'SI', 'ES', 'SJ', 'SE', 'CH', 'TR', 'UA', 'GB', 'VA',
      'russia-european'
    ]
  }
]
