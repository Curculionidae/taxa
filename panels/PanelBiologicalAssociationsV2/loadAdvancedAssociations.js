import { fetchRowsInBatches } from './loadStandardAssociations.js'
import { shortCitation, stripHtml } from '../_shared/citationText.js'

export function rankName(taxon) {
  return String(taxon?.rank || '').split('::').pop().toLowerCase()
}

/**
 * A citation is a reference only when it points at a publication. TaxonWorks
 * also files photo credits and people as sources, and the /basic index puts
 * collector and determiner names in the very same column -- neither of those
 * opens anything, so neither may be rendered as a link.
 * Only a positively non-bibliographic source is demoted. An unknown type --
 * no lookup ran, or the server did not return that source -- keeps its link,
 * because losing every reference in the table to one failed lookup is by far
 * the worse failure; the modal can still resolve it on demand.
 */
export function isReferenceCitation(citation) {
  const type = citation?.sourceType
  return !type || type === 'Source::Bibtex'
}

function citationEntry(row, sources) {
  const source = sources?.get(String(row.source_id))
  return {
    id: row.id,
    // Same label the standard view shows: three or more authors collapse
    // to "First et al., Year"; one or two authors are left alone. Plain text, so the
    // filter list, the sort key and the clipboard all read like the cell.
    short: shortCitation(stripHtml(row.citation_source_body || '')),
    sourceId: row.source_id ?? null,
    sourceType: source?.type ?? '',
    // The full reference for the modal; the panel only has to fetch it when
    // TaxonWorks did not render one. The unshortened body is the last resort
    // so a non-bibliographic source never loses its author list.
    full: source?.cached || row.citation_source_body || ''
  }
}

/** Reuse the existing read-only client; bound query lengths and paginate each
 * annotation batch. Loading complete lightweight indices makes global filters
 * accurate without downloading full association records or full-size images.
 */
export async function loadAdvancedMetadata(ids, kind, api, isCurrent = () => true, sourceCache = new Map()) {
  const config = {
    // These two requests deliberately mirror the old built-in panel. The
    // gallery endpoint already returns the image payload, and distributions
    // are filtered by their asserted-distribution object fields.
    depictions: ['/depictions/gallery', 'depiction_object_id[]', 'depiction_object_type', 'depiction_object_id'],
    distributions: ['/asserted_distributions', 'asserted_distribution_object_id[]', 'asserted_distribution_object_type', 'asserted_distribution_object_id'],
    tags: ['/tags', 'tag_object_id[]', 'tag_object_type[]', 'tag_object_id'],
    citations: ['/citations', 'citation_object_id[]', 'citation_object_type', 'citation_object_id'],
    attributes: ['/data_attributes', 'attribute_subject_id[]', 'attribute_subject_type[]', 'attribute_subject_id']
  }[kind]
  if (!config) throw new Error('Unsupported metadata kind')
  const [path, idParam, typeParam, ownerKey] = config
  const request = (batch, page, per) => {
    const query = new URLSearchParams()
    batch.forEach(id => query.append(idParam, id))
    if (typeParam) query.set(typeParam, 'BiologicalAssociation')
    return api.get(path + '?' + query, { params: { page, per } })
  }
  const rows = []
  // Two batches at a time per metadata kind. This bounds both URL length and
  // API pressure while avoiding a long serial queue on genus/family pages.
  for (let offset = 0; offset < ids.length && isCurrent(); offset += 200) {
    const batches = [ids.slice(offset, offset + 100), ids.slice(offset + 100, offset + 200)].filter(batch => batch.length)
    const rowKey = kind === 'depictions'
      ? row => row.id ?? `${row.depiction_object_id}:${row.image?.id ?? row.image?.thumb ?? JSON.stringify(row)}`
      : row => row.id
    const results = await Promise.allSettled(batches.map(batch => fetchRowsInBatches(batch, request, isCurrent, rowKey)))
    if (!isCurrent()) return null
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      if (!result.value) return null
      rows.push(...result.value)
    }
  }
  if (!isCurrent()) return null
  // Resolve the sources of this batch before publishing it, so a citation is
  // never briefly linked and then demoted once its type is known.
  const sources = kind === 'citations'
    ? await loadCitationSources(rows.map(row => row.source_id), api, isCurrent, sourceCache)
    : null
  if (kind === 'citations' && (!sources || !isCurrent())) return null
  const byId = new Map()
  const scope = new Set(ids.map(String))
  for (const row of rows) {
    const id = String(row[ownerKey])
    if (!scope.has(id)) continue
    if (!byId.has(id)) byId.set(id, [])
    const value = kind === 'tags' ? row.keyword?.name || '' : kind === 'attributes'
      ? { id: row.id, name: row.predicate_name || row.predicate?.name || row.import_predicate || '', value: String(row.value ?? '') }
      : kind === 'citations' ? citationEntry(row, sources)
      : kind === 'distributions' ? { id: row.id, area: row.asserted_distribution_shape?.name || '', isAbsent: !!row.is_absent } : row
    byId.get(id).push(value)
  }
  return byId
}

/** Optional classification follows parent IDs in batches. Shared ancestors
 * are fetched once, rather than requesting a full ancestry for every row.
 */
export async function loadAdvancedClassification(otuById, api, cache = new Map(), isCurrent = () => true) {
  const roots = [...otuById.values()].flatMap(otu => [otu.taxon_name, otu.accepted_taxon_name]).filter(Boolean)
  const names = new Map(roots.map(taxon => [String(taxon.id), taxon]))
  for (const [id, taxon] of cache) if (!id.startsWith('genus-otu:')) names.set(id, taxon)
  let pending = [...new Set(roots.map(taxon => taxon.parent_id).filter(Boolean).map(String))]
  const visited = new Set()
  while (pending.length && isCurrent()) {
    const missing = pending.filter(id => !names.has(id))
    pending.forEach(id => visited.add(id))
    if (missing.length) {
      const rows = await fetchRowsInBatches(missing, (batch, page, per) => {
        const query = new URLSearchParams()
        batch.forEach(id => query.append('taxon_name_id[]', id))
        return api.get('/taxon_names?' + query, { params: { page, per } })
      }, isCurrent, row => row.id, 3)
      if (!rows) return null
      rows.forEach(taxon => { names.set(String(taxon.id), taxon); cache.set(String(taxon.id), taxon) })
    }
    const next = []
    for (const id of pending) {
      const taxon = names.get(id)
      const rank = rankName(taxon)
      if (taxon?.parent_id && !/^(family|order|class|phylum|kingdom|domain|superfamily)$/i.test(rank)) {
        next.push(String(taxon.parent_id))
      }
    }
    pending = [...new Set(next)].filter(id => !visited.has(id))
  }
  if (!isCurrent()) return null
  const genera = [...names.values()].filter(taxon => rankName(taxon) === 'genus')
  const genusIds = [...new Set(genera.map(taxon => String(taxon.id)))]
  const missingGenera = genusIds.filter(id => !cache.has(`genus-otu:${id}`))
  if (missingGenera.length) {
    const otus = await fetchRowsInBatches(missingGenera, (batch, page, per) => {
      const query = new URLSearchParams()
      batch.forEach(id => query.append('taxon_name_id[]', id))
      return api.get('/otus?' + query, { params: { page, per } })
    }, isCurrent, row => row.id, 3)
    if (!otus || !isCurrent()) return null
    for (const id of missingGenera) {
      const otu = otus.filter(otu => String(otu.taxon_name_id ?? otu.taxon_name?.id) === id)
        .sort((a, b) => Number(a.id) - Number(b.id))[0]
      cache.set(`genus-otu:${id}`, otu?.id || null)
    }
  }
  const result = new Map()
  for (const root of roots) {
    const classification = {}
    const seen = new Set()
    let taxon = root
    while (taxon && !seen.has(taxon.id)) {
      seen.add(taxon.id)
      const rank = rankName(taxon)
      if (rank === 'genus') classification.genusOtuId = cache.get(`genus-otu:${taxon.id}`) || null
      if (['family', 'subfamily', 'tribe'].includes(rank)) classification[rank] = taxon.name || taxon.cached
      if (rank === 'family') break
      taxon = names.get(String(taxon.parent_id))
    }
    result.set(String(root.id), classification)
  }
  return result
}

/**
 * A citation points at a Source, and only a bibliographic one is a reference a
 * reader can open. TaxonWorks also files photo credits and people as sources
 * (`Source::Verbatim`), and the /basic index puts collector names in the very
 * same field -- so the type is what separates a citation from a note.
 * Returns Map<sourceId, { type, cached }>; the full text saves the modal a
 * second round trip.
 */
export async function loadCitationSources(sourceIds, api, isCurrent = () => true, cache = new Map()) {
  const missing = [...new Set(sourceIds.filter(id => id != null).map(String))]
    .filter(id => !cache.has(id))
  if (!missing.length) return cache
  const sources = await fetchRowsInBatches(missing, (batch, page, per) => {
    const query = new URLSearchParams()
    batch.forEach(id => query.append('source_id[]', id))
    return api.get('/sources?' + query, { params: { page, per } })
  }, isCurrent, row => row.id, 3)
  if (!sources || !isCurrent()) return null
  for (const source of sources) {
    cache.set(String(source.id), { type: source.type || '', cached: source.cached || '' })
  }
  // A source the server did not return must not be asked for again on every
  // page; an unknown type simply stays unlinked.
  for (const id of missing) if (!cache.has(id)) cache.set(id, { type: '', cached: '' })
  return cache
}
