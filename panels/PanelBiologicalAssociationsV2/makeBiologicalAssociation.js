/**
 * makeBiologicalAssociation.js
 *
 * Transforms a raw /biological_associations/basic response item into a flat
 * object suitable for display in PanelBiologicalAssociationsV2.
 *
 * images: array of gallery image objects (from /depictions/gallery)
 * distributions: array of { id, area, isAbsent } (from /asserted_distributions)
 * citationList: array of { id, short, full } (from /citations + /sources)
 *   short: "Author, year:pages" — shown in the table cell as a clickable button
 *   full:  full HTML reference string from source.cached — shown in the modal
 * citations: plain string fallback from the basic endpoint
 */

export function makeBiologicalAssociation(data, images = [], distributions = [], citationList = []) {
  return {
    id: data.id,
    subjectId: data.subject.id,
    subjectType: data.subject.type,
    subjectFamily: data.subject.family,
    subjectLabel: data.subject.label,
    biologicalPropertySubject: data.subject.properties,
    biologicalRelationship: data.relationship,
    biologicalPropertyObject: data.object.properties,
    objectId: data.object.id,
    objectType: data.object.type,
    objectFamily: data.object.family,
    objectLabel: data.object.label,
    citations: data.citations,
    citationList,
    images,
    distributions
  }
}
