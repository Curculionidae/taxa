// Pure helpers shared by the first geojson render (useGeojsonOptions) and the
// in-place restyle that runs once the async tag / type-status enrichment lands.
// Keeping the decision in one place stops the two paths from drifting.
//
// No Vue, no leaflet, no '@/' imports here on purpose: `node --test` covers it.

import {
  typeStatusLabels,
  classifyOneTypeStatus,
  classifyTypeStatus
} from '../../_shared/typeStatus.js'

// A feature's `base` / `target`: an array once removeDuplicateShapes has run,
// a single object straight from the API.
export const asArray = (base) => (Array.isArray(base) ? base : base == null ? [] : [base])

// Type-status classification lives in panels/_shared/typeStatus.js (the
// specimen list and the DwC modal colour their type chip with it too);
// re-exported so this module's callers and tests keep one import.
export { typeStatusLabels, classifyOneTypeStatus, classifyTypeStatus }

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

// True when the feature (a point) carries a CollectionObject / FieldOccurrence
// tagged "Adventive". `adventiveSpecimenKeys` holds "<type>:<id>" keys (see
// _shared/specimenRef.js specimenKey); CO and FO ids are separate sequences.
// A point shared by several specimens is adventive when any of them is.
export function featureHasAdventiveSpecimen(feature, adventiveSpecimenKeys) {
  if (!adventiveSpecimenKeys || !adventiveSpecimenKeys.size) return false
  return asArray(feature?.properties?.base).some(
    (b) =>
      (b?.type === 'CollectionObject' || b?.type === 'FieldOccurrence') &&
      adventiveSpecimenKeys.has(`${b.type}:${b.id}`)
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

// L.divIcon options for a type-material or adventive point marker, or null to
// keep the package default marker. Type material wins over adventive, as on
// polygons: the type colour is the rarer, more important fact.
export function enrichedMarkerIconOptions(kind, adventive = false) {
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
  if (adventive) {
    return {
      className: 'pp-map-adventive-marker map-point-marker rounded-full',
      iconSize: [8, 8],
      iconAnchor: [4, 4]
    }
  }
  return null
}

// Marker z-order: primary types on top, then other types, then adventive.
export function enrichedMarkerZIndex(kind, adventive = false) {
  if (kind === 'primary') return 6000
  if (kind === 'other') return 3000
  return adventive ? 2000 : 0
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
export function restyleEnriched(group, { L, adventiveAdIds, adventiveSpecimenKeys, typeStatusByCoId }) {
  const hasTags = adventiveAdIds && adventiveAdIds.size
  const hasSpecimenTags = adventiveSpecimenKeys && adventiveSpecimenKeys.size
  const hasTypes = typeStatusByCoId && typeStatusByCoId.size
  if (!group || (!hasTags && !hasSpecimenTags && !hasTypes)) return 0

  let changed = 0

  walkLeaves(group, (layer) => {
    const feature = layer.feature
    if (!feature || !feature.properties) return

    const kind = featureTypeMaterialKind(feature, typeStatusByCoId)
    const adventive = !kind && featureIsAdventive(feature, adventiveAdIds)
    feature.properties.typeMaterialKind = kind || undefined

    if (typeof layer.setIcon === 'function') {
      const adventiveSpecimen = !kind && featureHasAdventiveSpecimen(feature, adventiveSpecimenKeys)
      // read by the cluster pie (clusters/Mixed.js)
      feature.properties.adventive = adventiveSpecimen || undefined
      const opts = enrichedMarkerIconOptions(kind, adventiveSpecimen)
      if (opts) {
        layer.setIcon(L.divIcon(opts))
        layer.setZIndexOffset?.(enrichedMarkerZIndex(kind, adventiveSpecimen))
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
