import { addPencil, hasPencil, isPencil } from '../../_shared/curatorMode/overlayPencils.js'

/**
 * Finds the taxon names and synonyms in the package's rendered descendants
 * tree and gives them pencils (see readme.md). The markup it relies on:
 *
 * - a tree node is an `<li>` with a direct child link to `/otus/<id>`
 * - its synonyms are `<ul class="synonyms"><li><span>=</span><span>name</span>`
 */

const OTU_LINK = /\/otus\/(\d+)(?:[/?#]|$)/

function findNodes(root) {
  const nodes = []

  for (const li of root.querySelectorAll('li')) {
    const link = [...li.children].find(
      (child) => child.tagName === 'A' && !isPencil(child) && OTU_LINK.test(child.getAttribute('href') || '')
    )

    if (!link) continue

    const synonyms = [...li.querySelectorAll(':scope > ul.synonyms > li')]
      .map((item) => item.querySelectorAll(':scope > span')[1])
      .filter((span) => span && !hasPencil(span))
      .map((span) => ({ span, html: span.innerHTML }))

    if (hasPencil(link) && !synonyms.length) continue

    nodes.push({
      otuId: Number(link.getAttribute('href').match(OTU_LINK)[1]),
      link,
      synonyms
    })
  }

  return nodes
}

/**
 * @param {Element} root
 * @param {{ load(otuId): Promise<{ taxonNameId, synonymId(html) }> }} loader
 * @param {(id: number) => string} editUrl taxon name id -> edit page
 * @param {WeakSet<Element>} busy links whose ids are being looked up
 */
export function decorateTree(root, loader, editUrl, busy) {
  for (const { otuId, link, synonyms } of findNodes(root)) {
    if (busy.has(link)) continue

    busy.add(link)
    loader
      .load(otuId)
      .then(({ taxonNameId, synonymId }) => {
        if (taxonNameId) addPencil(link, editUrl(taxonNameId))

        for (const { span, html } of synonyms) {
          const id = synonymId(html)

          if (id) addPencil(span, editUrl(id))
        }
      })
      .catch(() => {})
      .finally(() => busy.delete(link))
  }
}
