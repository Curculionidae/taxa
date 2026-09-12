// Pure helpers shared by the first geojson render (useGeojsonOptions) and the
// in-place restyle that runs once the async tag / type-status enrichment lands.
// Keeping the decision in one place stops the two paths from drifting.
//
// No Vue, no leaflet, no '@/' imports here on purpose: `node --test` covers it.

const asArray = (base) => (Array.isArray(base) ? base : base == null ? [] : [base])

// A DwC `typeStatus` cell is a " | "-joined list of "<type_type> of <name>"
// labels (TaxonWorks builds it as `type_materials.map { label_for_type_material }
// .join(' | ')`). Split it back into the individual labels.
export function typeStatusLabels(cell) {
  return String(cell || '')
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Classify one "<type_type> of <name>" label:
//   'primary' — a name-bearing type (holotype, lectotype, neotype, syntype, or
//               the bare historical "type")
//   'other'   — any other qualified type (paratype, isotype, topotype, ...)
//   null      — the string names no type at all
// The name-bearing forms are anchored with \b so "paralectotype" does not read
// as "lectotype" (no word boundary between "para" and "lecto").
export function classifyOneTypeStatus(label) {
  const s = String(label || '').toLowerCase().trim()
  if (!/type/.test(s)) return null
  if (/\b(?:holo|lecto|neo|syn)-?types?\b/.test(s)) return 'primary'
  if (/^(?:the\s+)?types?\b/.test(s)) return 'primary'
  return 'other'
}

// Classify a whole DwC `typeStatus` cell. 'primary' wins over 'other'; null when
// the cell names no type (or is empty).
export function classifyTypeStatus(cell) {
  const labels = typeStatusLabels(cell)
  if (!labels.length) return null
  let kind = null
  for (const label of labels) {
    const k = classifyOneTypeStatus(label)
    if (k === 'primary') return 'primary'
    if (k === 'other') kind = 'other'
  }
  return kind
}

// 'primary' | 'other' | null — the strongest type-material status among a
// feature's CollectionObject bases, from the store's DwC-derived
// Map<coId, { kind, statuses }>.
export function featureTypeMaterialKind(feature, typeStatusByCoId) {
  if (!typeStatusByCoId || !typeStatusByCoId.size) return null
  let kind = null
  for (const b of asArray(feature?.properties?.base)) {
    if (b?.type !== 'CollectionObject') continue
    const k = typeStatusByCoId.get(b.id)?.kind
    if (k === 'primary') return 'primary'
    if (k === 'other') kind = 'other'
  }
  return kind
}

// True when the feature carries an AssertedDistribution tagged "Adventive".
export function featureIsAdventive(feature, adventiveAdIds) {
  if (!adventiveAdIds || !adventiveAdIds.size) return false
  return asArray(feature?.properties?.base).some(
    (b) => b?.type === 'AssertedDistribution' && adventiveAdIds.has(b.id)
  )
}

// True when any base entry of the feature is an asserted-absent record. A
// shape can carry both a presence and an absent record for the same area
// (e.g. an old report later corrected as a misidentification) - once merged
// by removeDuplicateShapes they share one feature, and the presence entry may
// itself be tagged "Adventive". Absence must win the polygon style regardless:
// it is the more specific, corrective claim, and letting an adventive tag on
// the disputed presence record repaint it back to "adventive purple" would
// hide the correction entirely.
//
// `is_absent` itself lives only on the GeoJSON feature's top-level
// `properties` (a sibling of `base`, confirmed against the live API) - it is
// never copied onto an individual base entry. normalizeAbsentFeatures (in
// useDistributionStore.js) reads that top-level flag and rewrites the base
// entry's `type` to 'AssertedAbsent' instead, which is what survives into the
// merged array and what this must check.
export function featureIsAbsent(feature) {
  return asArray(feature?.properties?.base).some((b) => b?.type === 'AssertedAbsent')
}

export const ADVENTIVE_HATCH_CLASS = 'leaflet-adventive-hatch'

// Style properties the enrichment overlays on a polygon's base style, or null to
// leave it untouched. The primary-type branch mirrors `Map/shapes` TypeMaterial.
export function enrichedPolygonStyleDelta(kind, adventive) {
  if (kind === 'primary') {
    return {
      color: 'var(--tp-map-type-material)',
      weight: 1,
      fillOpacity: 'var(--tp-map-shape-opacity)'
    }
  }
  if (kind === 'other') {
    return {
      color: 'var(--pp-map-other-type)',
      fillOpacity: 'var(--tp-map-shape-opacity)'
    }
  }
  if (adventive) {
    return { color: 'var(--pp-map-adventive)', fillOpacity: 1 }
  }
  return null
}

// L.divIcon options for a type-material point marker, or null to keep the
// package default marker.
export function enrichedMarkerIconOptions(kind) {
  if (kind === 'primary') {
    return {
      className: 'bg-map-type-material map-point-marker rounded-full',
      iconSize: [8, 8],
      iconAnchor: [4, 4]
    }
  }
  if (kind === 'other') {
    return {
      className: 'pp-map-other-type-marker map-point-marker rounded-full',
      iconSize: [8, 8],
      iconAnchor: [4, 4]
    }
  }
  return null
}

function walkLeaves(layer, visit) {
  if (layer && typeof layer.eachLayer === 'function' && !layer.feature) {
    layer.eachLayer((child) => walkLeaves(child, visit))
  } else if (layer) {
    visit(layer)
  }
}

// Bring an already-rendered geojson layer group up to date with enrichment that
// arrived after the first render, without VMap tearing the group down and
// rebuilding it. Returns the number of layers whose style/icon changed.
export function restyleEnriched(group, { L, adventiveAdIds, typeStatusByCoId }) {
  const hasTags = adventiveAdIds && adventiveAdIds.size
  const hasTypes = typeStatusByCoId && typeStatusByCoId.size
  if (!group || (!hasTags && !hasTypes)) return 0

  let changed = 0

  walkLeaves(group, (layer) => {
    const feature = layer.feature
    if (!feature || !feature.properties) return

    const kind = featureTypeMaterialKind(feature, typeStatusByCoId)
    const adventive = !kind && featureIsAdventive(feature, adventiveAdIds)
    feature.properties.typeMaterialKind = kind || undefined

    if (typeof layer.setIcon === 'function') {
      const opts = enrichedMarkerIconOptions(kind)
      if (opts) {
        layer.setIcon(L.divIcon(opts))
        changed += 1
      }
      return
    }

    if (typeof layer.setStyle === 'function') {
      // Absence wins outright (see featureIsAbsent) - leave the package's
      // Absent style alone rather than repaint it adventive-purple.
      if (featureIsAbsent(feature)) return

      const delta = enrichedPolygonStyleDelta(kind, adventive)
      if (delta) {
        layer.setStyle(delta)
        changed += 1
      }
      const path = layer._path
      if (path && path.classList) {
        path.classList.toggle(ADVENTIVE_HATCH_CLASS, adventive)
      }
    }
  })

  group.refreshClusters?.()
  return changed
}
