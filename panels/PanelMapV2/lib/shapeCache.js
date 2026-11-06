// Area shapes for the map, from the files scripts/build-map-shapes.mjs puts in
// public/map-shapes/ (served with the site), so TaxonWorks does not have to
// serialise them on every visit. A shape not there yet (an area a newer
// distribution started using) is fetched live. Kept in memory for the visit:
// the next species page reuses the shapes the last one loaded.

import { makeAPIRequest } from '@/utils'

const BASE = `${import.meta.env.BASE_URL}map-shapes/`

const shapes = new Map() // "<type>/<id>" -> Promise<geometry|null>
let withoutShape = null // Promise<Set<"<type>/<id>">>

// JSON or null. The dev server answers a missing file with the app's HTML
// page, so the type is checked, not only the status.
async function fetchJson(url) {
  const response = await fetch(url)
  const type = response.headers.get('content-type') || ''

  return response.ok && type.includes('json') ? response.json() : null
}

function areasWithoutShape() {
  withoutShape ??= fetchJson(`${BASE}without-shape.json`)
    .then((list) => new Set(list || []))
    .catch(() => new Set())

  return withoutShape
}

// One distribution with this shape, its geometry included.
async function fetchLive(type, id) {
  const { data } = await makeAPIRequest.get('/asserted_distributions', {
    params: {
      'geo_shape_id[]': id,
      'geo_shape_type[]': type,
      per: 1,
      'extend[]': 'geo_json'
    }
  })

  if (!data[0]) throw new Error(`No distribution with ${type} ${id}`)

  return data[0].asserted_distribution_shape?.geo_json?.geometry ?? null
}

/**
 * The geometry of a GeographicArea / Gazetteer; null when TaxonWorks has no
 * shape for that area. Rejects when it could not be loaded.
 * @param {string} type
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export function loadShape(type, id) {
  const key = `${type}/${id}`

  if (!shapes.has(key)) {
    const promise = areasWithoutShape().then(async (without) => {
      if (without.has(key)) return null

      return (await fetchJson(`${BASE}${key}.json`).catch(() => null)) ?? fetchLive(type, id)
    })

    promise.catch(() => shapes.delete(key))
    shapes.set(key, promise)
  }

  return shapes.get(key)
}
