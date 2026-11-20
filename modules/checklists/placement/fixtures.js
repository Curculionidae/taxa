// Fixtures for the placement tests: small real shapes as TaxonWorks delivers
// them in `asserted_distribution_shape` (copied from the spike data, fields
// trimmed to those the code reads).
//
// Output: one plain object per area, named ga<id> or gz<id>. GA 78 ("French
// Guiana", the country-level area) has no fixture of its own: no distribution
// uses it, so TaxonWorks only ever shows it as the parent of GA 8837 (Cayenne).
// Note: no distribution in the spike data uses a second "Bosnia and Herzegovina"
// area, so the merge tests use the real pair "St. Kitts and Nevis" (GA 31745)
// and "Saint Kitts and Nevis" (GA 188), and "Viet Nam" / "Vietnam".

export const ga15 = {
  id: 15,
  name: 'Australia',
  level0_id: 15,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: 'AU',
  iso_3166_a3: null,
  tdwgID: null,
  data_origin: 'country_names_and_code_elements',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga188 = {
  id: 188,
  name: 'Saint Kitts and Nevis',
  level0_id: 188,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: 'KN',
  iso_3166_a3: null,
  tdwgID: null,
  data_origin: 'country_names_and_code_elements',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga19713 = {
  id: 19713,
  name: 'Russia',
  level0_id: 19713,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: null,
  iso_3166_a3: 'RUS',
  tdwgID: null,
  data_origin: 'ne_countries',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga236 = {
  id: 236,
  name: 'United Kingdom',
  level0_id: 236,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: 'GB',
  iso_3166_a3: null,
  tdwgID: null,
  data_origin: 'country_names_and_code_elements',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga243 = {
  id: 243,
  name: 'Viet Nam',
  level0_id: 243,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: 'VN',
  iso_3166_a3: null,
  tdwgID: null,
  data_origin: 'country_names_and_code_elements',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga31721 = {
  id: 31721,
  name: 'Bosnia and Herz.',
  level0_id: 31721,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: null,
  iso_3166_a3: 'BIH',
  tdwgID: null,
  data_origin: 'ne_countries',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga31745 = {
  id: 31745,
  name: 'St. Kitts and Nevis',
  level0_id: 31745,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: null,
  iso_3166_a3: 'KNA',
  tdwgID: null,
  data_origin: 'ne_countries',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga31774 = {
  id: 31774,
  name: 'Vietnam',
  level0_id: 31774,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: null,
  iso_3166_a3: 'VNM',
  tdwgID: null,
  data_origin: 'ne_countries',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga32253 = {
  id: 32253,
  name: 'French Guiana',
  level0_id: 77,
  level1_id: null,
  parent_id: 77,
  parent: {
    name: 'France'
  },
  iso_3166_a2: null,
  iso_3166_a3: null,
  tdwgID: null,
  data_origin: 'ne_states',
  geographic_area_type: {
    id: 2,
    name: 'Unknown'
  }
}

export const ga32254 = {
  id: 32254,
  name: 'Corse',
  level0_id: 77,
  level1_id: null,
  parent_id: 77,
  parent: {
    name: 'France'
  },
  iso_3166_a2: null,
  iso_3166_a3: null,
  tdwgID: null,
  data_origin: 'ne_states',
  geographic_area_type: {
    id: 2,
    name: 'Unknown'
  }
}

export const ga33639 = {
  id: 33639,
  name: 'Borneo',
  level0_id: null,
  level1_id: null,
  parent_id: 33574,
  parent: {
    name: 'Malesia'
  },
  iso_3166_a2: null,
  iso_3166_a3: null,
  tdwgID: '42BOR',
  data_origin: 'tdwg_l3',
  geographic_area_type: {
    id: 111,
    name: 'TDWG Level 3'
  }
}

export const ga33696 = {
  id: 33696,
  name: 'France',
  level0_id: null,
  level1_id: null,
  parent_id: 33550,
  parent: {
    name: 'Southwestern Europe'
  },
  iso_3166_a2: null,
  iso_3166_a3: null,
  tdwgID: '12FRA',
  data_origin: 'tdwg_l3',
  geographic_area_type: {
    id: 111,
    name: 'TDWG Level 3'
  }
}

export const ga33876 = {
  id: 33876,
  name: 'Central European Russia',
  level0_id: null,
  level1_id: null,
  parent_id: 33552,
  parent: {
    name: 'Eastern Europe'
  },
  iso_3166_a2: null,
  iso_3166_a3: null,
  tdwgID: '14RUC',
  data_origin: 'tdwg_l3',
  geographic_area_type: {
    id: 111,
    name: 'TDWG Level 3'
  }
}

export const ga34200 = {
  id: 34200,
  name: 'French Guiana',
  level0_id: null,
  level1_id: null,
  parent_id: 33722,
  parent: {
    name: 'French Guiana'
  },
  iso_3166_a2: null,
  iso_3166_a3: null,
  tdwgID: '82FRG-OO',
  data_origin: 'tdwg_l4',
  geographic_area_type: {
    id: 112,
    name: 'TDWG Level 4'
  }
}

export const ga34271 = {
  id: 34271,
  name: 'Northern Ireland',
  level0_id: null,
  level1_id: null,
  parent_id: 33745,
  parent: {
    name: 'Ireland'
  },
  iso_3166_a2: null,
  iso_3166_a3: null,
  tdwgID: '10IRE-NI',
  data_origin: 'tdwg_l4',
  geographic_area_type: {
    id: 112,
    name: 'TDWG Level 4'
  }
}

export const ga77 = {
  id: 77,
  name: 'France',
  level0_id: 77,
  level1_id: null,
  parent_id: 1,
  parent: {
    name: 'Earth'
  },
  iso_3166_a2: 'FR',
  iso_3166_a3: null,
  tdwgID: null,
  data_origin: 'country_names_and_code_elements',
  geographic_area_type: {
    id: 3,
    name: 'Country'
  }
}

export const ga8837 = {
  id: 8837,
  name: 'Cayenne',
  level0_id: null,
  level1_id: null,
  parent_id: 78,
  parent: {
    name: 'French Guiana'
  },
  iso_3166_a2: null,
  iso_3166_a3: null,
  tdwgID: null,
  data_origin: 'gadm',
  geographic_area_type: {
    id: 2,
    name: 'Unknown'
  }
}

export const gz10453 = {
  id: 10453,
  name: "Hawai'i: Kaua'i",
  iso_3166_a2: 'US',
  iso_3166_a3: 'USA'
}

export const gz3529 = {
  id: 3529,
  name: 'NZCC: Northland',
  iso_3166_a2: 'NZ',
  iso_3166_a3: 'NZL'
}

