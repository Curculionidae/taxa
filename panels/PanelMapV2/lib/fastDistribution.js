// The species map's features, built without /otus/:id/inventory/distribution.geojson.
//
// That request makes TaxonWorks serialise every shape on the map, about 93 ms
// per area plus 54 µs per point, 10 to 15 s for a widespread species, on
// every visit. Here the same features come from requests without geometry
// (about 1 s each, run side by side) and the shapes from files built ahead of
// time (public/map-shapes/, scripts/build-map-shapes.mjs).
//
// Checked feature by feature against distribution.geojson (ids, labels,
// shapes, targets) on several species: scripts/compare-map-distribution.mjs.
// What distribution.geojson covers, and how it is rebuilt:
// - OTUs: the page name's valid name, its descendants (subspecies) and the
//   synonyms of both ("coordinate OTUs"); on a synonym page the page's OTU
//   alone. The valid name, not the page's: a nominotypical subspecies can
//   have the species as its valid name, and then shows the species' synonyms.
// - Asserted distributions of those OTUs, present and absent, labelled
//   "<OTU label> in <area> [Geographic Area]" like TaxonWorks does. Absent
//   ones target the page's OTU, as distribution_is_absent.geojson has them,
//   and are left out on a synonym page, where that endpoint returns none.
// - Distributions of a biological association of those OTUs, labelled with
//   the association ("<subject> collected from <object> in <area> [...]") and
//   targeting its side that is one of those OTUs.
// - Specimens (CollectionObject, FieldOccurrence) from each OTU's DwC records:
//   at their georeference, or, without one, as their collecting event's area
//   (collection objects only; a field occurrence without one falls back).
//   Specimens of one collecting event share one marker, as specimens of one
//   georeference do in distribution.geojson (an event has one georeference;
//   the API exposes no georeference ids). Field occurrences, whose event
//   can't be looked up, get a marker each.
// - Areas TaxonWorks has no shape for are left out, as it does itself.
// TypeMaterial entries are left out: the popup drops them next to their
// specimen anyway, and type specimens missing from the list are added by the
// store's addMissingTypeSpecimens, as before.
//
// Returns null whenever something can't be rebuilt faithfully (a request or
// a shape failed to load, a distribution of something else than an OTU or an
// association); the caller then falls back to distribution.geojson. Each such
// check runs as soon as its data is in, so a fallback starts early. No Vue and
// no '@/' imports: `get` and `loadShape` are passed in, so node can run it.

import { specimenGeometry } from '../utils/typeSpecimenFeatures.js'

const SPECIMEN_TYPES = ['CollectionObject', 'FieldOccurrence']

const SHAPE_TYPE_LABELS = {
  GeographicArea: 'Geographic Area',
  Gazetteer: 'Gazetteer'
}

const PER = 500
const BATCH = 100

// Thrown to stop as soon as the map can't be rebuilt faithfully.
class Declined extends Error {}

const NAMED_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function stripTags(html = '') {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (entity, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Number(dec))
      if (hex) return String.fromCodePoint(parseInt(hex, 16))

      return NAMED_ENTITIES[name.toLowerCase()] ?? entity
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function chunks(list, size) {
  const out = []

  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))

  return out
}

function header(headers, name) {
  return typeof headers?.get === 'function' ? headers.get(name) : headers?.[name]
}

// Every page of an index request: the first page says how many there are,
// the rest are fetched side by side.
async function getAll(get, path, params) {
  const page = (n) => get(path, [...params, ['per', PER], ['page', n]])
  const first = await page(1)
  const pages = Number(header(first.headers, 'pagination-total-pages'))

  if (!pages) {
    // No page count: page on while pages come back full.
    const all = [...first.data]

    for (let n = 2, last = first.data; last.length >= PER; n++) {
      last = (await page(n)).data
      all.push(...last)
    }

    return all
  }

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => page(i + 2).then(({ data }) => data))
  )

  return [first.data, ...rest].flat()
}

// The same index request for many ids, in batches side by side.
async function getByIds(get, path, param, ids) {
  const lists = await Promise.all(
    chunks([...new Set(ids)], BATCH).map((batch) =>
      getAll(get, path, batch.map((id) => [param, id]))
    )
  )

  return lists.flat()
}

async function loadOtus(get, { otuId, taxonNameId, isSynonym }) {
  const params =
    isSynonym || !taxonNameId
      ? [['otu_id[]', otuId]]
      : [
          ['taxon_name_id[]', taxonNameId],
          ['descendants', 'true'],
          ['coordinatify', 'true']
        ]

  return getAll(get, '/otus', params)
}

// Map<collectionObjectId, collectingEventId|null>.
async function collectingEvents(get, collectionObjectIds) {
  if (!collectionObjectIds.length) return new Map()

  const records = await getByIds(get, '/collection_objects', 'collection_object_id[]', collectionObjectIds)

  return new Map(records.map((r) => [r.id, r.collecting_event_id ?? null]))
}

// Map<collectingEventId, geographicAreaId|null>.
async function eventAreas(get, eventIds) {
  if (!eventIds.length) return new Map()

  const events = await getByIds(get, '/collecting_events', 'collecting_event_id[]', eventIds)

  return new Map(events.map((ce) => [ce.id, ce.geographic_area_id ?? null]))
}

// Map<"<type>:<id>", Promise<geometry|null>>, each shape asked for once.
function shapeLoader(loadShape) {
  const shapes = new Map()

  return (type, id) => {
    const key = `${type}:${id}`

    if (!shapes.has(key)) {
      const promise = loadShape(type, Number(id))

      // Started early, awaited later: a failure is handled where it is
      // awaited, not reported as unhandled meanwhile.
      promise.catch(() => {})
      shapes.set(key, promise)
    }

    return shapes.get(key)
  }
}

/**
 * @param {object} options
 * @param {number} options.otuId           the page's OTU
 * @param {number|null} options.taxonNameId the page's name
 * @param {number|null} [options.validTaxonNameId] its valid name
 *   (`cached_valid_taxon_name_id`), the page's name when not given
 * @param {boolean} options.isSynonym      a synonym page: its own records only
 * @param {(path: string, params: Array<[string, any]>) => Promise<{ data: any, headers?: any }>} options.get
 * @param {(type: string, id: number) => Promise<object|null>} options.loadShape
 *   the geometry of a GeographicArea / Gazetteer, null when TaxonWorks has no
 *   shape for it; rejects when it could not be loaded
 * @returns {Promise<object[]|null>} GeoJSON features as distribution.geojson
 *   has them, or null: use distribution.geojson instead
 */
export async function loadFastDistribution({
  otuId,
  taxonNameId,
  validTaxonNameId,
  isSynonym,
  get,
  loadShape
}) {
  try {
    const otus = await loadOtus(get, {
      otuId,
      taxonNameId: validTaxonNameId || taxonNameId,
      isSynonym
    })

    if (!otus.length) return null

    const otuIds = otus.map((otu) => otu.id)
    const otuLabels = new Map(otus.map((otu) => [otu.id, stripTags(otu.object_tag)]))
    const target = (id) => ({ id, label: otuLabels.get(id) ?? '', type: 'Otu' })
    const shape = shapeLoader(loadShape)

    // Distributions, and from them their associations and shapes, run side
    // by side with the specimens and their areas.
    const distributionsPromise = getAll(get, '/asserted_distributions', [
      ...otuIds.map((id) => ['otu_id[]', id]),
      ['extend[]', 'asserted_distribution_shape']
    ]).then((all) => {
      const distributions = isSynonym ? all.filter((ad) => !ad.is_absent) : all

      if (
        distributions.some(
          (ad) => !['Otu', 'BiologicalAssociation'].includes(ad.asserted_distribution_object_type)
        )
      ) {
        throw new Declined('distribution of something else than an OTU or association')
      }

      // Shapes start loading now, not after the specimens are in.
      distributions.forEach((ad) =>
        shape(ad.asserted_distribution_shape_type, ad.asserted_distribution_shape_id)
      )

      return distributions
    })

    const associationsPromise = distributionsPromise.then(async (distributions) => {
      const ids = distributions
        .filter((ad) => ad.asserted_distribution_object_type === 'BiologicalAssociation')
        .map((ad) => ad.asserted_distribution_object_id)
      const list = await getByIds(get, '/biological_associations', 'biological_association_id[]', ids)

      return new Map(list.map((association) => [association.id, association]))
    })

    const specimensPromise = Promise.all(
      otuIds.map((id) => get(`/otus/${id}/inventory/dwc.json`, []).then(({ data }) => data))
    ).then(async (lists) => {
      // One row per specimen, even if two OTUs' lists both carry it; a row
      // determined to an OTU outside the set does not hide a copy within it.
      const seen = new Set()
      const rows = lists.flat().filter((row) => {
        const key = `${row.dwc_occurrence_object_type}:${row.dwc_occurrence_object_id}`

        if (!SPECIMEN_TYPES.includes(row.dwc_occurrence_object_type)) return false
        if (!otuLabels.has(row.otu_id) || seen.has(key)) return false
        seen.add(key)

        return true
      })
      const placed = rows.map((row) => ({ row, geometry: specimenGeometry(row) }))
      const unplaced = placed.filter((p) => !p.geometry).map((p) => p.row)

      // A field occurrence's collecting event can't be looked up (the API has
      // no field_occurrences index), so it can't be placed by its area.
      if (unplaced.some((row) => row.dwc_occurrence_object_type !== 'CollectionObject')) {
        throw new Declined('field occurrence without a georeference')
      }

      const eventByObject = await collectingEvents(
        get,
        rows
          .filter((row) => row.dwc_occurrence_object_type === 'CollectionObject')
          .map((row) => row.dwc_occurrence_object_id)
      )
      const areaByEvent = await eventAreas(
        get,
        unplaced.map((row) => eventByObject.get(row.dwc_occurrence_object_id)).filter(Boolean)
      )

      areaByEvent.forEach((areaId) => areaId && shape('GeographicArea', areaId))

      return { placed, eventByObject, areaByEvent }
    })

    const [distributions, associations, { placed, eventByObject, areaByEvent }] = await Promise.all([
      distributionsPromise,
      associationsPromise,
      specimensPromise
    ])

    const features = []

    for (const ad of distributions) {
      const shapeType = ad.asserted_distribution_shape_type
      const shapeId = ad.asserted_distribution_shape_id
      const geometry = await shape(shapeType, shapeId)
      const areaName = ad.asserted_distribution_shape?.name ?? ''
      let subject
      let targetId

      if (ad.asserted_distribution_object_type === 'BiologicalAssociation') {
        const association = associations.get(ad.asserted_distribution_object_id)
        const side = ['subject', 'object'].find(
          (s) =>
            association?.[`biological_association_${s}_type`] === 'Otu' &&
            otuLabels.has(association[`biological_association_${s}_id`])
        )

        if (!side) return null
        subject = association.object_label
        targetId = association[`biological_association_${side}_id`]
      } else {
        subject = otuLabels.get(ad.asserted_distribution_object_id) ?? ''
        targetId = ad.is_absent ? otuId : ad.asserted_distribution_object_id
      }

      if (!geometry) continue

      features.push({
        type: 'Feature',
        geometry,
        properties: {
          base: {
            type: 'AssertedDistribution',
            id: ad.id,
            label: `${subject} in ${areaName} [${SHAPE_TYPE_LABELS[shapeType] ?? shapeType}]`
          },
          shape: { type: shapeType, id: shapeId },
          is_absent: ad.is_absent ?? null,
          target: target(targetId)
        }
      })
    }

    for (const { row, geometry } of placed) {
      const type = row.dwc_occurrence_object_type
      const id = row.dwc_occurrence_object_id
      const base = {
        type,
        id,
        label: row.occurrenceID ? `${type} ${id}; ${row.occurrenceID}` : `${type} ${id}`
      }

      const eventId = type === 'CollectionObject' ? eventByObject.get(id) : null

      if (geometry) {
        // One marker per collecting event (= per georeference).
        features.push({
          type: 'Feature',
          geometry,
          properties: {
            target: target(row.otu_id),
            base,
            shape: { type: 'Georeference', id: eventId ? `event:${eventId}` : `${type}:${id}` }
          }
        })
        continue
      }

      const areaId = eventId ? areaByEvent.get(eventId) : null
      const areaGeometry = areaId ? await shape('GeographicArea', areaId) : null

      if (areaGeometry) {
        features.push({
          type: 'Feature',
          geometry: areaGeometry,
          properties: {
            target: target(row.otu_id),
            base,
            shape: { type: 'GeographicArea', id: areaId }
          }
        })
      }
    }

    return features
  } catch {
    // Declined, or a request / shape failed.
    return null
  }
}
