/**
 * Content (topic texts) of an OTU page, including what was written on the
 * OTUs of the taxon's synonyms. See readme.md.
 */

import { escHtml } from '../_shared/scientificName.js'

const OTU_TAG_WRAPPER = /^<span class="otu_tag">([\s\S]*)<\/span>$/

// TaxonWorks adds "<em>now</em> <valid name>" to the tag of a synonym's OTU.
const NOW_SEPARATOR = /\s*<em>\s*now\s*<\/em>/

// The name of an OTU as HTML. An OTU with a name of its own ("Carex sp.",
// filed on Carex L.) goes by that name: its tag holds both names run together.
// Otherwise the taxon name from its `object_tag`, without the valid name.
export function otuNameHtml(otu) {
  if (otu?.name) return escHtml(otu.name)

  const tag = String(otu?.object_tag || '').trim()
  const inner = tag.match(OTU_TAG_WRAPPER)?.[1] ?? tag

  return inner.split(NOW_SEPARATOR)[0].trim()
}

// [{ name, text, otuNameHtml?, citations? }] to
// [{ title, entries: [{ text, otuNameHtml, citations }] }], topics in the
// order they first appear.
export function groupByTopic(contents) {
  const topics = new Map()

  for (const { name, text, otuNameHtml = '', citations = [] } of contents) {
    if (!topics.has(name)) topics.set(name, [])
    topics.get(name).push({ text, otuNameHtml, citations })
  }

  return [...topics].map(([title, entries]) => ({ title, entries }))
}

function inventoryContent(api, otuId, signal) {
  return api.get(`/otus/${otuId}/inventory/content`, {
    params: { extend: ['depiction'] },
    signal
  })
}

// The other OTUs of the same taxon that have content: the OTUs of its
// synonyms and other OTUs on its own taxon name ("Carex sp." on Carex L.).
async function otherOtusWithContent(api, otuId, signal) {
  const { data: coordinate } = await api.get('/otus', {
    params: { otu_id: [otuId], coordinatify: true, per: 500 },
    signal
  })
  const others = coordinate.filter((otu) => otu.id !== otuId)

  // Without an OTU filter `/contents` answers with the whole project.
  if (!others.length) return []

  const { data: records } = await api.get('/contents', {
    params: { otu_id: others.map((otu) => otu.id), per: 1000 },
    signal
  })
  const withContent = new Set(records.map((record) => record.otu_id))

  return others.filter((otu) => withContent.has(otu.id))
}

// The citations on the content records themselves, added to each as
// `citations`. A failed lookup leaves the texts without citations.
async function withCitations(api, contents, signal) {
  const ids = contents.map((item) => item.content_id).filter(Boolean)

  if (!ids.length) return contents

  const rows = await api
    .get('/citations', {
      params: {
        citation_object_type: 'Content',
        citation_object_id: ids,
        extend: ['source'],
        per: 500
      },
      signal
    })
    .then(({ data }) => data)
    .catch(() => [])

  return contents.map((item) => ({
    ...item,
    citations: rows.filter((row) => row.citation_object_id === item.content_id)
  }))
}

/**
 * The page OTU's own content first, then that of the taxon's other OTUs, each
 * entry of those carrying `otuNameHtml`. Every entry carries the `citations`
 * of its content record. `ownRequest` is the request for the
 * page OTU's content, made by the caller so it can be registered.
 */
export async function loadContents(api, { otuId, isValid, ownRequest, signal }) {
  const [own, others] = await Promise.all([
    ownRequest.then(({ data }) => data),
    // A synonym's page shows only what was written on the synonym.
    isValid ? otherOtusWithContent(api, otuId, signal).catch(() => []) : []
  ])

  const foreign = await Promise.all(
    others.map((otu) =>
      inventoryContent(api, otu.id, signal)
        .then(({ data }) =>
          data.map((item) => ({ ...item, otuNameHtml: otuNameHtml(otu) }))
        )
        .catch(() => [])
    )
  )

  return withCitations(api, [...own, ...foreign.flat()], signal)
}

export { inventoryContent }
