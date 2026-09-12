import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  featureTypeMaterialKind,
  featureIsAdventive,
  featureIsAbsent,
  enrichedPolygonStyleDelta,
  enrichedMarkerIconOptions,
  restyleEnriched,
  classifyOneTypeStatus,
  classifyTypeStatus,
  typeStatusLabels,
  ADVENTIVE_HATCH_CLASS
} from './enrichedStyle.js'

const co = (id) => ({ type: 'CollectionObject', id })
const ad = (id) => ({ type: 'AssertedDistribution', id })
// Matches the real merged base-entry shape: normalizeAbsentFeatures rewrites
// `type` to 'AssertedAbsent' - `is_absent` itself never survives onto a base
// entry (it's a top-level GeoJSON feature property), so it's deliberately
// absent here too.
const absentAd = (id) => ({ type: 'AssertedAbsent', id })
const feature = (base) => ({ properties: { base } })

const typeMap = (entries) => new Map(entries)

test('featureTypeMaterialKind: null when the type-status map is empty', () => {
  assert.equal(featureTypeMaterialKind(feature([co(1)]), new Map()), null)
})

test('featureTypeMaterialKind: primary when a CO base resolves to a name-bearing type', () => {
  const m = typeMap([[1, { kind: 'primary', statuses: ['Holotype'] }]])
  assert.equal(featureTypeMaterialKind(feature([co(1)]), m), 'primary')
})

test('featureTypeMaterialKind: other when the only match is non-name-bearing', () => {
  const m = typeMap([[1, { kind: 'other', statuses: ['Paratype'] }]])
  assert.equal(featureTypeMaterialKind(feature([co(1)]), m), 'other')
})

test('featureTypeMaterialKind: primary wins over other across several CO bases', () => {
  const m = typeMap([
    [1, { kind: 'other', statuses: ['Paratype'] }],
    [2, { kind: 'primary', statuses: ['Lectotype'] }]
  ])
  assert.equal(featureTypeMaterialKind(feature([co(1), co(2)]), m), 'primary')
})

test('featureTypeMaterialKind: ignores non-CollectionObject bases', () => {
  const m = typeMap([[9, { kind: 'primary', statuses: ['Holotype'] }]])
  assert.equal(featureTypeMaterialKind(feature([ad(9)]), m), null)
})

test('featureTypeMaterialKind: accepts base as a single object', () => {
  const m = typeMap([[1, { kind: 'other', statuses: ['Isotype'] }]])
  assert.equal(featureTypeMaterialKind(feature(co(1)), m), 'other')
})

test('featureIsAdventive: false when the id set is empty', () => {
  assert.equal(featureIsAdventive(feature([ad(1)]), new Set()), false)
})

test('featureIsAdventive: true when an AssertedDistribution base id is in the set', () => {
  assert.equal(featureIsAdventive(feature([ad(1), co(2)]), new Set([1])), true)
})

test('featureIsAdventive: false when the AD id is not in the set', () => {
  assert.equal(featureIsAdventive(feature([ad(3)]), new Set([1])), false)
})

test('featureIsAdventive: ignores non-AssertedDistribution bases', () => {
  assert.equal(featureIsAdventive(feature([co(1)]), new Set([1])), false)
})

test('featureIsAbsent: false when no base entry is type AssertedAbsent', () => {
  assert.equal(featureIsAbsent(feature([ad(1), co(2)])), false)
})

test('featureIsAbsent: true when any base entry is type AssertedAbsent, even mixed with a presence record', () => {
  assert.equal(featureIsAbsent(feature([ad(1), absentAd(2)])), true)
})

test('enrichedPolygonStyleDelta: primary type carries the type-material tokens', () => {
  assert.deepEqual(enrichedPolygonStyleDelta('primary', false), {
    color: 'var(--tp-map-type-material)',
    weight: 1,
    fillOpacity: 'var(--tp-map-shape-opacity)'
  })
})

test('enrichedPolygonStyleDelta: other type recolours to the project yellow token', () => {
  assert.deepEqual(enrichedPolygonStyleDelta('other', false), {
    color: 'var(--pp-map-other-type)',
    fillOpacity: 'var(--tp-map-shape-opacity)'
  })
})

test('enrichedPolygonStyleDelta: adventive (no type) is solid purple', () => {
  assert.deepEqual(enrichedPolygonStyleDelta(null, true), {
    color: 'var(--pp-map-adventive)',
    fillOpacity: 1
  })
})

test('enrichedPolygonStyleDelta: nothing to overlay returns null', () => {
  assert.equal(enrichedPolygonStyleDelta(null, false), null)
})

test('enrichedMarkerIconOptions: primary marker uses the blue type-material disc', () => {
  assert.deepEqual(enrichedMarkerIconOptions('primary'), {
    className: 'bg-map-type-material map-point-marker rounded-full',
    iconSize: [8, 8],
    iconAnchor: [4, 4]
  })
})

test('enrichedMarkerIconOptions: other marker uses the yellow disc class', () => {
  assert.deepEqual(enrichedMarkerIconOptions('other'), {
    className: 'pp-map-other-type-marker map-point-marker rounded-full',
    iconSize: [8, 8],
    iconAnchor: [4, 4]
  })
})

test('enrichedMarkerIconOptions: no kind keeps the package default marker', () => {
  assert.equal(enrichedMarkerIconOptions(null), null)
})

// --- type-status classification ------------------------------------------

test('typeStatusLabels: splits a " | "-joined DwC typeStatus cell', () => {
  assert.deepEqual(
    typeStatusLabels('holotype of Aus bus Leach, 1817 | paratype of Aus bus Leach, 1817'),
    ['holotype of Aus bus Leach, 1817', 'paratype of Aus bus Leach, 1817']
  )
  assert.deepEqual(typeStatusLabels(''), [])
  assert.deepEqual(typeStatusLabels(null), [])
})

test('classifyOneTypeStatus: name-bearing types are primary', () => {
  for (const t of ['holotype', 'lectotype', 'neotype', 'syntype', 'syntypes']) {
    assert.equal(classifyOneTypeStatus(`${t} of Aus bus`), 'primary', t)
  }
})

test('classifyOneTypeStatus: "paralectotype" is other, not lectotype', () => {
  assert.equal(classifyOneTypeStatus('paralectotype of Aus bus'), 'other')
  assert.equal(classifyOneTypeStatus('paraneotype of Aus bus'), 'other')
})

test('classifyOneTypeStatus: qualified types are other', () => {
  for (const t of ['paratype', 'isotype', 'topotype', 'allotype', 'isosyntype']) {
    assert.equal(classifyOneTypeStatus(`${t} of Aus bus`), 'other', t)
  }
})

test('classifyOneTypeStatus: the bare historical "type" is primary', () => {
  assert.equal(classifyOneTypeStatus('Type'), 'primary')
  assert.equal(classifyOneTypeStatus('the type of Aus bus'), 'primary')
})

test('classifyOneTypeStatus: a string with no "type" word, or blank, is null', () => {
  assert.equal(classifyOneTypeStatus('just a specimen'), null)
  assert.equal(classifyOneTypeStatus('   '), null)
  assert.equal(classifyOneTypeStatus(''), null)
})

test('classifyTypeStatus: primary wins across a compound cell', () => {
  assert.equal(
    classifyTypeStatus('Holotype, 2 paratypes of Aus bus'),
    'primary'
  )
  assert.equal(
    classifyTypeStatus('paratype of Aus bus | holotype of Cus dus'),
    'primary'
  )
})

test('classifyTypeStatus: other when nothing name-bearing is present', () => {
  assert.equal(classifyTypeStatus('paratype of Aus bus | isotype of Aus bus'), 'other')
})

test('classifyTypeStatus: null for an empty or non-type cell', () => {
  assert.equal(classifyTypeStatus(''), null)
  assert.equal(classifyTypeStatus('just a specimen'), null)
})

// --- restyleEnriched -------------------------------------------------------

function fakeL() {
  return { divIcon: (opts) => ({ _divIcon: true, opts }) }
}

function polygonLayer(base) {
  const calls = { setStyle: [], toggle: [] }
  return {
    calls,
    feature: feature(base),
    setStyle: (s) => calls.setStyle.push(s),
    _path: { classList: { toggle: (cls, on) => calls.toggle.push([cls, on]) } }
  }
}

function markerLayer(base) {
  const calls = { setIcon: [] }
  return {
    calls,
    feature: feature(base),
    setIcon: (i) => calls.setIcon.push(i)
  }
}

function groupOf(layers, { refreshClusters } = {}) {
  const g = { eachLayer: (cb) => layers.forEach(cb) }
  if (refreshClusters) g.refreshClusters = refreshClusters
  return g
}

test('restyleEnriched: no-op and returns 0 when there is no enrichment', () => {
  const layer = polygonLayer([co(1)])
  const n = restyleEnriched(groupOf([layer]), {
    L: fakeL(),
    adventiveAdIds: new Set(),
    typeStatusByCoId: new Map()
  })
  assert.equal(n, 0)
  assert.equal(layer.calls.setStyle.length, 0)
})

test('restyleEnriched: stamps typeMaterialKind on every visited leaf', () => {
  const primary = polygonLayer([co(1)])
  const plain = polygonLayer([co(2)])
  restyleEnriched(groupOf([primary, plain]), {
    L: fakeL(),
    adventiveAdIds: new Set(),
    typeStatusByCoId: typeMap([[1, { kind: 'primary', statuses: ['Holotype'] }]])
  })
  assert.equal(primary.feature.properties.typeMaterialKind, 'primary')
  assert.equal(plain.feature.properties.typeMaterialKind, undefined)
})

test('restyleEnriched: applies the style delta to an "other type" polygon', () => {
  const layer = polygonLayer([co(1)])
  const n = restyleEnriched(groupOf([layer]), {
    L: fakeL(),
    adventiveAdIds: new Set(),
    typeStatusByCoId: typeMap([[1, { kind: 'other', statuses: ['Paratype'] }]])
  })
  assert.equal(n, 1)
  assert.deepEqual(layer.calls.setStyle, [
    { color: 'var(--pp-map-other-type)', fillOpacity: 'var(--tp-map-shape-opacity)' }
  ])
})

test('restyleEnriched: swaps the icon on a primary-type marker', () => {
  const layer = markerLayer([co(1)])
  const L = fakeL()
  const n = restyleEnriched(groupOf([layer]), {
    L,
    adventiveAdIds: new Set(),
    typeStatusByCoId: typeMap([[1, { kind: 'primary', statuses: ['Holotype'] }]])
  })
  assert.equal(n, 1)
  assert.equal(layer.calls.setIcon.length, 1)
  assert.equal(
    layer.calls.setIcon[0].opts.className,
    'bg-map-type-material map-point-marker rounded-full'
  )
})

test('restyleEnriched: a marker with no type kind keeps its icon', () => {
  const layer = markerLayer([co(2)])
  restyleEnriched(groupOf([layer]), {
    L: fakeL(),
    adventiveAdIds: new Set(),
    typeStatusByCoId: typeMap([[1, { kind: 'primary', statuses: ['Holotype'] }]])
  })
  assert.equal(layer.calls.setIcon.length, 0)
})

test('restyleEnriched: toggles the hatch class on an adventive polygon', () => {
  const adv = polygonLayer([ad(10)])
  const other = polygonLayer([ad(11)])
  restyleEnriched(groupOf([adv, other]), {
    L: fakeL(),
    adventiveAdIds: new Set([10]),
    typeStatusByCoId: new Map()
  })
  assert.deepEqual(adv.calls.toggle, [[ADVENTIVE_HATCH_CLASS, true]])
  assert.deepEqual(other.calls.toggle, [[ADVENTIVE_HATCH_CLASS, false]])
})

test('restyleEnriched: an adventive tag never repaints a mixed presence/absent shape', () => {
  // Shape has both a presence record tagged "Adventive" (id 10) and a separate
  // absent record for the same area, merged by removeDuplicateShapes into one
  // feature - the corrective absent record must keep the package's Absent
  // style, not get repainted adventive-purple.
  const layer = polygonLayer([ad(10), absentAd(11)])
  const n = restyleEnriched(groupOf([layer]), {
    L: fakeL(),
    adventiveAdIds: new Set([10]),
    typeStatusByCoId: new Map()
  })
  assert.equal(n, 0)
  assert.equal(layer.calls.setStyle.length, 0)
  assert.equal(layer.calls.toggle.length, 0)
})

test('restyleEnriched: recurses through nested layer groups', () => {
  const leaf = polygonLayer([co(1)])
  const inner = groupOf([leaf]) // an L.GeoJSON-like sublayer: has eachLayer, no feature
  const outer = groupOf([inner])
  const n = restyleEnriched(outer, {
    L: fakeL(),
    adventiveAdIds: new Set(),
    typeStatusByCoId: typeMap([[1, { kind: 'other', statuses: ['Paratype'] }]])
  })
  assert.equal(n, 1)
  assert.equal(leaf.calls.setStyle.length, 1)
})

test('restyleEnriched: refreshes cluster pies once when the group supports it', () => {
  let refreshed = 0
  const layer = markerLayer([co(1)])
  restyleEnriched(
    groupOf([layer], { refreshClusters: () => (refreshed += 1) }),
    {
      L: fakeL(),
      adventiveAdIds: new Set(),
      typeStatusByCoId: typeMap([[1, { kind: 'primary', statuses: ['Holotype'] }]])
    }
  )
  assert.equal(refreshed, 1)
})
