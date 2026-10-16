import TaxonWorks from '@/modules/otus/services/TaxonWorks'
import { makeAPIRequest } from '@/utils'
import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest'
import { RESPONSE_ERROR } from '@/modules/otus/constants'
import {
  isRankGroup,
  removeDuplicateShapes,
  makeGeoJSONFeature,
  specimensNotOnMap,
  specimenGeometry,
  buildTypeSpecimenFeatures
} from '../utils'
import { ASSERTED_ABSENT } from '@/constants/objectTypes'
import { LEGEND } from '../constants'
import {
  classifyTypeStatus,
  classifyOneTypeStatus,
  typeStatusLabels
} from '../composables/enrichedStyle.js'
import { fetchAssertedDistributionTags } from '../../_shared/assertedDistributionTags.js'
import { adventiveIds, fetchAdventiveSpecimenKeys } from '../../_shared/adventive.js'
import {
  fetchTypeSpecimens,
  fetchTypeSpecimenRecord
} from '../../_shared/typeMaterialSpecimen.js'
import { mapPool } from '../../_shared/concurrencyPool.js'

function normalizeAbsentFeatures(arr) {
  arr.forEach((feature) => {
    if (feature.properties.is_absent) {
      feature.properties.base.type = ASSERTED_ABSENT
    }
  })
}

// distribution.geojson never carries is_absent:true records - TaxonWorks only
// exposes those through this separate endpoint (same split the vanilla map
// uses). Merged into the main feature list before normalizeAbsentFeatures /
// removeDuplicateShapes, so a shape asserted both present and absent (e.g. an
// old record later corrected as a misidentification) becomes one feature with
// both citations, styled as absent - see enrichedStyle.js / geojsonOptions.js.
async function fetchAbsentFeatures(otuId, signal) {
  try {
    const { data } = await makeAPIRequest.get(
      `/otus/${otuId}/inventory/distribution_is_absent.geojson`,
      { signal }
    )
    return Array.isArray(data?.features) ? data.features : []
  } catch {
    return []
  }
}

function sortFeaturesByType(arr, reference) {
  const referenceMap = new Map()

  reference.forEach((item, index) => {
    referenceMap.set(item, index)
  })

  return arr.toSorted((a, b) => {
    const indexA = referenceMap.has(a.properties.base.type)
      ? referenceMap.get(a.properties.base.type)
      : Infinity
    const indexB = referenceMap.has(b.properties.base.type)
      ? referenceMap.get(b.properties.base.type)
      : Infinity
    return indexA - indexB
  })
}

function assertedDistributionIds(features) {
  const out = []
  for (const f of features || []) {
    const base = f?.properties?.base
    for (const b of Array.isArray(base) ? base : [base]) {
      if (b?.type === 'AssertedDistribution' && b.id != null) out.push(b.id)
    }
  }
  return out
}

// { type, id } of every CollectionObject / FieldOccurrence point on the map
function specimenRefs(features) {
  const out = []
  for (const f of features || []) {
    const base = f?.properties?.base
    for (const b of Array.isArray(base) ? base : [base]) {
      if ((b?.type === 'CollectionObject' || b?.type === 'FieldOccurrence') && b.id != null) {
        out.push({ type: b.type, id: b.id })
      }
    }
  }
  return out
}

// Map<collectionObjectId, { kind: 'primary'|'other', statuses: string[] }> from
// the OTU's DwC inventory. `statuses` holds the individual "<type> of <name>"
// labels (a specimen can be a type of more than one name); `kind` is 'primary'
// if any of them is name-bearing. Classification lives in enrichedStyle.js so
// the marker/polygon styling and the popup can't drift apart.
//
// The whole inventory is fetched (not a per-CO lookup): "other type material"
// (paratypes, ...) is absent from distribution.geojson, which only carries
// primary types of valid names, so there is no on-map id list to filter by, and
// /otus/:id/inventory/dwc.json takes no CO-id filter. PanelSpecimenOccurrences
// and PanelBiologicalAssociationsV2 fetch the same endpoint; a shared cross-panel
// cache would be the real fix and is left for later.
async function fetchTypeStatusByCoId(otuId, signal) {
  try {
    const { data } = await makeAPIRequest.get(
      `/otus/${otuId}/inventory/dwc.json`,
      { signal }
    )
    const rows = Array.isArray(data) ? data : []
    const byId = new Map()
    for (const r of rows) {
      if (r?.dwc_occurrence_object_type !== 'CollectionObject') continue
      const kind = classifyTypeStatus(r.typeStatus)
      if (!kind) continue
      const id = r.dwc_occurrence_object_id
      const cur = byId.get(id) || { kind: 'other', statuses: [] }
      for (const label of typeStatusLabels(r.typeStatus)) {
        if (!cur.statuses.includes(label)) cur.statuses.push(label)
      }
      if (kind === 'primary') cur.kind = 'primary'
      byId.set(id, cur)
    }
    return byId
  } catch {
    return new Map()
  }
}

// Where to draw each type specimen the geojson lacks: `{ collectionObjectId,
// geometry }`, geometry null when its DwC record has no georeference (or could
// not be fetched) - such a specimen is not drawn. Stops asking for further
// records once the page's request was aborted (the user left the page).
async function fetchTypeSpecimenPlacements(specimens, signal) {
  const placements = []
  await mapPool(specimens, 4, async ({ collectionObjectId }) => {
    let geometry = null
    try {
      geometry = specimenGeometry(await fetchTypeSpecimenRecord(collectionObjectId))
    } catch {
      // not drawn
    }
    placements.push({ collectionObjectId, geometry })
  }, () => Boolean(signal?.aborted))
  return placements.sort((x, y) => x.collectionObjectId - y.collectionObjectId)
}

export const useDistributionStore = defineStore('distributionStoreMapV2', {
  state: () => {
    return {
      distribution: {
        geojson: null,
        errorMessage: null,
        currentShapeTypes: [],
        cachedMap: null
      },
      tagsByAdId: new Map(),
      adventiveAdIds: new Set(),
      // "<type>:<id>" of specimens (CO / FO) tagged "Adventive": purple markers
      adventiveSpecimenKeys: new Set(),
      // Map<collectionObjectId, 'primary' | 'other'> for type-material styling
      typeStatusByCoId: new Map(),
      // features for type specimens the geojson lacks (see addMissingTypeSpecimens)
      typeSpecimenFeatures: [],
      controller: null
    }
  },
  actions: {
    resetRequest() {
      this.controller?.abort()
    },

    loadCachedMap(mapId) {
      TaxonWorks.getCachedMap(mapId, { signal: this.controller.signal })
        .then((response) => {
          this.distribution.cachedMap = response.data
        })
        .catch(() => {})
    },

    async getAggregateShape(otuId) {
      useOtuPageRequest('panel:map-v2', () =>
        TaxonWorks.getOtuDistribution(otuId, {
          signal: this.controller.signal
        })
      )
        .then(({ data }) => {
          const geojson = JSON.parse(data.cached_map.geo_json)

          this.distribution.currentShapeTypes = ['Aggregate']
          this.distribution.geojson = {
            features: [makeGeoJSONFeature(geojson, 'Aggregate')]
          }

          this.loadCachedMap(data.cached_map.id)
        })
        .catch((e) => {
          if (e.name != RESPONSE_ERROR.CanceledError) {
            this.distribution.errorMessage = e.response.data.error
            this.distribution.currentShapeTypes = []
            this.distribution.geojson = []
          }
        })
    },

    async loadDistribution({ otuId, rankString }) {
      this.tagsByAdId = new Map()
      this.adventiveAdIds = new Set()
      this.adventiveSpecimenKeys = new Set()
      this.typeStatusByCoId = new Map()
      this.typeSpecimenFeatures = []
      const isSpeciesGroup =
        rankString &&
        (isRankGroup('SpeciesGroup', rankString) ||
          isRankGroup('SpeciesAndInfraspeciesGroup', rankString))

      this.controller = new AbortController()

      if (isSpeciesGroup) {
        const absentFeaturesPromise = fetchAbsentFeatures(otuId, this.controller.signal)

        useOtuPageRequest('panel:map-v2', () =>
          makeAPIRequest.get(`/otus/${otuId}/inventory/distribution.geojson`, {
            signal: this.controller.signal
          })
        )
          .then(async ({ data }) => {
            if (data.request_too_large) {
              this.distribution.geojson = null
              this.distribution.errorMessage = data.message
            } else {
              const allFeatures = [...data.features, ...(await absentFeaturesPromise)]
              normalizeAbsentFeatures(allFeatures)

              const { features, shapeTypes } = removeDuplicateShapes(
                sortFeaturesByType(allFeatures, Object.keys(LEGEND))
              )

              this.distribution.currentShapeTypes = shapeTypes
              this.distribution.geojson = {
                features
              }

              this.enrichFeatures(features, otuId, this.controller.signal)
            }
          })
          .catch((e) => {
            if (e.name !== RESPONSE_ERROR.CanceledError) {
              this.getAggregateShape(otuId)
            }
          })
      } else {
        this.getAggregateShape(otuId)
      }
    },

    // Second-pass metadata that the geojson does not carry: AssertedDistribution
    // tags (Adventive -> hatched), specimen tags (Adventive -> purple marker)
    // and CollectionObject type status (primary vs other type material -> colour). This only updates store state and the
    // legend; PanelMapV2 restyles the already-drawn layers in place from
    // `adventiveAdIds` / `typeStatusByCoId` (no geojson re-emit, so VMap does not
    // tear the layer group down and rebuild it).
    async enrichFeatures(features, otuId, signal) {
      const [tagsByAd, adventiveSpecimens, typeByCo] = await Promise.all([
        fetchAssertedDistributionTags(assertedDistributionIds(features), { signal }),
        fetchAdventiveSpecimenKeys(specimenRefs(features), { signal }),
        fetchTypeStatusByCoId(otuId, signal)
      ])
      if (signal?.aborted) return

      if (tagsByAd.size) {
        this.tagsByAdId = tagsByAd
        const adventive = adventiveIds(tagsByAd)
        this.adventiveAdIds = adventive
        if (adventive.size) this.addShapeTypes(['Adventive'])
      }

      if (adventiveSpecimens.size) {
        this.adventiveSpecimenKeys = adventiveSpecimens
        this.addShapeTypes(['AdventiveSpecimen'])
      }

      this.setTypeStatus(typeByCo)

      // slower, and independent of the styling above - so it runs after it
      await this.addMissingTypeSpecimens(features, otuId, typeByCo, signal)
    },

    setTypeStatus(typeByCo) {
      if (!typeByCo.size) return
      this.typeStatusByCoId = typeByCo
      const kinds = new Set([...typeByCo.values()].map((v) => v.kind))
      this.addShapeTypes([
        ...(kinds.has('primary') ? ['TypeMaterial'] : []),
        ...(kinds.has('other') ? ['OtherTypeMaterial'] : [])
      ])
    },

    addShapeTypes(types) {
      if (!types.length) return
      this.distribution.currentShapeTypes = [
        ...new Set([...this.distribution.currentShapeTypes, ...types])
      ]
    },

    // Type specimens the geojson lacks (a type usually has no taxon
    // determination, so TaxonWorks does not list it under the OTU; a synonym's
    // type is then missing from the map altogether - see typeMaterialSpecimen.js).
    // They go into `typeSpecimenFeatures`, which PanelMapV2 adds to the layer
    // group it already has. Deliberately NOT merged into `distribution.geojson`:
    // VMap deep-watches that and would clear every layer and refit the view,
    // seconds after the user started using the map.
    async addMissingTypeSpecimens(features, otuId, typeByCo, signal) {
      const missing = specimensNotOnMap(features, await fetchTypeSpecimens(otuId))
      if (signal?.aborted || !missing.length) return

      const placements = await fetchTypeSpecimenPlacements(missing, signal)
      if (signal?.aborted) return

      const added = buildTypeSpecimenFeatures(placements, {
        id: Number(otuId),
        type: 'Otu',
        label: ''
      })

      const drawn = new Set(placements.filter((p) => p.geometry).map((p) => p.collectionObjectId))
      if (import.meta.env.DEV && drawn.size < missing.length) {
        console.debug(
          '[PanelMapV2] type specimens without a georeference (not drawn):',
          missing.map((s) => s.collectionObjectId).filter((id) => !drawn.has(id))
        )
      }
      if (!added.length) return

      const withAdded = new Map(typeByCo)
      for (const s of missing) {
        if (!drawn.has(s.collectionObjectId)) continue
        const statuses = s.typeMaterials.map((tm) => tm.label)
        withAdded.set(s.collectionObjectId, {
          kind: statuses.some((l) => classifyOneTypeStatus(l) === 'primary') ? 'primary' : 'other',
          statuses
        })
      }

      // type status first, so the new layers come out coloured as types
      this.setTypeStatus(withAdded)
      this.typeSpecimenFeatures = markRaw(added)
    }
  }
})
