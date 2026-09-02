// Pure helpers shared by the first geojson render (useGeojsonOptions) and the
// in-place restyle that runs once the async tag / type-status enrichment lands.
// Keeping the decision in one place stops the two paths from drifting.
//
// No Vue, no leaflet, no '@/' imports here on purpose: `node --test` covers it.

const asArray = (base) => (Array.isArray(base) ? base : base == null ? [] : [base])

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
