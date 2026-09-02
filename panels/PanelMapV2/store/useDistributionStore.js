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

function normalizeAbsentFeatures(arr) {
  arr.forEach((feature) => {
    if (feature.properties.is_absent) {
      feature.properties.base.type = ASSERTED_ABSENT
    }
  })
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

// Tags on the AssertedDistribution records shown on the map, keyed by AD id.
// An "Adventive" tag also drives the hatched polygon rendering; the popup shows
// every tag verbatim.
async function fetchAdTags(adIds, signal) {
  const ids = [...new Set(adIds)].filter(Boolean)
  if (!ids.length) return new Map()
  try {
    const params = new URLSearchParams()
    params.set('tag_object_type', 'AssertedDistribution')
    ids.forEach((id) => params.append('tag_object_id[]', id))
    params.set('per', '500')
    const { data } = await makeAPIRequest.get(`/tags?${params}`, { signal })
    const byId = new Map()
    for (const t of Array.isArray(data) ? data : []) {
      const kw = t.keyword?.name
      if (!kw) continue
      if (!byId.has(t.tag_object_id)) byId.set(t.tag_object_id, [])
      byId.get(t.tag_object_id).push(kw)
    }
    return byId
  } catch {
    return new Map()
  }
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
      const isSpeciesGroup =
        rankString &&
        (isRankGroup('SpeciesGroup', rankString) ||
          isRankGroup('SpeciesAndInfraspeciesGroup', rankString))

      this.controller = new AbortController()

      if (isSpeciesGroup) {
        useOtuPageRequest('panel:map-v2', () =>
          makeAPIRequest.get(`/otus/${otuId}/inventory/distribution.geojson`, {
            signal: this.controller.signal
          })
        )
          .then(({ data }) => {
            if (data.request_too_large) {
              this.distribution.geojson = null
              this.distribution.errorMessage = data.message
            } else {
              normalizeAbsentFeatures(data.features)

              const { features, shapeTypes } = removeDuplicateShapes(
                sortFeaturesByType(data.features, Object.keys(LEGEND))
              )

              this.distribution.currentShapeTypes = shapeTypes
              this.distribution.geojson = {
                features
              }

              fetchAdTags(
                assertedDistributionIds(features),
                this.controller.signal
              ).then((byId) => {
                if (!byId.size) return
                this.tagsByAdId = byId
                const adventive = new Set()
                for (const [id, kws] of byId) {
                  if (kws.some((k) => k.toLowerCase() === 'adventive')) adventive.add(id)
                }
                this.adventiveAdIds = adventive
                if (
                  adventive.size &&
                  !this.distribution.currentShapeTypes.includes('Adventive')
                ) {
                  this.distribution.currentShapeTypes = [
                    ...this.distribution.currentShapeTypes,
                    'Adventive'
                  ]
                }
                // new object ref so VMap re-runs L.geoJSON with the hatch style
                this.distribution.geojson = {
                  features: [...this.distribution.geojson.features]
                }
              })
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
    }
  }
})
