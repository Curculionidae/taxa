/**
 * makeBiologicalAssociation.js
 *
 * Transforms a /biological_associations response (extend[]=object,subject,
 * biological_relationship) into a flat object for display in
 * PanelBiologicalAssociationsV2. Species name HTML comes from the object_tag
 * span (no taxonomy extend needed — see extractNameHtml).
 *
 * basic: the matching row from /biological_associations/basic for this
 *   association (same id). Supplies subject_otu_id/object_otu_id,
 *   subject.family/object.family and citations from the pre-computed
 *   biological_association_indices table — cheap even at large page sizes,
 *   unlike the live extend[]=taxonomy path.
 */

import { isSpecimenType, resolveSpecimenRef, specimenKey } from '../_shared/specimenRef.js'
import { escHtml, splitScientificName } from '../_shared/scientificName.js'
import { extractOtuTagSpan } from '../_shared/otuTag.js'
export { isSpecimenType, resolveSpecimenRef, specimenKey }

/**
 * Reduces an object_tag's otu_tag span (see otuTag.js) to the name this
 * panel wants to display: just the italicized construct, "sp." appended for
 * a bare-genus determination.
 *
 * A name can carry multiple separately-italicized runs, e.g. a subgenus:
 * "<i>Hypera</i> (<i>Hypera</i>) <i>miles</i> (Paykull, 1792)" — so the match
 * must be greedy (first <i> to *last* </i>) to keep the whole construct, not
 * just the first run.
 *
 * A taxon-name-linked determination reaching only genus rank (no species
 * epithet) renders as a single italicized word, e.g. "<i>Promecops</i>
 * Sahlberg, 1823" — TaxonWorks' own tag omits any "sp." qualifier, so add
 * one back. Detected by stripping tags/parens from the matched run and
 * counting words, not by naively checking for whitespace in a single
 * capture (which the subgenus case would misread as "has a species").
 *
 * modules/keys/KeysIndex.vue extracts the same otu_tag span but keeps the
 * author-year (name + authorship verbatim, no "sp." for a bare genus) — a
 * deliberately different name policy, so this reduction step is not shared.
 */
function extractNameHtml(objectTag) {
  const span = extractOtuTagSpan(objectTag)
  if (!span) return null
  const italics = span.match(/<i>[\s\S]*<\/i>/)
  if (!italics) return span
  const html = italics[0]
  const words = html.replace(/<[^>]+>/g, '').replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean)
  return words.length > 1 ? html : `${html} sp.`
}

function nameHtmlFromScientificName(scientificName) {
  const { italic, plain } = splitScientificName(scientificName)
  if (!italic) return escHtml(scientificName || '')
  return `<i>${escHtml(italic)}</i>${plain ? ' ' + escHtml(plain) : ''}`
}

/**
 * Returns { prefix, html } for the label cell.
 *
 * OTU              → { prefix: null, html: "<i>Genus species</i>" }
 * CO / FO          → { prefix: null, html: "<i>Genus species</i> Author, Year" }
 *                    from the specimen's DWC scientificName (`specimenName`) —
 *                    a CO/FO entity's own object_tag has no clean taxon-name
 *                    span, only a catalog string ("FieldOccurrence 5000; …").
 * AnatomicalPart   → { prefix: "Leaf of ", html: "<i>Genus species</i>" }
 *                    (prefix from object_label "leaf: Artemisia vulgaris"; when
 *                    the part wraps a CO/FO, `specimenName` fills the name)
 * Fallback         → { prefix, html: plain object_label text (part head removed) }
 *
 * `specimenName` is the DWC scientificName resolved for a CO/FO entity (or the
 * CO/FO an AnatomicalPart wraps), passed in from the panel's DWC lookup.
 * Keeping prefix separate lets the template wrap only the species name in a
 * RouterLink to the OTU page.
 */
function buildLabelParts(entity, specimenName) {
  const speciesHtml = extractNameHtml(entity.object_tag)
  const isPart = entity.base_class !== 'Otu' && !isSpecimenType(entity.base_class)

  // AnatomicalPart: object_label leads with the part name, e.g.
  // "leaf: Artemisia vulgaris" or "nidus: FieldOccurrence 4996; <uuid>; …".
  // Split it into the "Leaf of " prefix and the remainder (used both as the
  // name when a real name span is present and as the fallback body).
  let prefix = null
  let partRemainder = null
  if (isPart) {
    const label = entity.object_label || ''
    const colonIdx = label.indexOf(': ')
    if (colonIdx > 0) {
      const raw = label.slice(0, colonIdx)
      prefix = `${raw.charAt(0).toUpperCase() + raw.slice(1)} of `
      partRemainder = label.slice(colonIdx + 2)
    }
  }

  // Preferred for any CO/FO (directly, or wrapped in an AnatomicalPart): the
  // determination name from the specimen's DWC record, which carries authorship.
  if (specimenName) {
    return { prefix, html: nameHtmlFromScientificName(specimenName) }
  }

  if (speciesHtml) {
    return { prefix, html: speciesHtml }
  }

  // Fallback: raw label text, minus any part-name prefix already pulled off.
  return { prefix, html: partRemainder ?? (entity.object_label || '') }
}

export function makeBiologicalAssociation(
  data,
  images         = [],
  distributions  = [],
  citationList   = [],
  basic          = null,
  localityByCoId = new Map()
) {
  const subj = data.subject || {}
  const obj  = data.object  || {}
  const rel  = data.biological_relationship || {}

  const subjSpecimen = resolveSpecimenRef(subj)
  const objSpecimen  = resolveSpecimenRef(obj)

  // localityByCoId is keyed by specimenKey() (type+id), not the bare numeric
  // id — a CollectionObject and a FieldOccurrence can share a number.
  const subjDwc = subjSpecimen ? (localityByCoId.get(specimenKey(subjSpecimen)) || null) : null
  const objDwc  = objSpecimen  ? (localityByCoId.get(specimenKey(objSpecimen))  || null) : null

  const subjLabel = buildLabelParts(subj, subjDwc?.scientificName || null)
  const objLabel  = buildLabelParts(obj, objDwc?.scientificName || null)

  return {
    id: data.id,

    subjectFamily:       basic?.subject?.family || null,
    subjectLabelPrefix:  subjLabel.prefix,
    subjectSpeciesHtml:  subjLabel.html,
    subjectOtuId:        basic?.subject_otu_id || null,
    subjectDetail:      subj.object_tag || null,
    subjectSpecimenType: subjSpecimen?.type || null,
    subjectSpecimenId:   subjSpecimen?.id || null,
    subjectLocality:    subjDwc,
    subjectCollector:   subjDwc?.recordedBy || null,

    biologicalRelationship:    rel.name || '',

    objectFamily:       basic?.object?.family || null,
    objectLabelPrefix:  objLabel.prefix,
    objectSpeciesHtml:  objLabel.html,
    objectOtuId:        basic?.object_otu_id || null,
    objectDetail:      obj.object_tag || null,
    objectSpecimenType: objSpecimen?.type || null,
    objectSpecimenId:   objSpecimen?.id || null,
    objectLocality:    objDwc,
    objectCollector:   objDwc?.recordedBy || null,

    citations:    basic?.citations || null,
    citationList,
    images,
    distributions
  }
}
