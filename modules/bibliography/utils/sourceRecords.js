/**
 * The ways a citation can lead to an OTU, as `/otus` filter facets. A source
 * is cited on a taxon name, on the OTU itself, on an asserted distribution,
 * etc. Each needs its own request, the API has no facet that unions them.
 *
 * Only list a facet here after checking it against the API: an unknown
 * parameter is ignored and returns every OTU in the project, and
 * `field_occurrence_query` does the same because it ignores `source_query`.
 *
 * A path with `load` instead of `param` fetches its OTUs itself. It returns
 * the OTUs plus, per OTU id, the ids of the cited objects that led to it.
 */
const OTU_PATHS = [
  { type: 'TaxonName', param: 'taxon_name_query[source_query][source_id][]' },
  { type: 'Otu', param: 'source_query[source_id][]' },
  { type: 'AssertedDistribution', load: getDistributionOtus },
  { type: 'BiologicalAssociation', load: getAssociationSubjects },
  { type: 'Content', param: 'content_query[source_query][source_id][]' },
  {
    type: 'CollectionObject',
    param: 'collection_object_query[source_query][source_id][]'
  },
  { type: 'Image', param: 'image_query[source_query][source_id][]' }
]

/**
 * Citation types that belong to a taxon name rather than to an OTU. Each
 * resolver turns the citations of its type into `{ nameId, citation }` pairs.
 * The citation is then shown on the rows of that name.
 */
const NAME_RESOLVERS = {
  TaxonName: (citations) =>
    citations.map((citation) => ({
      nameId: citation.citation_object_id,
      citation
    })),
  TaxonNameRelationship: resolveRelationships,
  TaxonNameClassification: resolveClassifications,
  TypeMaterial: resolveTypeMaterial
}

// Order of the pills on a row.
const TYPE_ORDER = [
  'TaxonName',
  'TaxonNameRelationship',
  'TaxonNameClassification',
  'TypeMaterial',
  ...OTU_PATHS.map(({ type }) => type).filter((type) => type !== 'TaxonName')
]

const TAXONOMY_TYPES = [
  'TaxonName',
  'Otu',
  'TaxonNameRelationship',
  'TaxonNameClassification',
  'TypeMaterial',
  'Lead'
]

const BIOLOGY_TYPES = ['BiologicalAssociation']

export function getCitationColor(type) {
  if (TAXONOMY_TYPES.includes(type)) return 'blue'
  if (BIOLOGY_TYPES.includes(type)) return 'green'

  return 'yellow'
}

// Citation topics are project vocabulary, matched by name. A topic not
// listed here is grey.
const TOPIC_COLORS = {
  biology: 'green'
}

export function getTopicColor(topic) {
  return TOPIC_COLORS[topic.name.trim().toLowerCase()] || 'gray'
}

const PER = 1000
const ID_CHUNK = 100
const CONCURRENCY = 8

// Requests that only exist one record at a time are capped, so a source with
// thousands of citations cannot fire thousands of requests. What is left
// over stays in the "unlinked" count.
const MAX_SINGLE_REQUESTS = 150

// Every page of a list endpoint, the pages after the first in parallel.
export async function getAll(request, url, params) {
  const getPage = (page) =>
    request.get(url, { params: { ...params, per: PER, page, paginate: true } })

  const first = await getPage(1)
  const total = Number(first.headers['pagination-total']) || 0
  const rest = await Promise.all(
    Array.from({ length: Math.max(Math.ceil(total / PER) - 1, 0) }, (_, i) =>
      getPage(i + 2)
    )
  )

  return [first, ...rest].flatMap(({ data }) => data)
}

async function getByIds(request, url, param, ids) {
  const chunks = Array.from(
    { length: Math.ceil(ids.length / ID_CHUNK) },
    (_, i) => ids.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK)
  )
  const lists = await Promise.all(
    chunks.map((chunk) => getAll(request, url, { [param]: chunk }))
  )

  return lists.flat()
}

// Runs `task` over `items` a few at a time. Stops early once `isDone()`.
async function inBatches(items, task, isDone = () => false) {
  for (let i = 0; i < items.length && !isDone(); i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(task))
  }
}

function groupBy(list, getKey) {
  const groups = new Map()

  for (const item of list) {
    const key = getKey(item)

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  return groups
}

function unique(list) {
  return [...new Set(list)]
}

function plainText(html = '') {
  return html.replace(/<[^>]+>/g, '')
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// The `/otus` facet for biological associations returns both sides, so a
// host plant would be listed for a paper about the weevil feeding on it.
// The association belongs to its subject: read the associations and keep
// `subject_otu_id`, which is also set when the subject is a specimen or an
// anatomical part of one.
async function getAssociationSubjects(sourceId, request) {
  const associations = await getAll(request, '/biological_associations/basic', {
    'source_query[source_id][]': sourceId
  })
  const objectIds = new Map()

  for (const { id, subject_otu_id: otuId } of associations) {
    if (!otuId) continue
    if (!objectIds.has(otuId)) objectIds.set(otuId, new Set())
    objectIds.get(otuId).add(id)
  }

  return {
    otus: await getByIds(request, '/otus', 'otu_id', [...objectIds.keys()]),
    objectIds
  }
}

// A distribution is asserted for an OTU or for a biological association
// ("Aus bus on Planta una, in Brandenburg"). The `/otus` facet only finds the
// first kind. The second kind is listed with the subject of its association.
// Reading the distributions themselves also tells which one belongs to which
// OTU, so their pages can be shown.
async function getDistributionOtus(sourceId, request) {
  const [otus, distributions] = await Promise.all([
    getAll(request, '/otus', {
      'asserted_distribution_query[source_query][source_id][]': sourceId
    }),
    getAll(request, '/asserted_distributions', { source_id: sourceId })
  ])
  const byType = groupBy(
    distributions,
    (d) => d.asserted_distribution_object_type
  )
  const associations = await getByIds(
    request,
    '/biological_associations/basic',
    'biological_association_id',
    unique(
      (byType.get('BiologicalAssociation') || []).map(
        (d) => d.asserted_distribution_object_id
      )
    )
  )
  const subjects = new Map(associations.map((a) => [a.id, a.subject_otu_id]))
  const objectIds = new Map()

  for (const distribution of distributions) {
    const { asserted_distribution_object_id: objectId } = distribution
    const otuId =
      distribution.asserted_distribution_object_type === 'Otu'
        ? objectId
        : subjects.get(objectId)

    if (!otuId) continue
    if (!objectIds.has(otuId)) objectIds.set(otuId, new Set())
    objectIds.get(otuId).add(distribution.id)
  }

  const found = new Set(otus.map((otu) => otu.id))
  const missing = [...new Set(subjects.values())].filter(
    (id) => id && !found.has(id)
  )

  return {
    otus: otus.concat(await getByIds(request, '/otus', 'otu_id', missing)),
    objectIds
  }
}

async function getPathOtus({ param, load }, sourceId, request) {
  if (load) return load(sourceId, request)

  return {
    otus: await getAll(request, '/otus', { [param]: sourceId }),
    objectIds: new Map()
  }
}

// Pages and topics can only be matched to an OTU when we know which cited
// object led to it: the OTU itself, its taxon name, or the ids a path's
// `load` reports. For the other paths the API only says which OTUs are
// involved.
function getOwnCitations(otu, type, citations, objectIds) {
  const ids = new Set(objectIds.get(otu.id))

  if (type === 'Otu') ids.add(otu.id)
  if (type === 'TaxonName' && otu.taxon_name_id) ids.add(otu.taxon_name_id)

  return citations.filter((c) => ids.has(c.citation_object_id))
}

// A relationship is listed with its subject: the name the statement is
// about ("Aus bus is a synonym of Cus dus" is listed with Aus bus).
async function resolveRelationships(citations, { request }) {
  const relationships = await getByIds(
    request,
    '/taxon_name_relationships',
    'taxon_name_relationship_id',
    unique(citations.map((c) => c.citation_object_id))
  )
  const nameIds = new Map(
    relationships.map((r) => [r.id, r.subject_taxon_name_id])
  )

  return citations
    .filter((c) => nameIds.has(c.citation_object_id))
    .map((citation) => ({
      nameId: nameIds.get(citation.citation_object_id),
      citation
    }))
}

// The list endpoint ignores an id filter, so classifications are read one
// at a time.
async function resolveClassifications(citations, { request }) {
  const nameIds = new Map()
  const ids = unique(citations.map((c) => c.citation_object_id))

  await inBatches(ids.slice(0, MAX_SINGLE_REQUESTS), (id) =>
    request
      .get(`/taxon_name_classifications/${id}`, { params: {} })
      .then(({ data }) => nameIds.set(id, data.taxon_name_id))
      .catch(() => {})
  )

  return citations
    .filter((c) => nameIds.has(c.citation_object_id))
    .map((citation) => ({
      nameId: nameIds.get(citation.citation_object_id),
      citation
    }))
}

// The API has no type material endpoint. The only route from a type
// material record to its name is backwards: ask for the type specimens of a
// name, one name per request, and read the type material ids off them. The
// candidates are the names this source already cites, those cited on the
// same pages first, since type material is nearly always cited where the
// name is described.
async function resolveTypeMaterial(citations, { request, nameIds }) {
  const wanted = new Map(citations.map((c) => [c.citation_object_id, null]))
  const pages = new Set(citations.map((c) => c.pages).filter(Boolean))
  const candidates = [...nameIds.entries()]
    .sort(([, a], [, b]) => pages.has(b) - pages.has(a))
    .map(([nameId]) => nameId)
    .slice(0, MAX_SINGLE_REQUESTS)

  await inBatches(
    candidates,
    (nameId) =>
      request
        .get('/collection_objects', {
          params: {
            type_specimen_taxon_name_id: nameId,
            'extend[]': 'type_material',
            per: ID_CHUNK
          }
        })
        .then(({ data }) =>
          data
            .flatMap((specimen) => specimen.type_material || [])
            .map(({ global_id: gid }) => Number(gid.split('/').pop()))
            .filter((id) => wanted.has(id))
            .forEach((id) => wanted.set(id, nameId))
        )
        .catch(() => {}),
    () => [...wanted.values()].every(Boolean)
  )

  return citations
    .filter((c) => wanted.get(c.citation_object_id))
    .map((citation) => ({
      nameId: wanted.get(citation.citation_object_id),
      citation
    }))
}

// Rows for names that no row covers yet: the OTUs of the name, or, for a
// name without an OTU, a row for the name itself, linked to the OTU of its
// valid name when there is one.
async function getRowsForNames(nameIds, request) {
  const otus = await getByIds(request, '/otus', 'taxon_name_id', nameIds)
  const withOtu = new Set(otus.map((otu) => otu.taxon_name_id))
  const names = await getByIds(
    request,
    '/taxon_names',
    'taxon_name_id',
    nameIds.filter((id) => !withOtu.has(id))
  )
  const validOtus = await getByIds(
    request,
    '/otus',
    'taxon_name_id',
    unique(names.map((name) => name.cached_valid_taxon_name_id))
  )
  const otuIdByName = new Map(
    validOtus.map((otu) => [otu.taxon_name_id, otu.id]).reverse()
  )

  return [
    ...otus.map((otu) => makeRow({ ...otu, otuId: otu.id })),
    ...names.map((name) =>
      makeRow({
        id: `name:${name.id}`,
        otuId: otuIdByName.get(name.cached_valid_taxon_name_id) ?? null,
        taxon_name_id: name.id,
        object_tag: [name.cached_html, escapeHtml(name.cached_author_year)]
          .filter(Boolean)
          .join(' ')
      })
    )
  ]
}

function makeRow(record) {
  return { ...record, parts: new Map() }
}

function addPart(row, type, citations) {
  if (!row.parts.has(type)) row.parts.set(type, new Set())
  citations.forEach((citation) => row.parts.get(type).add(citation))
}

function makeCitedOn(type, citations) {
  const pages = unique(citations.map((c) => c.pages || null))

  return (pages.length ? pages : [null]).map((page) => ({ type, pages: page }))
}

function finishRow({ parts, ...row }) {
  const types = TYPE_ORDER.filter((type) => parts.has(type))
  const topics = new Map()

  types
    .flatMap((type) => [...parts.get(type)])
    .flatMap((citation) => citation.citation_topics || [])
    .forEach(({ topic }) => topics.set(topic.id, topic))

  return {
    ...row,
    citedOn: types.flatMap((type) => makeCitedOn(type, [...parts.get(type)])),
    topics: [...topics.values()]
  }
}

/**
 * One row per taxon a source is cited for, each with what the citations sit
 * on (name, distribution, type material, ...), their pages and topics, plus
 * a count of the citations that could not be tied to a taxon.
 *
 * A row's `otuId` is null for a cited name with no OTU to link to.
 *
 * @param {number} sourceId
 * @param {object} request axios instance for the TaxonWorks API
 * @returns {Promise<{ otus: object[], unlinked: { type: string, count: number }[] }>}
 */
export async function getSourceRecords(sourceId, request) {
  const citations = await getAll(request, '/citations', {
    source_id: sourceId,
    'extend[]': 'citation_topics'
  })
  const citationsByType = groupBy(citations, (c) => c.citation_object_type)
  const paths = OTU_PATHS.filter(({ type }) => citationsByType.has(type))
  const results = await Promise.all(
    paths.map((path) => getPathOtus(path, sourceId, request))
  )

  const rows = new Map()
  const linkedTypes = new Set()
  const linkedCitations = new Set()

  paths.forEach(({ type }, index) => {
    const { otus, objectIds } = results[index]

    for (const otu of otus) {
      const own = getOwnCitations(
        otu,
        type,
        citationsByType.get(type),
        objectIds
      )

      if (!rows.has(otu.id)) rows.set(otu.id, makeRow({ ...otu, otuId: otu.id }))

      addPart(rows.get(otu.id), type, own)
      linkedTypes.add(type)
    }
  })

  // Names known so far, with the pages they are cited on. Type material is
  // looked up among these.
  const nameIds = new Map()

  for (const row of rows.values()) {
    if (row.taxon_name_id) nameIds.set(row.taxon_name_id, null)
  }

  const bound = []

  for (const type of Object.keys(NAME_RESOLVERS)) {
    if (!citationsByType.has(type)) continue

    const resolved = await NAME_RESOLVERS[type](citationsByType.get(type), {
      request,
      nameIds
    })

    for (const { nameId, citation } of resolved) {
      bound.push({ nameId, type, citation })
      if (!nameIds.get(nameId)) nameIds.set(nameId, citation.pages)
    }
  }

  const covered = new Set([...rows.values()].map((row) => row.taxon_name_id))
  const missing = unique(bound.map(({ nameId }) => nameId)).filter(
    (id) => !covered.has(id)
  )

  for (const row of await getRowsForNames(missing, request)) {
    if (!rows.has(row.id)) rows.set(row.id, row)
  }

  const rowsByName = groupBy([...rows.values()], (row) => row.taxon_name_id)

  for (const { nameId, type, citation } of bound) {
    for (const row of rowsByName.get(nameId) || []) {
      addPart(row, type, [citation])
      linkedCitations.add(citation)
    }
  }

  return {
    otus: [...rows.values()]
      .map(finishRow)
      .sort((a, b) =>
        plainText(a.object_tag).localeCompare(plainText(b.object_tag))
      ),
    unlinked: [...citationsByType]
      .filter(([type]) => !linkedTypes.has(type))
      .map(([type, list]) => ({
        type,
        count: list.filter((c) => !linkedCitations.has(c)).length
      }))
      .filter(({ count }) => count)
  }
}
