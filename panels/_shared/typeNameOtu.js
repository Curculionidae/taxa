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

const cache = new Map() // status -> Promise<otuId | null>

/**
 * @param {string} status  one status, "<type> of <name> <author>"
 * @param {{ get?: Function }} [options]  `get` is injectable for unit tests (bypasses the cache)
 * @returns {Promise<number|null>}  never rejects
 */
export function findTypeNameOtuId(status, { get } = {}) {
  if (get) return lookUp(status, get)
  if (!cache.has(status)) {
    const pending = lookUp(status)
    cache.set(status, pending)
  }
  return cache.get(status)
}

async function lookUp(status, get) {
  const parsed = typeStatusName(status)
  if (!parsed) return null
  try {
    // dynamic, so node --test needn't resolve the `@/` alias
    const request = get || (await import('@/utils/request')).makeAPIRequest.get
    const { data: names } = await request('/taxon_names', {
      params: { name: parsed.epithet, per: 500 }
    })
    const matches = (Array.isArray(names) ? names : []).filter(
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
  } catch {
    return null
  }
}
