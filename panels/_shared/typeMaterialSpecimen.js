/**
 * typeMaterialSpecimen.js
 *
 * Finds the type specimens of an OTU's name and of every synonym of it, and
 * tells which TypeMaterial record each CollectionObject is the specimen of.
 *
 * Why this exists: a type specimen normally carries no taxon determination
 * (its type status already is the identification, and determining it under the
 * current name would only restate the synonymy). TaxonWorks ties a specimen to
 * an OTU through its determination, so such a specimen is absent from
 * `/otus/:id/inventory/dwc.json` and, as a CollectionObject, from
 * `/otus/:id/inventory/distribution.geojson`. What the geojson does carry:
 *
 *   - type of the OTU's own (valid) name: a `TypeMaterial` base entry whose
 *     `id` is the TypeMaterial id, not the specimen id
 *   - type of a synonym: nothing at all (checked on Asproparthenis crotchi,
 *     2026-10: five synonyms with types, one TypeMaterial entry, for the valid
 *     name; the synonym types are on the map only through their determinations)
 *
 * There is no public `/type_materials` route, so the specimens are found from
 * the name side:
 *
 *   GET /otus/:id                                           -> taxon_name_id
 *   GET /taxon_names?taxon_name_id[]=…&synonymify=true       -> the name + its synonyms
 *   GET /collection_objects?type_specimen_taxon_name_id=…    -> type specimens, one name per call
 *                                                              (the `[]` array form is ignored
 *                                                              and returns every type in the project)
 *   GET /collection_objects/:id?extend[]=type_material       -> type_material[].global_id / object_label
 *                                                              (this extend works on the show route only)
 *
 * `fetchTypeSpecimenRecord(id)` is the DwC record of one such specimen, cached so
 * the panels that show the same specimen ask for it once.
 *
 * Depended on by:
 *   - ../PanelMapV2/store/useDistributionStore.js — puts type specimens the
 *     geojson lacks onto the map
 *   - ../PanelMapV2/components/MapPopup.vue — makes a bare TypeMaterial popup
 *     row open the DwC modal for its specimen
 *   - ../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue —
 *     lists type specimens the DwC inventory lacks
 */

import { mapPool } from './concurrencyPool.js'

const CONCURRENCY = 4

/**
 * The TypeMaterial records a collection object (fetched with
 * `extend[]=type_material`) is the specimen of. Pure. Exported for unit testing.
 * @param {object} collectionObject
 * @returns {{ id: number, label: string }[]}  label is "<type> of <name>"
 */
export function typeMaterialsOf(collectionObject) {
  const list = collectionObject?.type_material
  const out = []
  for (const tm of Array.isArray(list) ? list : []) {
    const m = /\/TypeMaterial\/(\d+)$/.exec(String(tm?.global_id || ''))
    if (m) out.push({ id: Number(m[1]), label: tm.object_label || '' })
  }
  return out
}

/**
 * typeMaterialId -> collectionObjectId over a `fetchTypeSpecimens` result. Pure.
 * @param {Array<{ collectionObjectId: number, typeMaterials: { id: number }[] }>} specimens
 * @returns {Map<number, number>}
 */
export function specimenByTypeMaterialId(specimens) {
  const byId = new Map()
  for (const s of specimens || []) {
    for (const tm of s.typeMaterials) byId.set(tm.id, s.collectionObjectId)
  }
  return byId
}

const cache = new Map() // otuId -> Promise<specimen[]>

/**
 * Type specimens of the OTU's name and all its synonyms.
 * Never throws: whatever can't be resolved is simply missing from the list.
 * Cached per OTU for the page's lifetime (the panels share it), unless a request
 * failed along the way: an incomplete list is returned but asked for again next time.
 * @param {number|string} otuId
 * @param {{ get?: Function }} [options]  `get` is injectable for unit tests (bypasses the cache)
 * @returns {Promise<Array<{ collectionObjectId: number,
 *                           typeMaterials: { id: number, label: string }[] }>>}
 */
export function fetchTypeSpecimens(otuId, { get } = {}) {
  if (get) return loadTypeSpecimens(otuId, get).then((r) => r.specimens)
  const key = String(otuId)
  if (!cache.has(key)) {
    cache.set(
      key,
      loadTypeSpecimens(otuId).then(({ specimens, complete }) => {
        if (!complete) cache.delete(key)
        return specimens
      })
    )
  }
  return cache.get(key)
}

const recordCache = new Map() // collectionObjectId -> Promise<object>

/**
 * The DwC record of a collection object (`/collection_objects/:id/dwc`), cached.
 * Rejects when the request fails; a failure is not cached.
 * @param {number} collectionObjectId
 * @returns {Promise<object>}
 */
export function fetchTypeSpecimenRecord(collectionObjectId) {
  if (!recordCache.has(collectionObjectId)) {
    const promise = import('@/utils/request')
      .then(({ makeAPIRequest }) =>
        makeAPIRequest.get(`/collection_objects/${collectionObjectId}/dwc`)
      )
      .then(({ data }) => data)
    promise.catch(() => recordCache.delete(collectionObjectId))
    recordCache.set(collectionObjectId, promise)
  }
  return recordCache.get(collectionObjectId)
}

// Exported for unit testing: `complete` is false when any request failed.
export async function loadTypeSpecimens(otuId, get) {
  const specimens = []
  let complete = true
  try {
    // `@/utils/request` is imported dynamically so unit tests don't have to
    // resolve the `@/` build alias (node --test can't).
    const request = get || (await import('@/utils/request')).makeAPIRequest.get

    const { data: otu } = await request(`/otus/${otuId}`)
    if (!otu?.taxon_name_id) return { specimens, complete }

    const nameIds = new Set([otu.taxon_name_id])
    try {
      const { data: names } = await request(
        `/taxon_names?taxon_name_id[]=${otu.taxon_name_id}&synonymify=true&per=500`
      )
      for (const n of Array.isArray(names) ? names : []) nameIds.add(n.id)
    } catch {
      complete = false // the OTU's own name still gets looked up
    }

    const coIds = new Set()
    await mapPool([...nameIds], CONCURRENCY, async (nameId) => {
      try {
        const { data } = await request(
          `/collection_objects?type_specimen_taxon_name_id=${nameId}&per=500`
        )
        for (const co of Array.isArray(data) ? data : []) coIds.add(co.id)
      } catch {
        complete = false // this name's types stay unresolved
      }
    })

    await mapPool([...coIds], CONCURRENCY, async (id) => {
      try {
        const { data } = await request(`/collection_objects/${id}?extend[]=type_material`)
        const typeMaterials = typeMaterialsOf(data)
        if (typeMaterials.length) {
          specimens.push({ collectionObjectId: id, typeMaterials })
        }
      } catch {
        complete = false // this specimen stays unresolved
      }
    })
  } catch {
    complete = false
  }
  specimens.sort((a, b) => a.collectionObjectId - b.collectionObjectId)
  return { specimens, complete }
}
