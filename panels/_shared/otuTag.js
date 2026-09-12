/**
 * otuTag.js
 *
 * Extracts the inner HTML of an otu_tag_taxon_name / otu_tag_otu_name span
 * from a TaxonWorks object_tag string, already italicized by TaxonWorks
 * (e.g. "<i>Hypera</i> (<i>Kippenbergia</i>) <i>miles</i> (Paykull, 1792)"),
 * no separate taxonomy lookup needed. `[^>]*>` after the class name
 * tolerates the span's other attributes (title=…) and any extra classes;
 * the otu_name alternative covers name-only OTUs with no linked taxon name.
 * Matching to the first `</span>` excludes any trailing valid-name marker
 * (a ✓/❌ tag) that TaxonWorks appends outside this inner span.
 *
 * Depended on by:
 *   - ../PanelBiologicalAssociationsV2/makeBiologicalAssociation.js (further
 *     reduces the result to the innermost <i>...</i> construct + "sp." for a
 *     bare-genus determination, a deliberately different name policy)
 *   - ../../modules/keys/KeysIndex.vue (uses the raw result verbatim,
 *     author-year kept, no "sp.", a deliberately different name policy)
 *
 * If you change this file, sanity-check both call sites.
 *
 * @param {string} objectTag
 * @returns {string|null}
 */
export function extractOtuTagSpan(objectTag) {
  if (!objectTag) return null
  const m = String(objectTag).match(/otu_tag_(?:taxon_name|otu_name)[^>]*>([\s\S]*?)<\/span>/)
  return m ? m[1].trim() || null : null
}
