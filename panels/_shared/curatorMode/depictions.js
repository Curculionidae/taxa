import { makeAPIRequest } from '@/utils/request'

/**
 * The depictions of a TaxonWorks image, with their ids, for the image
 * viewer's "edit depiction" links. The images the galleries load carry their
 * depictions without ids, so this asks `/depictions?image_id[]=` (curator mode
 * only, once per image).
 */

const cache = new Map() // image id -> promise of depictions

/**
 * @param {number} imageId
 * @returns {Promise<{ id: number, objectType: string, objectId: number }[]>}
 */
export function loadImageDepictions(imageId) {
  if (!cache.has(imageId)) {
    cache.set(
      imageId,
      makeAPIRequest
        .get('/depictions', { params: { 'image_id[]': imageId } })
        .then(({ data }) =>
          data
            .filter((depiction) => depiction.image_id === undefined || depiction.image_id === imageId)
            .map((depiction) => ({
              id: depiction.id,
              objectType: depiction.depiction_object_type,
              objectId: depiction.depiction_object_id
            }))
        )
        .catch(() => {
          cache.delete(imageId) // try again next time
          return []
        })
    )
  }

  return cache.get(imageId)
}
