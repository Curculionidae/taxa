/**
 * typeNameOtu.js
 *
 * The OTU page of the name a type status names: "syntypes of Bothynoderes
 * meridionalis Chevrolat, 1873" -> the page of Asproparthenis meridionalis.
 *
 * TaxonWorks does not expose which name record a type belongs to (the type
 * material entry of a specimen has only its label text), so the name is
 * looked up by its epithet and matched on what TaxonWorks builds that label
 * from: the name's original combination and its author and year. Only a
 * single exact match counts; anything else returns null and the name stays
 * unlinked.
 *
 * Depended on by:
 *   - ./TypeStatusChip.vue (`linkNames`, used by ./DwcTable.vue only)
 */

import { splitScientificName } from './scientificName.js'
import { pickTaxonPageOtu } from './otuLink.js'
import { getAllPages } from './pagedGet.js'

/**
 * The name a type status names, or null for a bare status ("paratype"). Pure.
 * @param {string} status  one status, "<type> of <name> <author>"
 * @returns {{ name: string, author: string, epithet: string } | null}
 */
export function typeStatusName(status) {
  const str = String(status || '')
  const idx = str.lastIndexOf(' of ')
  if (idx === -1) return null
  const { italic, plain } = splitScientificName(str.slice(idx + 4))
  const epithet = italic.split(' ').filter((w) => /^[a-z][a-z-]+$/.test(w)).pop()
  if (!epithet) return null
  return { name: italic, author: plain, epithet }
}

const bare = (author) => String(author || '').replace(/[()]/g, '').trim()

const moduleCache = new Map() // status -> Promise<otuId | null>

/**
 * Cached per status for the page's lifetime. An answer is kept, also "no
 * match"; a failed request is not, so the next chip asks again.
 * @param {string} status  one status, "<type> of <name> <author>"
 * @param {{ get?: Function, cache?: Map }} [options]  injectable for unit
 *   tests; a `get` without a `cache` bypasses caching
 * @returns {Promise<number|null>}  never rejects
 */
export function findTypeNameOtuId(status, { get, cache = get ? null : moduleCache } = {}) {
  if (!cache) return lookUp(status, get).catch(() => null)
  if (!cache.has(status)) {
    cache.set(
      status,
      lookUp(status, get).catch(() => {
        cache.delete(status)
        return null
      })
    )
  }
  return cache.get(status)
}

// Rejects when a request fails, null when there is nothing to link.
async function lookUp(status, get) {
  const parsed = typeStatusName(status)
  if (!parsed) return null
  // dynamic, so node --test needn't resolve the `@/` alias
  const request = get || (await import('@/utils/request')).makeAPIRequest.get
  const names = await getAllPages(request, '/taxon_names', { name: parsed.epithet })
  const matches = names.filter(
    (n) =>
      n.cached_original_combination === parsed.name &&
      bare(n.cached_author_year) === bare(parsed.author)
  )
  if (matches.length !== 1) return null
  const { data: otus } = await request('/otus', {
    params: { 'taxon_name_id[]': matches[0].id }
  })
  const list = Array.isArray(otus) ? otus : []
  return (pickTaxonPageOtu(list) || list[0])?.id ?? null
}
