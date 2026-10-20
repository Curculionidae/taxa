/**
 * Taxon name ids for the descendants tree, needed only for the curator-mode
 * "Edit in TaxonWorks" links.
 *
 * `/otus/:id/inventory/taxonomy` gives each node an OTU id and its synonyms
 * as bare HTML ("<i>Rhinobatus</i> Germar, 1817"), no taxon name ids. So:
 * the OTUs give their `taxon_name_id`, and `/taxon_names?synonymify=true`
 * on those names returns the names plus their synonyms, which are matched
 * to the shown synonym text. The tree shows a synonym as its original
 * combination with author and year (without the parentheses), sometimes as
 * its current form, so these are tried. A text two names share links to neither.
 *
 * Requests are batched: every node that asks within the same tick goes into
 * one `/otus` and one `/taxon_names` request.
 */

import { htmlToPlainText } from '../../_shared/plainText.js'

const ID_CHUNK = 100

/** A shown name reduced to plain text, for matching. */
export const nameKey = htmlToPlainText

/**
 * Synonym ids by valid name id, then by name text. A text that two
 * synonyms of the same valid name share maps to null.
 *
 * @param {object[]} names `/taxon_names` records
 * @returns {Map<number, Map<string, number|null>>}
 */
export function indexSynonyms(names) {
  const index = new Map()

  for (const name of names) {
    const validId = name.cached_valid_taxon_name_id

    if (!validId || name.id === validId) continue
    if (!index.has(validId)) index.set(validId, new Map())

    const byText = index.get(validId)
    const authorYear = name.cached_author_year || ''
    // In its original combination a name's author stands without the
    // parentheses its current form has: "Curculio cynarae Herbst, 1795".
    const bareAuthorYear = authorYear.replace(/^\((.*)\)$/, '$1')
    const keys = new Set(
      [
        [name.cached_original_combination_html, bareAuthorYear],
        [name.cached_original_combination_html, authorYear],
        [name.cached_html, authorYear]
      ]
        .filter(([html]) => html)
        .map(([html, author]) => nameKey(`${html} ${author}`))
    )

    for (const key of keys) {
      byText.set(key, byText.has(key) && byText.get(key) !== name.id ? null : name.id)
    }
  }

  return index
}

function chunks(list) {
  return Array.from({ length: Math.ceil(list.length / ID_CHUNK) }, (_, i) =>
    list.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK)
  )
}

/**
 * @param {(url: string, params: object) => Promise<object[]>} fetchAll
 *   every record of a list endpoint
 * @returns {{ load(otuId): Promise<{ taxonNameId: number|null, synonymId(html: string): number|null }> }}
 */
export function createTaxonNameIdLoader(fetchAll) {
  const results = new Map() // otu id -> promise
  let pending = new Map() // otu id -> resolve/reject

  async function flush() {
    const batch = pending
    pending = new Map()

    try {
      const otuIds = [...batch.keys()]
      const otus = (
        await Promise.all(chunks(otuIds).map((ids) => fetchAll('/otus', { otu_id: ids })))
      ).flat()
      const nameIdByOtu = new Map(otus.map((otu) => [otu.id, otu.taxon_name_id]))
      const nameIds = [...new Set(otus.map((otu) => otu.taxon_name_id).filter(Boolean))]
      const names = (
        await Promise.all(
          chunks(nameIds).map((ids) =>
            fetchAll('/taxon_names', { taxon_name_id: ids, synonymify: true })
          )
        )
      ).flat()
      const synonyms = indexSynonyms(names)

      for (const [otuId, { resolve }] of batch) {
        const taxonNameId = nameIdByOtu.get(otuId) ?? null
        const byText = synonyms.get(taxonNameId) || new Map()

        resolve({
          taxonNameId,
          synonymId: (html) => byText.get(nameKey(html)) ?? null
        })
      }
    } catch (error) {
      for (const [otuId, { reject }] of batch) {
        results.delete(otuId) // let a later call try again
        reject(error)
      }
    }
  }

  function load(otuId) {
    const id = Number(otuId)

    if (!results.has(id)) {
      if (!pending.size) setTimeout(flush, 0)

      results.set(
        id,
        new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
      )
    }

    return results.get(id)
  }

  return { load }
}
