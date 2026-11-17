const GENERIC_WORDS = new Set([
  'province', 'oblast', 'krai', 'kray', 'republic', 'of', 'autonomous', 'region', 'okrug',
  'state', 'municipality', 'city', 'district', 'territory', 'sheng', 'shi', 'the', 'and', 'county'
])

export function normalizePlace(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function coreName(value) {
  const core = normalizePlace(value).split(' ').filter((word) => word && !GENERIC_WORDS.has(word)).join(' ')
  return core
}

// Builds a lookup of place-name variants to subdivision names for one country.
export function buildSubdivisionIndex(features) {
  const exact = new Map()
  const core = new Map()
  const add = (map, key, name) => {
    if (key && !map.has(key)) map.set(key, name)
  }
  for (const feature of features) add(exact, normalizePlace(feature.properties.name), feature.properties.name)
  for (const feature of features) {
    for (const alias of feature.properties.aliases || []) add(exact, normalizePlace(alias), feature.properties.name)
  }
  for (const feature of features) add(core, coreName(feature.properties.name), feature.properties.name)
  for (const feature of features) {
    for (const alias of feature.properties.aliases || []) add(core, coreName(alias), feature.properties.name)
  }
  return { exact, core }
}

export function resolveSubdivision(index, ...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizePlace(candidate)
    if (!normalized) continue
    const hit = index.exact.get(normalized) || index.core.get(coreName(candidate))
    if (hit) return hit
  }
  return ''
}
