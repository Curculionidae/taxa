// Named geography groupings for the dichotomous-key geography filter
// (modules/keys/). Each grouping expands to its full `members` list regardless
// of which of them the current key actually reaches, so the geographic
// completeness denominator is not silently narrowed. `members` are territory
// keys as modules/keys/lib/geoNormalize.js emits them: ISO 3166-1 alpha-2 codes
// plus the `russia-european` slug.
//
// v1 ships only "Europe". Add a grouping = add an entry. Editing which
// territories count as "Europe" = editing the array below.
//
// This file lives in the panel folder by project decision; the keys module
// imports it with a relative path.

export default [
  {
    id: 'europe',
    label: 'Europe',
    members: [
      'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FO',
      'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU',
      'MT', 'MD', 'MC', 'ME', 'MK', 'NL', 'NO', 'PL', 'PT', 'RO', 'SM', 'RS',
      'SK', 'SI', 'ES', 'SJ', 'SE', 'CH', 'TR', 'UA', 'GB', 'VA',
      'russia-european'
    ]
  }
]
