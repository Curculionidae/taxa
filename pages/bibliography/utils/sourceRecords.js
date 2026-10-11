import { escHtml } from '../../../panels/_shared/scientificName.js'
import { getRelationshipKind, getStatusKind } from './citationLabels.js'

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
 * resolver turns the citations of its type into `{ nameId, citation }` pairs,
 * with a `kind` where the type alone says too little (which relationship,
 * which status). The citation is then shown on the rows of that name.
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
//
// `byObject` is the citations of the type, grouped by the id they cite.
function getOwnCitations(otu, type, byObject, objectIds) {
  const ids = new Set(objectIds.get(otu.id))

  if (type === 'Otu') ids.add(otu.id)
  if (type === 'TaxonName' && otu.taxon_name_id) ids.add(otu.taxon_name_id)

  return [...ids].flatMap((id) => byObject.get(id) || [])
}

// Whether a path can tell which citation led to which OTU.
function isTraceable(type, objectIds) {
  return type === 'Otu' || type === 'TaxonName' || objectIds.size > 0
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
  const byId = new Map(relationships.map((r) => [r.id, r]))

  return citations
    .filter((c) => byId.has(c.citation_object_id))
    .map((citation) => ({
      nameId: byId.get(citation.citation_object_id).subject_taxon_name_id,
      kind: getRelationshipKind(byId.get(citation.citation_object_id).type),
      citation
    }))
}

// The list endpoint ignores an id filter, so classifications are read one
// at a time.
async function resolveClassifications(citations, { request }) {
  const byId = new Map()
  const ids = unique(citations.map((c) => c.citation_object_id))

  await inBatches(ids.slice(0, MAX_SINGLE_REQUESTS), (id) =>
    request
      .get(`/taxon_name_classifications/${id}`, { params: {} })
      .then(({ data }) => byId.set(id, data))
      .catch(() => {})
  )

  return citations
    .filter((c) => byId.has(c.citation_object_id))
    .map((citation) => ({
      nameId: byId.get(citation.citation_object_id).taxon_name_id,
      kind: getStatusKind(byId.get(citation.citation_object_id).type),
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
        isCombination: name.type === 'Combination',
        object_tag: [name.cached_html, escHtml(name.cached_author_year)]
          .filter(Boolean)
          .join(' ')
      })
    )
  ]
}

function makeRow(record) {
  return { ...record, parts: new Map() }
}

// A part is a citation on one kind of record, with the `kind` its resolver
// found, if any.
function addPart(row, type, citations, kind) {
  if (!row.parts.has(type)) row.parts.set(type, new Map())
  citations.forEach((citation) => row.parts.get(type).set(citation, kind))
}

// What the origin citation of a name amounts to. Flagged on a name it is the
// original description, on a misspelling ("[sic]") the source of that
// misspelling, on a combination the first use of the combination.
function getNameKind(citation, row) {
  if (!citation.is_original) return undefined
  if (row.isCombination) return 'combination'
  if (plainText(row.object_tag).includes('[sic]')) return 'misspelling'

  return 'original'
}

const NAME_KIND_ORDER = ['original', 'combination', 'misspelling', undefined]

// One pill per kind and page, carrying the topics tagged on its citations.
function makeCitedOn(type, part, row) {
  // Some paths only say that an OTU is involved, not through which citation.
  if (!part.size) return [{ type, pages: null }]

  const pills = new Map()

  for (const [citation, partKind] of part) {
    const kind = type === 'TaxonName' ? getNameKind(citation, row) : partKind
    const pages = citation.pages || null
    const key = `${kind}:${pages}`

    if (!pills.has(key)) pills.set(key, { kind, pages, topics: new Map() })

    for (const { topic } of citation.citation_topics || []) {
      pills.get(key).topics.set(topic.id, topic)
    }
  }

  // A citation without pages says nothing that a pill of the same kind with
  // pages does not say already, unless it has topics of its own.
  const hasPages = new Set(
    [...pills.values()].filter((pill) => pill.pages).map((pill) => pill.kind)
  )

  return [...pills.values()]
    .filter(
      (pill) => pill.pages || pill.topics.size || !hasPages.has(pill.kind)
    )
    .sort(
      (a, b) =>
        NAME_KIND_ORDER.indexOf(a.kind) - NAME_KIND_ORDER.indexOf(b.kind)
    )
    .map(({ kind, pages, topics }) => ({
      type,
      pages,
      ...(kind ? { kind } : {}),
      ...(topics.size ? { topics: [...topics.values()] } : {})
    }))
}

function finishRow({ parts, isCombination, ...row }) {
  const types = TYPE_ORDER.filter((type) => parts.has(type))

  return {
    ...row,
    citedOn: types.flatMap((type) =>
      makeCitedOn(type, parts.get(type), { ...row, isCombination })
    )
  }
}

/**
 * One row per taxon a source is cited for, each with what the citations sit
 * on (name, distribution, type material, ...), with pages and topics, plus
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
  const linkedCitations = new Set()

  // Types whose path only says which OTUs are involved. Once it finds any,
  // all citations of the type count as shown, there is no telling them apart.
  const untraceable = new Set()

  paths.forEach(({ type }, index) => {
    const { otus, objectIds } = results[index]
    const byObject = groupBy(
      citationsByType.get(type),
      (c) => c.citation_object_id
    )

    if (otus.length && !isTraceable(type, objectIds)) untraceable.add(type)

    for (const otu of otus) {
      const own = getOwnCitations(otu, type, byObject, objectIds)

      if (!rows.has(otu.id)) rows.set(otu.id, makeRow({ ...otu, otuId: otu.id }))

      addPart(rows.get(otu.id), type, own)
      own.forEach((citation) => linkedCitations.add(citation))
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

    for (const { nameId, kind, citation } of resolved) {
      bound.push({ nameId, type, kind, citation })
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

  for (const { nameId, type, kind, citation } of bound) {
    for (const row of rowsByName.get(nameId) || []) {
      addPart(row, type, [citation], kind)
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
      .filter(([type]) => !untraceable.has(type))
      .map(([type, list]) => ({
        type,
        count: list.filter((c) => !linkedCitations.has(c)).length
      }))
      .filter(({ count }) => count)
  }
}
