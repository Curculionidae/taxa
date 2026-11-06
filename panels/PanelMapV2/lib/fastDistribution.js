// The species map's features, built without /otus/:id/inventory/distribution.geojson.
//
// That request makes TaxonWorks serialise every shape on the map, about 93 ms
// per area plus 54 µs per point, 10 to 13 s for a widespread species, on
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
//   targeting the side that is one of those OTUs.
// - Areas TaxonWorks has no shape for are left out, as it does itself.
// - Specimens (CollectionObject, FieldOccurrence) from each OTU's DwC records:
//   at their georeference, or, without one, as their collecting event's area
//   (collection objects only; a field occurrence without one falls back).
// TypeMaterial entries are left out: the popup drops them next to their
// specimen anyway, and type specimens missing from the list are added by the
// store's addMissingTypeSpecimens, as before.
//
// Returns null whenever something can't be rebuilt faithfully (a request or
// a shape failed to load, a distribution of something else than an OTU or an
// association); the caller then falls back to distribution.geojson. No Vue and no '@/' imports:
// `get` and `loadShape` are passed in, so node can run it.

import { specimenGeometry } from '../utils/typeSpecimenFeatures.js'

const SPECIMEN_TYPES = ['CollectionObject', 'FieldOccurrence']

const SHAPE_TYPE_LABELS = {
  GeographicArea: 'Geographic Area',
  Gazetteer: 'Gazetteer'
}

const PER = 500

function stripTags(html = '') {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function chunks(list, size) {
  const out = []

  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))

  return out
}

// Every page of an index request.
async function getAll(get, path, params) {
  const all = []

  for (let page = 1; ; page++) {
    const { data } = await get(path, [...params, ['per', PER], ['page', page]])

    all.push(...data)
    if (data.length < PER) return all
  }
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

// Map<"CollectionObject:<id>", geographicAreaId> for collection objects
// without a georeference: specimen -> collecting event -> its geographic area.
async function specimenAreas(get, rows) {
  const ceBySpecimen = new Map()
  const ids = rows.map((r) => r.dwc_occurrence_object_id)

  for (const batch of chunks(ids, 100)) {
    const records = await getAll(
      get,
      '/collection_objects',
      batch.map((id) => ['collection_object_id[]', id])
    )

    records.forEach((r) => ceBySpecimen.set(`CollectionObject:${r.id}`, r.collecting_event_id))
  }

  const ceIds = [...new Set([...ceBySpecimen.values()].filter(Boolean))]
  const areaByCe = new Map()

  for (const batch of chunks(ceIds, 100)) {
    const events = await getAll(
      get,
      '/collecting_events',
      batch.map((id) => ['collecting_event_id[]', id])
    )

    events.forEach((ce) => areaByCe.set(ce.id, ce.geographic_area_id))
  }

  return new Map(
    [...ceBySpecimen].map(([key, ceId]) => [key, areaByCe.get(ceId) ?? null])
  )
}

// Map<associationId, association> (with its `object_label`).
async function loadAssociations(get, ids) {
  const byId = new Map()

  for (const batch of chunks([...new Set(ids)], 100)) {
    const list = await getAll(
      get,
      '/biological_associations',
      batch.map((id) => ['biological_association_id[]', id])
    )

    list.forEach((association) => byId.set(association.id, association))
  }

  return byId
}

/**
 * @param {object} options
 * @param {number} options.otuId           the page's OTU
 * @param {number|null} options.taxonNameId the page's name
 * @param {number|null} [options.validTaxonNameId] its valid name
 *   (`cached_valid_taxon_name_id`), the page's name when not given
 * @param {boolean} options.isSynonym      a synonym page: its own records only
 * @param {(path: string, params: Array<[string, any]>) => Promise<{ data: any }>} options.get
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

    const [allDistributions, dwcRows] = await Promise.all([
      getAll(get, '/asserted_distributions', [
        ...otuIds.map((id) => ['otu_id[]', id]),
        ['extend[]', 'asserted_distribution_shape']
      ]),
      Promise.all(
        otuIds.map((id) => get(`/otus/${id}/inventory/dwc.json`, []).then(({ data }) => data))
      ).then((lists) => lists.flat())
    ])

    const distributions = isSynonym
      ? allDistributions.filter((ad) => !ad.is_absent)
      : allDistributions

    // Distributions of anything else than an OTU or an association: not
    // rebuilt here.
    if (
      distributions.some(
        (ad) => !['Otu', 'BiologicalAssociation'].includes(ad.asserted_distribution_object_type)
      )
    ) {
      return null
    }

    const associations = await loadAssociations(
      get,
      distributions
        .filter((ad) => ad.asserted_distribution_object_type === 'BiologicalAssociation')
        .map((ad) => ad.asserted_distribution_object_id)
    )

    // One row per specimen, even if two OTUs' lists both carry it.
    const seen = new Set()
    const specimens = dwcRows.filter((row) => {
      const key = `${row.dwc_occurrence_object_type}:${row.dwc_occurrence_object_id}`

      if (!SPECIMEN_TYPES.includes(row.dwc_occurrence_object_type) || seen.has(key)) return false
      seen.add(key)

      return otuLabels.has(row.otu_id)
    })
    const placed = specimens.map((row) => ({ row, geometry: specimenGeometry(row) }))
    const unplaced = placed.filter((p) => !p.geometry).map((p) => p.row)

    // A field occurrence's collecting event can't be looked up (the API has
    // no field_occurrences index), so it can't be placed by its area.
    if (unplaced.some((row) => row.dwc_occurrence_object_type !== 'CollectionObject')) return null
    const areaBySpecimen = unplaced.length ? await specimenAreas(get, unplaced) : new Map()

    // Every shape needed, loaded side by side.
    const shapeKeys = new Set(
      distributions.map((ad) => `${ad.asserted_distribution_shape_type}:${ad.asserted_distribution_shape_id}`)
    )

    areaBySpecimen.forEach((areaId) => areaId && shapeKeys.add(`GeographicArea:${areaId}`))

    const shapes = new Map(
      await Promise.all(
        [...shapeKeys].map(async (key) => {
          const [type, id] = key.split(':')

          return [key, await loadShape(type, Number(id))]
        })
      )
    )

    const features = []

    for (const ad of distributions) {
      const shapeType = ad.asserted_distribution_shape_type
      const shapeId = ad.asserted_distribution_shape_id
      const geometry = shapes.get(`${shapeType}:${shapeId}`)
      const areaName = ad.asserted_distribution_shape?.name ?? ''
      let subject
      let targetId

      if (ad.asserted_distribution_object_type === 'BiologicalAssociation') {
        const association = associations.get(ad.asserted_distribution_object_id)

        if (!association) return null
        subject = association.object_label
        targetId = otuLabels.has(association.biological_association_subject_id)
          ? association.biological_association_subject_id
          : association.biological_association_object_id
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
      const areaId = areaBySpecimen.get(`${type}:${id}`)
      const base = {
        type,
        id,
        label: row.occurrenceID ? `${type} ${id}; ${row.occurrenceID}` : `${type} ${id}`
      }

      if (geometry) {
        // Specimens at exactly one spot share a marker, as specimens of one
        // collecting event (one georeference) do in distribution.geojson.
        features.push({
          type: 'Feature',
          geometry,
          properties: {
            target: target(row.otu_id),
            base,
            shape: { type: 'Georeference', id: JSON.stringify(geometry.coordinates) }
          }
        })
      } else if (areaId && shapes.get(`GeographicArea:${areaId}`)) {
        features.push({
          type: 'Feature',
          geometry: shapes.get(`GeographicArea:${areaId}`),
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
    return null
  }
}
