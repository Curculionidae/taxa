import { escHtml } from './scientificName.js'

/**
 * otuTag.js
 *
 * Extracts the inner HTML of an OTU's name span from a TaxonWorks object_tag
 * string, already italicized by TaxonWorks (e.g. "<i>Hypera</i>
 * (<i>Kippenbergia</i>) <i>miles</i> (Paykull, 1792)"), no separate taxonomy
 * lookup needed.
 *
 * TaxonWorks has shipped two shapes of this tag:
 *   - current (sfg, checked 2026-10-12): one plain span,
 *     `<span class="otu_tag"><i>Carex</i>&nbsp;<b>Carex sp.</b></span>`, taxon
 *     name first, the OTU's own name (if any) in bold after it;
 *   - older: an inner `otu_tag_taxon_name` / `otu_tag_otu_name` span, with
 *     other attributes (title=…) and a trailing valid-name marker (✓/❌)
 *     outside it.
 * The inner span wins when present, so the older shape still reads as before;
 * otherwise the plain `otu_tag` span is taken. Matching to the first `</span>`
 * is safe for both, neither nests a span inside the name.
 *
 * The result is verbatim: it still carries the OTU's own name in bold next to
 * the taxon name. Run it through otuDisplayNameHtml() before display.
 *
 * Depended on by:
 *   - ../PanelBiologicalAssociationsV2/makeBiologicalAssociation.js (further
 *     reduces the result, "sp." for a bare-genus determination, a deliberately
 *     different name policy)
 *   - taxonNamePart below, and through it every tag reader in this file
 *
 * If you change this function, sanity-check these.
 *
 * @param {string} objectTag
 * @returns {string|null}
 */
export function extractOtuTagSpan(objectTag) {
  if (!objectTag) return null
  const tag = String(objectTag)
  const m =
    tag.match(/otu_tag_(?:taxon_name|otu_name)[^>]*>([\s\S]*?)<\/span>/) ||
    tag.match(/class="otu_tag"[^>]*>([\s\S]*?)<\/span>/)
  return m ? m[1].trim() || null : null
}

/**
 * How an OTU is named, by what TaxonWorks holds for it:
 *
 *   taxon name only          the healthy case. Taxon name, TaxonWorks' markup.
 *   own name only            a gap in the database (no taxon name linked), but
 *                            the own name is all there is to show.
 *   both, saying the same    ("Isatis tinctoria" on Isatis tinctoria L.) the
 *                            taxon name; the own name adds nothing.
 *   both, and they differ    deliberate: "Carex sp.", or "Salix spp." for
 *                            several species of Salix, filed on the genus. The
 *                            own name alone, linked to the page of the taxon
 *                            (Carex L., Salix L.), see ./otuLink.js.
 *
 * TaxonWorks tags an OTU with both names
 * "<i>Carex</i>&nbsp;<b>Carex sp.</b>" (own name in bold, repeated after the
 * "now" marker when the taxon name is a synonym) and labels it
 * "Carex L. Carex sp."; displayed as is, both names run together.
 *
 * ./otuLink.js applies these cases from the OTU record itself (`name` and
 * the extended `taxon_name`), which is the source to prefer: resolveOtuLinks()
 * there is the call a display needs. The functions below read the same answer
 * off the tag markup instead. They are the fallback for when no record is at
 * hand (the lookup failed, or a list is still resolving), and they serve the
 * one renderer that works on tags throughout, the associations raw table.
 *
 * They all take any HTML that holds one OTU tag: the whole object_tag, or the
 * inner span from extractOtuTagSpan.
 */

// The tag without its bold own-name runs, i.e. the taxon name part only.
export function withoutOtuOwnName(html) {
  return String(html || '').replace(/(?:&nbsp;|\s)*<b>[\s\S]*?<\/b>/g, '')
}

// A name reduced for comparing an own name with a taxon name: a subgenus in
// brackets does not make "Hypera (Kippenbergia) arator" another name than
// "Hypera arator". One bracketed word only, "Brentidae (except Nanophyinae)"
// keeps its remark.
export function nameKey(s) {
  return comparableName(s).replace(/\(\s*[^\s()]+\s*\)/g, ' ').replace(/\s+/g, ' ').trim()
}

// Plain text of the taxon name in a tag, authorship included when the tag has
// it, and whether TaxonWorks italicised it. Empty for an OTU with no taxon name.
function taxonNamePart(html) {
  const inner = extractOtuTagSpan(html) ?? String(html || '')
  const recorded = withoutOtuOwnName(inner).split(/<em>\s*now\s*<\/em>/)[0]
  const italics = recorded.match(/<i>[\s\S]*<\/i>/)
  return { text: nameKey(italics ? italics[0] : recorded), italic: !!italics }
}

/**
 * The OTU's own name when that is the name to show it under: it has no taxon
 * name, or one that says something else. Null for an OTU with no own name, or
 * one that only repeats its taxon name. Plain text, not escaped.
 *
 * "Repeats" compares the name without authorship: an italicised taxon name
 * (genus and below) must match the own name outright, any other one ("Brentidae
 * Billberg, 1820", author inside the same run of text) must start with it.
 *
 * Depended on by:
 *   - otuDisplayNameHtml and otuLinksToTaxonPage below
 *   - ./otuLink.js (the fallback of otuNaming)
 *   - ../PanelBiologicalAssociationsV2/makeBiologicalAssociation.js
 *
 * @param {string} html
 * @returns {string|null}
 */
export function otuDistinctOwnName(html) {
  const own = otuOwnName(html)
  if (!own) return null
  const taxon = taxonNamePart(html)
  const key = nameKey(own)
  const same = taxon.italic ? taxon.text === key : taxon.text === key || taxon.text.startsWith(key + ' ')
  return taxon.text && same ? null : own
}

/**
 * Whether the OTU's link goes to the page of its taxon instead of its own:
 * true for the "both, and they differ" case only. ./otuLink.js resolves
 * which page that is.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function otuLinksToTaxonPage(html) {
  return !!otuDistinctOwnName(html) && !!taxonNamePart(html).text
}

/**
 * The name to display, as v-html-safe HTML: the own name as escaped text when
 * otuDistinctOwnName() says so, otherwise TaxonWorks' markup with any
 * repeating own name taken out.
 *
 * Depended on by:
 *   - ./otuLink.js (the fallback of otuNaming)
 *   - ../PanelMapV2/components/Search/OtuSearch.vue (the list's title)
 *
 * @param {string} html
 * @returns {string|null}
 */
export function otuDisplayNameHtml(html) {
  if (!html) return null
  const own = otuDistinctOwnName(html)
  return own ? escHtml(own) : withoutOtuOwnName(html).trim()
}

/**
 * The plain-text counterpart, for displays that build a name from
 * `object_label`: the label of an OTU with both names is "<taxon name with
 * author> <own name>" ("Isatis tinctoria L. Isatis tinctoria"). Cuts the own
 * name off the end, leaving the taxon name. Use it once otuDistinctOwnName()
 * came back null; any label without a trailing own name is returned unchanged.
 *
 * Depended on by:
 *   - ./otuLink.js (the fallback of otuNaming)
 *
 * @param {string} objectLabel
 * @param {string} objectTag
 * @returns {string}
 */
export function otuTaxonLabel(objectLabel, objectTag) {
  const label = String(objectLabel || '')
  const own = otuOwnName(objectTag)
  if (!own || !label.endsWith(' ' + own)) return label
  return label.slice(0, -own.length - 1).trim()
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
  // A name of its own on the old OTU is not what the specimen was identified
  // as either, only the taxon name is.
  const html = withoutOtuOwnName(tag.slice(span ? span.index + span[0].length : 0, idx))
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

// Plain, comparable form of a name: tags and entities resolved, case and
// spacing ignored.
function comparableName(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Whether the name a specimen was identified as (identifiedAsNameHtml's
 * result) is the very name its type status already states, as in "paratype
 * of Afghanocleonus kabakovi Ter-Minassian, 1976". A type designation is its
 * own identification, so repeating that name as "(as …)" adds nothing. False
 * when the two names differ, and for a bare status ("paratype") that names no
 * taxon. The name is taken after the last " of ", same as typeStatusHtml in
 * ./scientificName.js.
 *
 * Depended on by:
 *   - ./DwcTable.vue (drops the "(as …)" fragment, and the whole "Identified
 *     by" row when nothing else is recorded)
 *
 * @param {string|null} identifiedAsHtml
 * @param {string|null} typeStatus
 * @returns {boolean}
 */
export function repeatsTypeStatusName(identifiedAsHtml, typeStatus) {
  const status = String(typeStatus || '')
  const idx = status.lastIndexOf(' of ')
  if (!identifiedAsHtml || idx === -1) return false
  return comparableName(identifiedAsHtml) === comparableName(status.slice(idx + 4))
}

/**
 * The OTU's own name as plain text, read from the bold run of its tag
 * ("<i>Carex</i>&nbsp;<b>Carex sp.</b>" → "Carex sp."), entities resolved, not
 * escaped. Null when the tag has no bold run (an OTU with a taxon name only).
 * Raw: whether this is the name to show is otuDistinctOwnName()'s call.
 *
 * @param {string} objectTag
 * @returns {string|null}
 */
export function otuOwnName(objectTag) {
  const m = String(objectTag || '').match(/<b>([\s\S]*?)<\/b>/)
  if (!m) return null
  const name = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return name || null
}
