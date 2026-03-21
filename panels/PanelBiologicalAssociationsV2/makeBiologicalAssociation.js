/**
 * makeBiologicalAssociation.js
 *
 * Transforms a merged full+basic /biological_associations response into a flat
 * object for display in PanelBiologicalAssociationsV2.
 *
 * Full endpoint  → subject/object taxonomy, object_tag (CO/FO/AnatomicalPart labels)
 * Basic endpoint → subject.properties / object.properties (pre-formatted strings)
 *
 * otuByTaxonName: Map<taxonNameId, otuId>
 *   Batch-fetched from /otus?taxon_name_id[]=X for all non-OTU entities.
 *
 * basicProps: { subjectProperties, objectProperties } from the basic endpoint.
 */

/**
 * Extracts the taxon_name_id from a TaxonWorks otu_tag_taxon_name span.
 * e.g. <span class="otu_tag_taxon_name" title="829664">...</span> → 829664
 */
export function extractTaxonNameId(objectTag) {
  if (!objectTag) return null
  const match = objectTag.match(/otu_tag_taxon_name[^>]*?title="(\d+)"/)
  return match ? Number(match[1]) : null
}

/**
 * Returns true for physical specimen types (not taxa, not anatomical parts).
 */
export function isSpecimenType(type) {
  return type === 'CollectionObject' || type === 'FieldOccurrence'
}

/**
 * Extracts the inner HTML of the otu_tag_taxon_name span from an object_tag string.
 * e.g. "...<span class="otu_tag_taxon_name" title="829664"><i>Cynoglossum officinale</i></span>..."
 *   → "<i>Cynoglossum officinale</i>"
 *
 * Used as a fallback for CO/FO when taxonomy is not extended in the full endpoint.
 */
function extractNameHtml(objectTag) {
  if (!objectTag) return null
  const span = objectTag.match(/otu_tag_taxon_name[^>]*>([\s\S]*?)<\/span>/)
  if (!span) return null
  // Grab everything from the first <i> to the last </i> — drops the trailing author name
  const italics = span[1].match(/(<i>[\s\S]*<\/i>)/)
  return italics ? italics[1] : span[1].trim()
}

/**
 * Returns { prefix, html } for the label cell.
 *
 * OTU / CO / FO    → { prefix: null, html: "<i>Genus species</i>" }
 * AnatomicalPart   → { prefix: "Leaf of ", html: "<i>Genus species</i>" }
 *                    (prefix extracted from object_label "leaf: Artemisia vulgaris")
 * Fallback         → { prefix: null, html: plain object_label text }
 *
 * Keeping prefix separate lets the template wrap only the species name in a RouterLink.
 */
function buildLabelParts(entity) {
  const genus   = entity.taxonomy?.genus?.[1]
  const species = entity.taxonomy?.species?.[1]
  let speciesHtml = genus && species ? `<i>${genus} ${species}</i>`
    : genus ? `<i>${genus}</i> sp.` : null

  // CO/FO: taxonomy may not be extended for FieldOccurrences — fall back to
  // the name HTML already present in the otu_tag_taxon_name span.
  if (!speciesHtml && isSpecimenType(entity.base_class)) {
    speciesHtml = extractNameHtml(entity.object_tag)
  }

  if (speciesHtml) {
    if (entity.base_class !== 'Otu' && !isSpecimenType(entity.base_class)) {
      // AnatomicalPart: object_label is "leaf: Artemisia vulgaris"
      const label = entity.object_label || ''
      const colonIdx = label.indexOf(': ')
      if (colonIdx > 0) {
        const raw = label.slice(0, colonIdx)
        const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1)
        return { prefix: `${capitalized} of `, html: speciesHtml }
      }
    }
    return { prefix: null, html: speciesHtml }
  }

  return { prefix: null, html: entity.object_label || '' }
}

export function makeBiologicalAssociation(
  data,
  images         = [],
  distributions  = [],
  citationList   = [],
  otuByTaxonName = new Map(),
  localityByCoId = new Map(),
  basicProps     = {}         // { subjectProperties, objectProperties } from /basic endpoint
) {
  const subj = data.subject || {}
  const obj  = data.object  || {}
  const rel  = data.biological_relationship || {}

  // OTU IDs for all non-OTU types (CO, FO, AnatomicalPart, …)
  // resolved via taxon_name_id extracted from the otu_tag_taxon_name span
  const subjTaxonNameId = subj.base_class !== 'Otu' ? extractTaxonNameId(subj.object_tag) : null
  const objTaxonNameId  = obj.base_class  !== 'Otu' ? extractTaxonNameId(obj.object_tag)  : null

  const subjLabel = buildLabelParts(subj)
  const objLabel  = buildLabelParts(obj)

  return {
    id: data.id,

    subjectId:           subj.id,
    subjectType:         subj.base_class,
    subjectFamily:       subj.taxonomy?.family || null,
    subjectLabelPrefix:  subjLabel.prefix,
    subjectSpeciesHtml:  subjLabel.html,
    subjectOtuId:        subj.base_class === 'Otu'
                          ? subj.id
                          : (otuByTaxonName.get(subjTaxonNameId) || null),
    subjectDetail:      subj.object_tag || null,
    subjectLocality:    isSpecimenType(subj.base_class) ? (localityByCoId.get(subj.id) || null) : null,
    subjectCollector:   isSpecimenType(subj.base_class) ? (localityByCoId.get(subj.id)?.recordedBy || null) : null,

    biologicalPropertySubject: basicProps.subjectProperties || null,
    biologicalRelationship:    rel.name || '',
    biologicalPropertyObject:  basicProps.objectProperties  || null,

    objectId:           obj.id,
    objectType:         obj.base_class,
    objectFamily:       obj.taxonomy?.family || null,
    objectLabelPrefix:  objLabel.prefix,
    objectSpeciesHtml:  objLabel.html,
    objectOtuId:       obj.base_class === 'Otu'
                         ? obj.id
                         : (otuByTaxonName.get(objTaxonNameId) || null),
    objectDetail:      obj.object_tag || null,
    objectLocality:    isSpecimenType(obj.base_class) ? (localityByCoId.get(obj.id) || null) : null,
    objectCollector:   isSpecimenType(obj.base_class) ? (localityByCoId.get(obj.id)?.recordedBy || null) : null,

    citations:    data.citations,
    citationList,
    images,
    distributions
  }
}
