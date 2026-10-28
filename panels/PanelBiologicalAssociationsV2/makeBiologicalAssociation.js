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
import { extractOtuTagSpan, nameKey, otuDistinctOwnName, withoutOtuOwnName } from '../_shared/otuTag.js'
export { isSpecimenType, resolveSpecimenRef, specimenKey }

/** Plain text for taxonomic name columns, filters and spreadsheet copying. */
export function plainText(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim()
}

export function displayFamily(value) {
  const family = value?.trim?.() || ''
  return /^(?:not available|not specified)$/i.test(family) ? '' : family
}

export function hasTaxonName(otu) {
  return !!(otu?.accepted_taxon_name?.id || otu?.taxon_name_id || otu?.taxon_name?.id)
}

/**
 * A plant synonym's TaxonName as it was published; any other TaxonName as is.
 *
 * TaxonWorks files a synonym under the parent of its valid name and builds
 * `cached` from that parent. A name published in another genus therefore
 * reads as one nobody published: Dorycnium suffruticosum Vill. under Lotus as
 * "Lotus suffruticosus Vill." (OTU 736069), Lens esculenta Moench under Vicia
 * as "Vicia esculenta Moench" -- a homonym of V. esculenta Salisb., the broad
 * bean. Only the original combination keeps the genus of publication; its
 * author follows it, as on the package's Nomenclature panel.
 *
 * ICN synonyms only. An ICZN name marks a transfer itself, with the author in
 * parentheses, and the original combination of a valid name is its basionym,
 * not the name.
 *
 * Used by the Raw data and Advanced views only; the Field Assistant shows
 * accepted names.
 */
export function publishedTaxonName(taxonName) {
  const original = taxonName?.cached_original_combination
  const synonym = taxonName?.cached_valid_taxon_name_id != null
    && String(taxonName.cached_valid_taxon_name_id) !== String(taxonName.id)
  if (!original || original === taxonName.cached || !synonym || taxonName.nomenclatural_code !== 'icn') return taxonName
  return { ...taxonName, cached: original,
    cached_html: taxonName.cached_original_combination_html || `<i>${escHtml(original)}</i>` }
}

/**
 * Reduces an object_tag's otu_tag span (see otuTag.js) to the name this panel
 * displays: the marked-up name with its authorship, minus TaxonWorks' own
 * record annotations.
 *
 * "[c]" is appended to the label of an OTU filed under a Combination
 * ("<i>Calystegia sepium</i> [c]") — a database annotation, not part of the
 * name. Only a *trailing* marker is dropped: square brackets also occur inside
 * names ("Basitropidini [sic]").
 *
 * Authorship is kept: it is part of how a determination reads. The exception is
 * a bare-genus determination, see below.
 *
 * `dropAcceptedTail` removes the "<em>now</em> <accepted name>" tail TaxonWorks
 * appends to a synonym's tag. The caller passes it once it resolved the
 * accepted name itself (see acceptedName) and renders that part with its own
 * link to the OTU that carries the records — otherwise the name would read
 * twice. Without a resolved accepted name the tail stays, so nothing is lost —
 * except when it repeats the name it follows verbatim ("<i>Cytisus scoparius</i>
 * Wimm. ex W.D.J.Koch <em>now</em> <i>Cytisus scoparius</i> Wimm. ex
 * W.D.J.Koch", OTU 736049, whose TaxonName is valid and has no accepted name to
 * resolve). That says nothing and is dropped either way.
 *
 * A name can carry multiple separately-italicized runs, e.g. a subgenus:
 * "<i>Hypera</i> (<i>Hypera</i>) <i>miles</i> (Paykull, 1792)" — so the match
 * must be greedy (first <i> to *last* </i>) to keep the whole construct, not
 * just the first run.
 *
 * A specimen determination reaching only genus rank (no species epithet)
 * renders as a single italicized word, e.g. "<i>Promecops</i> Sahlberg, 1823" —
 * TaxonWorks' own tag omits any "sp." qualifier, so add one back, and drop the
 * authorship there, which belongs to the genus and would read as the species
 * author. Only for a specimen, or an AnatomicalPart that wraps one
 * (`bareGenusSp`): an association recorded against
 * the genus OTU itself is about the genus and reads "<i>Carex</i> L.", which
 * also keeps it apart from the OTU "Carex sp.". Detected by stripping tags/parens from the
 * matched run and counting words, not by naively checking for whitespace in a
 * single capture (which the subgenus case would misread as "has a species").
 *
 * modules/keys/KeysIndex.vue extracts the same otu_tag span but keeps it
 * verbatim (authorship kept, no "[c]" handling, no "sp." for a bare genus) — a
 * deliberately different name policy, so this reduction step is not shared.
 */
function extractNameHtml(objectTag, dropAcceptedTail = false, bareGenusSp = true, otuLink = null) {
  const span = extractOtuTagSpan(objectTag)
  if (!span) return null
  // The naming rule every display shares (otuTag.js): an OTU whose own name
  // differs from its taxon name, or that has no taxon name, shows the own name
  // alone ("Carex sp.", not "Carex L. Carex sp."). One that only repeats the
  // taxon name loses it here and goes on as a plain taxon name. `otuLink`
  // (resolveOtuLinks, from the OTU record) decides when the caller has it, so
  // this table agrees with every other display; the tag decides otherwise.
  const ownName = otuLink ? otuLink.ownName : otuDistinctOwnName(span)
  if (ownName) return escHtml(ownName)
  let name = withoutOtuOwnName(span).replace(/\s*\[c\]\s*$/, '').trim()
  const tail = name.match(/^([\s\S]*?)\s*<em>\s*now\s*<\/em>\s*([\s\S]*)$/)
  if (tail && (dropAcceptedTail || plainText(tail[1]) === plainText(tail[2]))) name = tail[1].trim()
  const italics = name.match(/<i>[\s\S]*<\/i>/)
  if (!italics) return name || null
  const words = italics[0].replace(/<[^>]+>/g, '').replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean)
  return words.length > 1 || !bareGenusSp ? name : `${italics[0]} sp.`
}

/**
 * The name in current use for a participant OTU, when resolveAcceptedNames()
 * (loadStandardAssociations.js) found one that differs from the name the
 * association was recorded under. Returns { html, otuId } or null.
 *
 * `cached_html` is TaxonWorks-rendered markup like object_tag; the `cached`
 * fallback is plain text and has to be escaped. `otuId` can be null: an
 * accepted TaxonName does not have to have an OTU of its own, and then the
 * name is shown without a link.
 */
function acceptedName(otu) {
  const accepted = otu?.accepted_taxon_name
  if (!accepted) return null
  const ownTaxonNameId = otu.taxon_name_id ?? otu.taxon_name?.id
  if (ownTaxonNameId != null && String(accepted.id) === String(ownTaxonNameId)) return null
  const html = taxonNameHtml(accepted)
  return html ? { html, otuId: otu.accepted_otu_id || null } : null
}

/**
 * The name a participant OTU was determined as, with its authorship -- the
 * recorded counterpart to acceptedName(), built the same way. Only needed for a
 * specimen whose OTU is a synonym: see buildLabelParts().
 */
function recordedName(otu) {
  return taxonNameHtml(otu?.taxon_name)
}

/**
 * The recorded name of a plant synonym as published (see publishedTaxonName),
 * or null when TaxonWorks' own name stands. A name of the OTU's own is still
 * the name to show (otuTag.js), unless it only repeats the published one:
 * "Dorycnium suffruticosum" on Lotus suffruticosus Vill. (OTU 736069) is the
 * name TaxonWorks could not show, and gains its author here.
 */
function publishedName(entity, otu, otuLink) {
  const published = publishedTaxonName(otu?.taxon_name)
  if (published === otu?.taxon_name) return null
  const ownName = otuLink ? otuLink.ownName : otuDistinctOwnName(extractOtuTagSpan(entity?.object_tag))
  return ownName && nameKey(ownName) !== nameKey(published.cached) ? null : taxonNameHtml(published)
}

function taxonNameHtml(taxonName) {
  const name = taxonName?.cached_html || (taxonName?.cached ? `<i>${escHtml(taxonName.cached)}</i>` : '')
  if (!name) return null
  const author = taxonName.cached_author_year
  return author ? `${name} ${escHtml(author)}` : name
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
 *                    from the specimen's DWC scientificName (`specimenName`).
 * AnatomicalPart   → { prefix: "Leaf of ", html: "<i>Genus species</i>" }
 *                    (prefix from object_label "leaf: Artemisia vulgaris"; when
 *                    the part wraps a CO/FO, `specimenName` fills the name)
 * Fallback         → { prefix, html: plain object_label text (part head removed) }
 *
 * `specimenName` is the DWC scientificName resolved for a CO/FO entity (or the
 * CO/FO an AnatomicalPart wraps), passed in from the panel's DWC lookup.
 * Keeping prefix separate lets the template wrap only the species name in a
 * RouterLink to the OTU page.
 *
 * `dropAcceptedTail` is passed through to extractNameHtml: true once the caller
 * renders the accepted name itself.
 *
 * DWC's scientificName is always the *valid* name, not the one the specimen was
 * determined as. When the determination is a synonym (`dropAcceptedTail`), it
 * would repeat the accepted name the caller appends ("indefinitus now
 * indefinitus", OTU 722800). The recorded name then comes from the object_tag's
 * "det. <otu_tag>" span, or -- for an AnatomicalPart wrapping the specimen,
 * whose tag has no such span -- from the determination OTU (`recordedHtml`).
 * A plant synonym published in another genus reads wrong in both; its
 * `publishedHtml` (see publishedName) then replaces them.
 */
function buildLabelParts(entity, specimenName, dropAcceptedTail = false, recordedHtml = null, otuLink = null, publishedHtml = null) {
  // "sp." for a genus-only determination of a specimen, also when an
  // AnatomicalPart (a nidus, an egg) wraps that specimen.
  const speciesHtml = extractNameHtml(entity.object_tag, dropAcceptedTail, !!resolveSpecimenRef(entity), otuLink)
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

  if (dropAcceptedTail && (publishedHtml || speciesHtml || recordedHtml)) {
    return { prefix, html: publishedHtml || speciesHtml || recordedHtml }
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
  localityByCoId = new Map(),
  otuById        = new Map(),
  // String(otuId) → { ownName, otuId, … } (resolveOtuLinks in
  // ../_shared/otuLink.js): the OTU "Carex sp." is shown under that name
  // and links to the page of Carex L. Only for a participant that is an OTU; a
  // specimen's link stays on the OTU it is filed under.
  otuLinkByOtuId = new Map()
) {
  const otuLink = (entity) =>
    (entity?.base_class === 'Otu' && otuLinkByOtuId.get(String(entity.id))) || null

  const subj = data.subject || {}
  const obj  = data.object  || {}
  const rel  = data.biological_relationship || {}

  const subjSpecimen = resolveSpecimenRef(subj)
  const objSpecimen  = resolveSpecimenRef(obj)

  // localityByCoId is keyed by specimenKey() (type+id), not the bare numeric
  // id — a CollectionObject and a FieldOccurrence can share a number.
  const subjDwc = subjSpecimen ? (localityByCoId.get(specimenKey(subjSpecimen)) || null) : null
  const objDwc  = objSpecimen  ? (localityByCoId.get(specimenKey(objSpecimen))  || null) : null

  const subjOtu = otuById.get(String(basic?.subject_otu_id))
  const objOtu  = otuById.get(String(basic?.object_otu_id))
  const subjAccepted = acceptedName(subjOtu)
  const objAccepted  = acceptedName(objOtu)

  const subjLabel = buildLabelParts(subj, subjDwc?.scientificName || null, !!subjAccepted,
    subjAccepted ? recordedName(subjOtu) : null, otuLink(subj),
    subjAccepted ? publishedName(subj, subjOtu, otuLink(subj)) : null)
  const objLabel  = buildLabelParts(obj, objDwc?.scientificName || null, !!objAccepted,
    objAccepted ? recordedName(objOtu) : null, otuLink(obj),
    objAccepted ? publishedName(obj, objOtu, otuLink(obj)) : null)

  return {
    id: data.id,

    subjectFamily:       displayFamily(basic?.subject?.family) || displayFamily(subjDwc?.family) || null,
    subjectLabelPrefix:  subjLabel.prefix,
    subjectSpeciesHtml:  subjLabel.html,
    subjectOtuId:        otuLink(subj)?.otuId || basic?.subject_otu_id || null,
    subjectHasTaxonName: hasTaxonName(subjOtu),
    // subjectOtuId / objectOtuId are link targets, not the participant's
    // identity: an OTU like "Carex sp." links to the page of its taxon (see
    // otuLink.js). The participant's own id stays in `basic`.
    //
    // The name in current use, shown after the recorded one. Raw data keeps the
    // name as it was entered and points at the OTU that carries the records
    // alongside it, rather than silently replacing it the way the Field
    // Assistant does.
    subjectAcceptedNameHtml: subjAccepted?.html  || null,
    subjectAcceptedOtuId:    subjAccepted?.otuId || null,
    subjectSpecimenType: subjSpecimen?.type || null,
    subjectSpecimenId:   subjSpecimen?.id || null,
    subjectLocality:    subjDwc,
    subjectCollector:   subjDwc?.recordedBy || null,

    biologicalRelationship:    rel.name || '',

    objectFamily:       displayFamily(basic?.object?.family) || displayFamily(objDwc?.family) || null,
    objectLabelPrefix:  objLabel.prefix,
    objectSpeciesHtml:  objLabel.html,
    objectOtuId:        otuLink(obj)?.otuId || basic?.object_otu_id || null,
    objectHasTaxonName:  hasTaxonName(objOtu),
    objectAcceptedNameHtml: objAccepted?.html  || null,
    objectAcceptedOtuId:    objAccepted?.otuId || null,
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


/** The label prefix is anatomy; BiologicalProperty is a different concept. */
export function anatomicalPartName(entity) {
  if ((entity?.type || entity?.base_class) !== 'AnatomicalPart') return null
  const label = entity.label ?? entity.object_label ?? ''
  const colon = label.indexOf(': ')
  return colon > 0 ? label.slice(0, colon).trim() : null
}

/**
 * Normalize a /basic participant for aggregation, using its underlying OTU
 * even when the association itself only refers to a specimen or a part.
 * Keep plain text here: the standard table does not need another v-html source.
 */
export function makeStandardParticipant(row, side, otuById = new Map(), dwcBySpecimen = new Map()) {
  const entity = row[side] || {}
  const entityType = entity.type || entity.base_class
  const otuId = row[side + '_otu_id'] || (entity.type === 'Otu' ? entity.id : null)
  const otu = otuById.get(String(otuId))
  const originalTaxon = otu?.taxon_name
  const taxon = otu?.accepted_taxon_name || originalTaxon
  const unlinked = !!otu && !hasTaxonName(otu)
  const displayOtuId = otu?.accepted_otu_id || otuId
  const specimen = resolveSpecimenRef({
    base_class: entity.type,
    id: entity.id,
    object_label: entity.label
  })
  const dwc = specimen ? dwcBySpecimen.get(specimenKey(specimen)) : null
  const part = anatomicalPartName(entity)
  const label = part ? entity.label.slice(entity.label.indexOf(': ') + 2) : entity.label
  const scientificName = taxon?.cached || otu?.name || dwc?.scientificName
    || (!specimen ? label : null)
  const name = scientificName ? splitScientificName(scientificName) : null
  // TaxonName identity combines distinct OTUs of the same taxon, without
  // guessing that unrelated OTUs with identical text must mean the same taxon.
  const taxonId = taxon?.id || originalTaxon?.cached_valid_taxon_name_id
    || otu?.taxon_name_id || originalTaxon?.id
  const key = taxonId ? 'taxon:' + taxonId
    : otuId ? 'otu:' + otuId
    : specimen ? specimenKey(specimen)
    : entity.id ? (entity.type || 'entity') + ':' + entity.id
    : 'association:' + row.id + ':' + side

  return {
    key,
    otuId: hasTaxonName(otu) ? displayOtuId : null,
    name: taxon?.cached || (unlinked && otu?.name) || name?.italic || label || 'Unidentified taxon',
    pending: !!otuId && (!otu || (specimen && !dwc)),
    unlinked,
    italic: !unlinked && !!scientificName && (!taxon?.rank || /^(subgenus|genus|species|subspecies|variety|form)$/.test(taxon.rank)),
    family: displayFamily(entity.family) || displayFamily(dwc?.family) || null,
    part
  }
}
