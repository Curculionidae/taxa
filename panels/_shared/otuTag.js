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

/**
 * The name a specimen was actually identified as, when its determination
 * points at an OTU whose taxon name is no longer valid. TaxonWorks tags such
 * an OTU "<old name> <em>now</em> <valid name>" (GET /otus/:id `object_tag`),
 * while everything in the DwC payload (scientificName, genus, …) is silently
 * re-pointed to the valid name, so this marker is the only trace of the
 * original identification. Returns the old name as v-html-safe HTML that
 * keeps TaxonWorks' own italics (re-deriving them from plain text would
 * italicise a lowercase author particle, "de Geer") and its entities:
 * `<i>`/`</i>` are the only tags let through, any other tag is dropped and a
 * stray angle bracket escaped. E.g.
 * "<i>Otiorhynchus</i> (<i>Arammichnus</i>) <i>dieckmanni</i> Magnano, 1979".
 * Null for an OTU on a valid name (no marker). The named-OTU shape (own name
 * in front of an otu_tag_taxon_name span) is handled from extractOtuTagSpan's
 * known format, no live synonym OTU with a name of its own was found to
 * confirm it.
 *
 * Depended on by:
 *   - ./DwcTable.vue ("Identified by …, 2012 (as <name>)")
 *
 * @param {string} objectTag
 * @returns {string|null}
 */
export function identifiedAsNameHtml(objectTag) {
  if (!objectTag) return null
  const tag = String(objectTag)
  const idx = tag.indexOf('<em>now</em>')
  if (idx === -1) return null
  // An OTU with a name of its own is tagged "<otu name>: <taxon name span>";
  // only the taxon name is what the specimen was identified as.
  const span = tag.slice(0, idx).match(/otu_tag_taxon_name[^>]*>/)
  const html = tag
    .slice(span ? span.index + span[0].length : 0, idx)
    .split(/(<\/?i>)/)
    .map((part) =>
      /^<\/?i>$/.test(part)
        ? part
        : part.replace(/<[^>]+>/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    )
    .join('')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return html || null
}
