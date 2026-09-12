import TaxonWorks from '@/modules/otus/services/TaxonWorks'
import { makeAPIRequest } from '@/utils'
import { defineStore } from 'pinia'
import { useOtuPageRequest } from '@/modules/otus/helpers/useOtuPageRequest'
import { RESPONSE_ERROR } from '@/modules/otus/constants'
import {
  isRankGroup,
  removeDuplicateShapes,
  makeGeoJSONFeature
} from '../utils'
import { ASSERTED_ABSENT } from '@/constants/objectTypes'
import { LEGEND } from '../constants'
import {
  classifyTypeStatus,
  typeStatusLabels
} from '../composables/enrichedStyle.js'
import { fetchAssertedDistributionTags } from '../../_shared/assertedDistributionTags.js'

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
      // Map<collectionObjectId, 'primary' | 'other'> for type-material styling
      typeStatusByCoId: new Map(),
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
      this.typeStatusByCoId = new Map()
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
    // tags (Adventive -> hatched) and CollectionObject type status (primary vs
    // other type material -> colour). This only updates store state and the
    // legend; PanelMapV2 restyles the already-drawn layers in place from
    // `adventiveAdIds` / `typeStatusByCoId` (no geojson re-emit, so VMap does not
    // tear the layer group down and rebuild it).
    async enrichFeatures(features, otuId, signal) {
      const [tagsByAd, typeByCo] = await Promise.all([
        fetchAssertedDistributionTags(assertedDistributionIds(features), { signal }),
        fetchTypeStatusByCoId(otuId, signal)
      ])
      if (signal?.aborted) return

      const extraTypes = []

      if (tagsByAd.size) {
        this.tagsByAdId = tagsByAd
        const adventive = new Set()
        for (const [id, kws] of tagsByAd) {
          if (kws.some((k) => k.toLowerCase() === 'adventive')) adventive.add(id)
        }
        this.adventiveAdIds = adventive
        if (adventive.size) extraTypes.push('Adventive')
      }

      if (typeByCo.size) {
        this.typeStatusByCoId = typeByCo
        const kinds = new Set([...typeByCo.values()].map((v) => v.kind))
        if (kinds.has('primary')) extraTypes.push('TypeMaterial')
        if (kinds.has('other')) extraTypes.push('OtherTypeMaterial')
      }

      if (!extraTypes.length) return

      this.distribution.currentShapeTypes = [
        ...new Set([...this.distribution.currentShapeTypes, ...extraTypes])
      ]
    }
  }
})
