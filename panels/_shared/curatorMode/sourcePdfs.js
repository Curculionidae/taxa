import { makeAPIRequest } from '@/utils/request'

/**
 * Which sources have a document (PDF) attached in TaxonWorks, for the
 * curator-mode PDF icon. The API does not say which document, only whether
 * there is one (`/sources?documents=true`), so the icon opens the source's
 * TaxonWorks page, which lists them.
 *
 * Calls within the same tick go into one request; answers are cached.
 */

const known = new Map() // source id -> promise of boolean
let pending = new Map() // source id -> resolve

async function flush() {
  const batch = pending
  pending = new Map()

  const ids = [...batch.keys()]
  const withPdf = new Set()

  try {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const { data } = await makeAPIRequest.get('/sources', {
        params: { 'source_id[]': chunk, documents: true, per: chunk.length }
      })

      data.forEach((source) => withPdf.add(source.id))
    }
  } catch {
    ids.forEach((id) => known.delete(id)) // ask again next time
  }

  for (const [id, resolve] of batch) resolve(withPdf.has(id))
}

/** @returns {Promise<boolean>} */
export function hasPdf(sourceId) {
  const id = Number(sourceId)

  if (!id) return Promise.resolve(false)

  if (!known.has(id)) {
    if (!pending.size) setTimeout(flush, 0)
    known.set(id, new Promise((resolve) => pending.set(id, resolve)))
  }

  return known.get(id)
}
