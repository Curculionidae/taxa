import { displayFamily, hasTaxonName, resolveSpecimenRef, specimenKey } from './makeBiologicalAssociation.js'

const PAGE_SIZE = 250
const BATCH_SIZE = 100
export const STANDARD_SUMMARY_PAGE_SIZE = 3000

function familyMissing(value) {
  return !displayFamily(value)
}

function uniqueValue(values) {
  return values?.size === 1 ? [...values][0] : ''
}

export function otuTaxonNameId(otu) {
  const taxonName = otu?.accepted_taxon_name || otu?.taxon_name
  return taxonName?.cached_valid_taxon_name_id
    ?? taxonName?.id
    ?? otu?.taxon_name_id
    ?? null
}

export function participantOtuId(row, side) {
  const entity = row?.[side] || {}
  return row?.[side + '_otu_id'] || (entity.type === 'Otu' ? entity.id : null)
}

/** Both endpoints must resolve to a named taxon, including underlying CO/FO
 * determinations. A label alone does not establish a TaxonPages taxon. */
export function associationHasTaxonNames(row, otuById) {
  return ['subject', 'object'].every(side => hasTaxonName(otuById.get(String(participantOtuId(row, side)))))
}

export function missingFamilyOtuIds(rows) {
  const ids = new Set()
  for (const row of rows) {
    for (const side of ['subject', 'object']) {
      if (!familyMissing(row?.[side]?.family)) continue
      const otuId = participantOtuId(row, side)
      if (otuId) ids.add(String(otuId))
    }
  }
  return [...ids]
}

/**
 * Consume server pagination rather than assuming "per" is honoured.
 * Without headers, keep reading until an empty page. Repeated pages signal
 * an incomplete response instead of silently returning a partial summary.
 */
function headerNumber(headers, names) {
  for (const name of names) {
    const value = headers?.[name]
    if (value !== undefined && value !== null && value !== '') {
      const number = Number(value)
      if (!Number.isFinite(number)) throw new Error(`Invalid pagination header ${name}`)
      return number
    }
  }
  return null
}

/**
 * Validate one paginated TaxonWorks response before it enters a collection.
 * The endpoint is allowed to omit pagination headers for legacy list shapes,
 * but any header it does return must be internally consistent.
 */
export function validateAssociationPage(response, page = null, rowKey = row => row.id) {
  const raw = response?.data
  if (!Array.isArray(raw)) throw new Error('Expected an association list')

  const headers = response?.headers || {}
  const responsePage = headerNumber(headers, ['pagination-page', 'x-page'])
  const responsePer = headerNumber(headers, ['pagination-per-page', 'x-per-page'])
  let total = headerNumber(headers, ['pagination-total', 'x-total'])
  let totalPages = headerNumber(headers, ['pagination-total-pages', 'x-total-pages'])
  const issues = []

  // Hard failures only: the response cannot be attributed to the page that was
  // asked for, or it is structurally impossible. Everything else degrades --
  // an odd index must not empty a table that has usable records in it.
  if (page !== null && responsePage !== null && responsePage !== page) {
    throw new Error(`Unexpected association page ${responsePage}; expected ${page}`)
  }
  if (responsePage !== null && responsePage < 1) throw new Error('Invalid association page number')
  if (responsePer !== null && responsePer <= 0) throw new Error('Invalid association page size')
  if (total !== null && total < 0) throw new Error('Invalid association total')
  if (totalPages !== null && totalPages < 0) throw new Error('Invalid association page count')

  // Drop rows the server repeated within one page rather than discarding the
  // page. `otu_query[coordinatify]` can surface one association through
  // several OTUs, which is a duplicate to skip, not a broken response.
  const data = []
  const pageKeys = new Set()
  for (const row of raw) {
    if (row == null || rowKey(row) == null || rowKey(row) === '') {
      throw new Error('Association page contains a row without an id')
    }
    const key = String(rowKey(row))
    if (pageKeys.has(key)) continue
    pageKeys.add(key)
    data.push(row)
  }
  if (data.length !== raw.length) {
    issues.push(`${raw.length - data.length} repeated record(s) were removed from a page.`)
  }

  // A header that contradicts the payload or the other headers is dropped and
  // derived from the data instead, so an inconsistent index costs a count --
  // not the records.
  if (total !== null && total < data.length) {
    issues.push('The reported record total was smaller than the page and has been ignored.')
    total = null
  }
  if (totalPages !== null && total !== null && responsePer !== null
    && total > 0 && totalPages > 0 && totalPages !== Math.ceil(total / responsePer)) {
    issues.push('The reported page count did not match the record total and has been ignored.')
    totalPages = null
  }
  if (totalPages === 0 && data.length) {
    issues.push('The server reported no pages although it returned records.')
    totalPages = null
  }
  if (responsePage !== null && totalPages !== null && totalPages > 0 && responsePage > totalPages) {
    issues.push('The returned page was outside the reported page count.')
    totalPages = null
  }

  const expectedPages = totalPages ?? (total !== null && responsePer !== null && responsePer > 0
    ? Math.ceil(total / responsePer) : null)
  if (!data.length && total !== null && total > 0
    && (page === null || expectedPages === null || page <= expectedPages)) {
    issues.push('The server reported records but returned an empty page.')
  }

  return { data, headers, total, totalPages, responsePage, responsePer, issues }
}

export async function fetchAllAssociationPages(
  getPage,
  isCurrent = () => true,
  rowKey = row => row.id,
  pageSize = PAGE_SIZE,
  onIssue = () => {},
  maxRows = Infinity
) {
  const rows = new Map()
  for (let page = 1; isCurrent(); page++) {
    const response = await getPage(page, pageSize)
    if (!isCurrent()) return null
    const { data, total, totalPages, issues } = validateAssociationPage(response, page, rowKey)
    issues.forEach(issue => onIssue(issue))
    const sizeBefore = rows.size
    for (const row of data) rows.set(String(rowKey(row)), row)
    if (!data.length) {
      if (Number.isFinite(total) && rows.size < total) {
        onIssue('The record list ended before every reported record was read.')
      }
      break
    }
    // Every row of this page was already known, so the server is repeating
    // itself. Stop with what has been collected instead of throwing all of it
    // away -- a partial, labelled list beats an empty error view.
    if (rows.size === sizeBefore) {
      onIssue('The server repeated a page; the list may be incomplete.')
      break
    }
    if ((totalPages > 0 && page >= totalPages) || (Number.isFinite(total) && rows.size >= total)) {
      if (Number.isFinite(total) && rows.size < total) {
        onIssue('The record list ended before every reported record was read.')
      }
      break
    }
    // A caller that holds everything in memory needs a floor to stand on. Stop
    // with a labelled partial list rather than reading an unbounded project.
    if (rows.size >= maxRows) {
      onIssue(`Only the first ${rows.size} records were read; filters and sorting cover those.`)
      break
    }
  }
  return isCurrent() ? [...rows.values()] : null
}

/** One direction of the index: the request both summary paths make. */
function directionalIndexLoader(taxonNameId, api, isCurrent, pageSize, onIssue) {
  return filter => fetchAllAssociationPages(
    (page, per) => api.get('/biological_associations/basic', {
      params: {
        [filter]: taxonNameId,
        descendants: true,
        page,
        per
      }
    }),
    isCurrent,
    row => row.id,
    pageSize,
    onIssue
  )
}

/**
 * Load the two directional Standard indices as one logical transaction. Each
 * direction may use several server pages, but callers receive no partial
 * result and no callback is invoked while the pages are being collected.
 */
export async function loadDirectionalStandardSummary(
  taxonNameId,
  api,
  isCurrent = () => true,
  pageSize = STANDARD_SUMMARY_PAGE_SIZE,
  onIssue = () => {}
) {
  const loadDirection = directionalIndexLoader(taxonNameId, api, isCurrent, pageSize, onIssue)
  const [asSubject, asObject] = await Promise.all([
    loadDirection('subject_taxon_name_id[]'),
    loadDirection('object_taxon_name_id[]')
  ])
  if (!isCurrent() || !asSubject || !asObject) return null
  return { asSubject, asObject }
}

/**
 * The three index reads a taxon summary needs, in one parallel round.
 *
 * `otu_query` names every association of the taxon -- including those recorded
 * on a specimen or on a synonym's OTU -- but not which side the taxon is on.
 * The two directional filters answer exactly that, and each is cheaper than the
 * query it runs beside: for Entiminae 2.5 s and 1.3 s against 3.0 s, so the
 * direction arrives with the rows it describes and costs nothing. Asking /otus
 * about every participant instead took nine requests and two seconds for an
 * answer the index was already holding.
 */
export async function loadSummaryIndexes(
  taxonNameId,
  api,
  isCurrent = () => true,
  pageSize = STANDARD_SUMMARY_PAGE_SIZE,
  onIssue = () => {}
) {
  const loadDirection = directionalIndexLoader(taxonNameId, api, isCurrent, pageSize, onIssue)
  const [rows, asSubject, asObject] = await Promise.all([
    fetchAllAssociationPages(
      (page, per) => {
        // Bracketed otu_query keys are written out here rather than handed to
        // axios `params`, the same way every other multi-key filter in this
        // panel is built.
        const query = new URLSearchParams()
        query.set('otu_query[taxon_name_id][]', String(taxonNameId))
        query.set('otu_query[descendants]', 'true')
        query.set('otu_query[coordinatify]', 'true')
        query.set('per', String(per))
        query.set('page', String(page))
        return api.get('/biological_associations/basic?' + query)
      },
      isCurrent,
      row => row.id,
      pageSize,
      onIssue
    ),
    loadDirection('subject_taxon_name_id[]'),
    loadDirection('object_taxon_name_id[]')
  ])
  if (!isCurrent() || !rows || !asSubject || !asObject) return null
  return {
    rows,
    subjectIds: new Set(asSubject.map(row => String(row.id))),
    objectIds: new Set(asObject.map(row => String(row.id)))
  }
}

/**
 * Which of `otuIds` lie in the current taxon's nomenclatural scope.
 *
 * This asks the question the caller actually has -- "is this participant one of
 * ours?" -- instead of enumerating the scope. A subfamily owns tens of thousands
 * of OTUs while its association index names a few hundred, and only those few
 * hundred are ever asked about.
 *
 * `anchorOtuIds` is what makes that safe. TaxonWorks applies `otu_id[]` first
 * and `coordinatify` to what survives, so an OTU that belongs to the taxon only
 * as a nomenclatural coordinate -- a synonym's OTU carrying the determination
 * of a specimen, say -- answers "no" when it is asked about on its own: nothing
 * in the request matched for it to be a coordinate of. Asking about the page's
 * own OTU alongside gives the expansion something to expand from. For
 * Brachypera dauci the anchored answer is the same eight OTUs the full scope
 * enumeration returns, and the unanchored one is empty.
 *
 * The anchors answer a question the caller did not ask, and `coordinatify` adds
 * coordinates nobody asked about either, so the result names requested ids only.
 */
export async function loadOtuScopeMembership(otuIds, taxonNameId, api, isCurrent = () => true,
  anchorOtuIds = []) {
  const ids = [...new Set(otuIds.map(String))]
  if (!ids.length) return new Set()
  const anchors = [...new Set(anchorOtuIds.map(String))].filter(id => !ids.includes(id))
  const otus = await fetchRowsInBatches(ids, (batch, page, per) => {
    const query = new URLSearchParams()
    batch.concat(anchors).forEach(id => query.append('otu_id[]', id))
    return api.get('/otus?' + query, {
      params: {
        'taxon_name_id[]': taxonNameId,
        descendants: true,
        coordinatify: true,
        page,
        per
      }
    })
  }, isCurrent, row => row.id, 3)
  if (!otus || !isCurrent()) return null
  const returned = new Set(otus.map(otu => String(otu.id)))
  return new Set(ids.filter(id => returned.has(id)))
}

/**
 * The rows neither directional index named.
 *
 * A taxon-name filter cannot see an association that belongs to the taxon
 * through a specimen's determination -- a CollectionObject subject, say -- so
 * the coordinatified query finds rows the directional pair misses. That is 9
 * rows of 997 on Entiminae, and only their participants are worth asking /otus
 * about.
 */
export function unresolvedDirectionRows(rows, subjectIds, objectIds) {
  return rows.filter(row => !subjectIds.has(String(row.id)) && !objectIds.has(String(row.id)))
}

/**
 * Split the index by direction, keeping row order.
 *
 * `scope` -- the bounded membership answer -- decides the unresolved rows only.
 * Their participants are ordinary OTUs that also appear in rows the directional
 * indices already placed (many weevils feed on the same Quercus), so testing
 * every row against the scope would pull those onto a side they are not on.
 */
export function splitAssociationsByDirection(rows, subjectIds, objectIds, scope = new Set()) {
  const unresolved = new Set(
    unresolvedDirectionRows(rows, subjectIds, objectIds).map(row => String(row.id))
  )
  const onSide = (row, side, ids) => ids.has(String(row.id))
    || (unresolved.has(String(row.id)) && scope.has(String(participantOtuId(row, side))))
  return {
    asSubject: rows.filter(row => onSide(row, 'subject', subjectIds)),
    asObject: rows.filter(row => onSide(row, 'object', objectIds))
  }
}

/**
 * Read `ids` in batches of BATCH_SIZE, each batch through all of its server
 * pages. `concurrency` only decides how many batches are in flight at once --
 * the returned rows keep batch order either way, so raising it can never
 * change a result, only the time it takes. Bulk loads (every OTU of a taxon,
 * every ancestor of a page) pass 3; the default stays serial.
 */
export async function fetchRowsInBatches(ids, makeRequest, isCurrent = () => true, rowKey = row => row.id,
  concurrency = 1) {
  const batches = []
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    batches.push(ids.slice(offset, offset + BATCH_SIZE))
  }
  const inFlight = Math.max(1, Math.min(concurrency, batches.length))
  const rows = []
  for (let offset = 0; offset < batches.length && isCurrent(); offset += inFlight) {
    const results = await Promise.all(batches.slice(offset, offset + inFlight).map(batch =>
      fetchAllAssociationPages((page, per) => makeRequest(batch, page, per), isCurrent, rowKey)
    ))
    if (results.some(result => !result)) return null
    for (const result of results) rows.push(...result)
  }
  return isCurrent() ? rows : null
}

export async function loadOtusByIds(ids, api, isCurrent = () => true, concurrency = 1) {
  const uniqueIds = [...new Set(ids.map(String))]
  if (!uniqueIds.length) return []
  return fetchRowsInBatches(uniqueIds, (batch, page, per) => {
    const query = new URLSearchParams()
    batch.forEach(id => query.append('otu_id[]', id))
    return api.get('/otus?' + query, {
      params: { page, per, extend: ['taxon_name'] }
    })
  }, isCurrent, row => row.id, concurrency)
}

/**
 * Fill gaps in /basic without changing a family already supplied by TaxonWorks.
 * Prefer a unique value recorded for the same OTU, then the same accepted
 * TaxonName. `taxonomicFamilies` is the authoritative ancestry fallback.
 */
export function fillAssociationFamilies(
  rows,
  otuById = new Map(),
  taxonomicFamilies = new Map(),
  familyRows = rows
) {
  const byOtu = new Map()
  const byTaxonName = new Map()

  for (const row of familyRows) {
    for (const side of ['subject', 'object']) {
      const family = displayFamily(row?.[side]?.family)
      const otuId = participantOtuId(row, side)
      if (!family || !otuId) continue
      const otuKey = String(otuId)
      if (!byOtu.has(otuKey)) byOtu.set(otuKey, new Set())
      byOtu.get(otuKey).add(family)
      const taxonNameId = otuTaxonNameId(otuById.get(otuKey))
      if (taxonNameId == null) continue
      const taxonKey = String(taxonNameId)
      if (!byTaxonName.has(taxonKey)) byTaxonName.set(taxonKey, new Set())
      byTaxonName.get(taxonKey).add(family)
    }
  }

  return rows.map(row => {
    let changed = false
    const filled = { ...row }
    for (const side of ['subject', 'object']) {
      if (!familyMissing(row?.[side]?.family)) continue
      const otuId = participantOtuId(row, side)
      if (!otuId) continue
      const otuKey = String(otuId)
      const taxonNameId = otuTaxonNameId(otuById.get(otuKey))
      const family = uniqueValue(byOtu.get(otuKey))
        || uniqueValue(byTaxonName.get(String(taxonNameId)))
        || taxonomicFamilies.get(String(taxonNameId))
        || ''
      if (!family) continue
      filled[side] = { ...(row[side] || {}), family }
      changed = true
    }
    return changed ? filled : row
  })
}

export function missingFamilyTaxonNameIds(rows, otuById = new Map()) {
  const ids = new Set()
  for (const otuId of missingFamilyOtuIds(rows)) {
    const taxonNameId = otuTaxonNameId(otuById.get(String(otuId)))
    if (taxonNameId != null) ids.add(String(taxonNameId))
  }
  return [...ids]
}

/** Shared by both views. Only an explicit TaxonName can supply ancestry;
 * an unlinked OTU's label is never used to guess its classification.
 * OTU metadata also tells the table whether a TaxonPages link can exist.
 */
export async function enrichAssociationFamilies(
  rows, api, otuById = new Map(), cache = new Map(), familyRows = rows,
  isCurrent = () => true
) {
  const otuIds = [...new Set(rows.flatMap(row =>
    ['subject', 'object'].map(side => participantOtuId(row, side))
  ).filter(Boolean).map(String))].filter(id => !otuById.has(id))
  const otus = await loadOtusByIds(otuIds, api, isCurrent)
  if (!otus || !isCurrent()) return null
  for (const otu of otus) otuById.set(String(otu.id), otu)

  let filled = fillAssociationFamilies(rows, otuById, cache, familyRows)
  const taxonNameIds = missingFamilyTaxonNameIds(filled, otuById)
  if (taxonNameIds.length) {
    const families = await loadTaxonomicFamilies(taxonNameIds, api, cache, isCurrent)
    if (!families || !isCurrent()) return null
    filled = fillAssociationFamilies(filled, otuById, families, familyRows)
  }
  return filled
}

/** Resolve the rank Family through TaxonWorks' documented ancestor_ids. */
export async function loadTaxonomicFamilies(
  taxonNameIds,
  api,
  cache = new Map(),
  isCurrent = () => true
) {
  const unresolved = [...new Set(taxonNameIds.map(String))]
    .filter(id => !cache.has(id))
  const familyIdByTaxonNameId = new Map()

  for (let offset = 0; offset < unresolved.length && isCurrent(); offset += 4) {
    const ids = unresolved.slice(offset, offset + 4)
    const results = await Promise.all(ids.map(async id => {
      try {
        const { data } = await api.get('/taxon_names/' + id, {
          params: { extend: ['ancestor_ids'] }
        })
        return { id, data, error: null }
      } catch (error) {
        return { id, data: null, error }
      }
    }))
    if (!isCurrent()) return null
    const failure = results.find(result => result.error)
    if (failure) throw failure.error
    for (const { id, data } of results) {
      if (!data) {
        // Do not cache a transient request failure as missing taxonomy.
        continue
      }
      if (data.rank === 'family') {
        cache.set(id, displayFamily(data.cached || data.name))
        continue
      }
      const ancestor = data.ancestor_ids?.find(([, rank]) =>
        /::FamilyGroup::Family$/.test(rank)
      )
      if (ancestor) familyIdByTaxonNameId.set(id, String(ancestor[0]))
      else cache.set(id, '')
    }
  }

  const familyIds = [...new Set(familyIdByTaxonNameId.values())]
  const families = familyIds.length
    ? await fetchRowsInBatches(familyIds, (batch, page, per) => {
        const query = new URLSearchParams()
        batch.forEach(id => query.append('taxon_name_id[]', id))
        return api.get('/taxon_names?' + query, { params: { page, per } })
      }, isCurrent)
    : []
  if (!families || !isCurrent()) return null
  const familyById = new Map(families.map(family => [
    String(family.id),
    displayFamily(family.cached || family.name)
  ]))
  for (const [taxonNameId, familyId] of familyIdByTaxonNameId) {
    cache.set(taxonNameId, familyById.get(familyId) || '')
  }
  return cache
}

/**
 * Load underlying OTUs in bounded batches; fetch DwC only for specimens on
 * the displayed (opposite) side, once per OTU, using the panel's own cache.
 * Inject the existing API client so pagination and stale navigation are testable.
 */
/**
 * An association may still point to an OTU filed under an older name. Resolve
 * those OTUs to their accepted TaxonName and accepted OTU in batches, so a
 * caller can both show the name in current use and link to the right OTU page.
 * The association and the original OTU record stay untouched -- the accepted
 * values are added as `accepted_taxon_name` / `accepted_otu_id`.
 *
 * Only OTUs whose `taxon_name.cached_valid_taxon_name_id` differs from their
 * own TaxonName cost anything, so a page without synonyms makes no request.
 * `otuById` is updated in place; returns it, or null once `isCurrent` fails.
 */
export async function resolveAcceptedNames(otuById, otuIds, api, isCurrent = () => true) {
  const relevantOtuIds = [...new Set([...otuIds].map(String))]
  const acceptedTaxonNameIds = [...new Set(relevantOtuIds.map(id => otuById.get(id)).filter(otu => otu && !otu.accepted_taxon_name).map(otu => {
    const ownId = otu.taxon_name_id ?? otu.taxon_name?.id
    const acceptedId = otu.taxon_name?.cached_valid_taxon_name_id
    return acceptedId != null && String(acceptedId) !== String(ownId)
      ? String(acceptedId)
      : null
  }).filter(Boolean))]
  if (!acceptedTaxonNameIds.length) return otuById

  const acceptedOtus = await fetchRowsInBatches(
    acceptedTaxonNameIds,
    (batch, page, per) => {
      const query = new URLSearchParams()
      batch.forEach(id => query.append('taxon_name_id[]', id))
      return api.get('/otus?' + query, { params: { page, per, extend: ['taxon_name'] } })
    },
    isCurrent
  )
  if (!acceptedOtus) return null

  const acceptedOtuByTaxonNameId = new Map()
  for (const otu of acceptedOtus.sort((a, b) => Number(a.id) - Number(b.id))) {
    const taxonNameId = String(otu.taxon_name_id ?? otu.taxon_name?.id)
    if (!acceptedOtuByTaxonNameId.has(taxonNameId)) {
      acceptedOtuByTaxonNameId.set(taxonNameId, otu)
    }
  }

  // An accepted TaxonName without its own OTU still supplies the name to show.
  const missingTaxonNameIds = acceptedTaxonNameIds.filter(id =>
    !acceptedOtuByTaxonNameId.get(id)?.taxon_name
  )
  const acceptedTaxonNames = missingTaxonNameIds.length
    ? await fetchRowsInBatches(
        missingTaxonNameIds,
        (batch, page, per) => {
          const query = new URLSearchParams()
          batch.forEach(id => query.append('taxon_name_id[]', id))
          return api.get('/taxon_names?' + query, { params: { page, per } })
        },
        isCurrent
      )
    : []
  if (!acceptedTaxonNames) return null
  const acceptedTaxonNameById = new Map(
    acceptedTaxonNames.map(taxonName => [String(taxonName.id), taxonName])
  )

  for (const otuId of relevantOtuIds) {
    const otu = otuById.get(otuId)
    if (!otu || otu.accepted_taxon_name) continue
    const ownTaxonNameId = otu.taxon_name_id ?? otu.taxon_name?.id
    const acceptedTaxonNameId = otu.taxon_name?.cached_valid_taxon_name_id
    if (acceptedTaxonNameId == null || String(acceptedTaxonNameId) === String(ownTaxonNameId)) continue
    const acceptedOtu = acceptedOtuByTaxonNameId.get(String(acceptedTaxonNameId))
    otuById.set(otuId, {
      ...otu,
      accepted_otu_id: acceptedOtu?.id || null,
      accepted_taxon_name: acceptedOtu?.taxon_name
        || acceptedTaxonNameById.get(String(acceptedTaxonNameId))
        || null
    })
  }
  return otuById
}

export async function loadStandardTaxa(asSubject, asObject, api, fetchDwcForOtu, isCurrent = () => true, cachedOtus = new Map()) {
  const participants = [
    ...asSubject.map(row => ({ row, side: 'object' })),
    ...asObject.map(row => ({ row, side: 'subject' }))
  ]
  const otuIds = new Set()
  const specimensByOtu = new Map()
  for (const { row, side } of participants) {
    const entity = row[side] || {}
    const otuId = row[side + '_otu_id'] || (entity.type === 'Otu' ? entity.id : null)
    if (!otuId) continue
    otuIds.add(String(otuId))
    const specimen = resolveSpecimenRef({
      base_class: entity.type, id: entity.id, object_label: entity.label
    })
    if (specimen) {
      if (!specimensByOtu.has(String(otuId))) specimensByOtu.set(String(otuId), new Map())
      specimensByOtu.get(String(otuId)).set(specimenKey(specimen), specimen)
    }
  }

  const otuById = new Map(cachedOtus)
  const relevantOtuIds = [...otuIds]
  const otus = await loadOtusByIds(relevantOtuIds.filter(id => !otuById.has(id)), api, isCurrent)
  if (!otus) return null
  for (const otu of otus) otuById.set(String(otu.id), otu)

  if (!await resolveAcceptedNames(otuById, relevantOtuIds, api, isCurrent)) return null

  const dwcBySpecimen = new Map()
  const specimenGroups = [...specimensByOtu]
  // At most four independent inventory requests at once.
  for (let offset = 0; offset < specimenGroups.length && isCurrent(); offset += 4) {
    await Promise.all(specimenGroups.slice(offset, offset + 4).map(async ([otuId, specimens]) => {
      const records = await fetchDwcForOtu(otuId)
      if (!isCurrent()) return
      // FO DwC records can omit family even when records of the very same
      // scientific name in this inventory contain it. Match the full name,
      // not just the inventory's OTU: higher-rank inventories include descendants.
      const familiesByName = new Map()
      for (const record of records) {
        if (!record.scientificName || !record.family) continue
        const name = record.scientificName.trim()
        if (!familiesByName.has(name)) familiesByName.set(name, new Set())
        familiesByName.get(name).add(record.family)
      }
      for (const record of records) {
        const key = specimenKey({ type: record.dwc_occurrence_object_type, id: record.dwc_occurrence_object_id })
        if (!specimens.has(key)) continue
        const families = familiesByName.get(record.scientificName?.trim())
        const family = record.family || (families?.size === 1 ? [...families][0] : null)
        dwcBySpecimen.set(key, { ...record, family })
      }
    }))
  }
  return isCurrent() ? { otuById, dwcBySpecimen } : null
}
