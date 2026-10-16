/**
 * Links inside a content text, made to work on TaxonPages. See readme.md,
 * "Links in the text".
 *
 * TaxonWorks links three kinds of data in a text (OTU, source, taxon name),
 * each rendered as a path of its own app
 * (`[Otiorhynchus civis](/otus/723793)`, `[Meregalli, 2017](/sources/226105)`).
 * Left as is, such a path points next to TaxonPages (in hash mode outside the
 * app altogether). Here:
 *   - `/otus/:id` becomes the TaxonPages OTU page,
 *   - `/taxon_names/:id` and `/sources/:id` become buttons the panel acts on
 *     (the page of the name's OTU, the Reference modal),
 *   - any other app path (written by hand) goes to TaxonWorks, in a new tab,
 *   - external links open in a new tab,
 *   - a bare URL in the text (a DOI written out) becomes a link.
 */

const LINK_CLASS = 'text-secondary hover:underline cursor-pointer'

// The same as the package's sanitizeAndLinkifyHtml: no trailing punctuation.
const BARE_URL = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g

const BUTTON_KINDS = [
  [/^\/taxon_names\/(\d+)\/?$/, 'taxon-name'],
  [/^\/sources\/(\d+)\/?$/, 'source']
]

function attr(value) {
  return String(value).replace(/&(?!amp;)/g, '&amp;').replace(/"/g, '&quot;')
}

function hrefOf(tag) {
  const match = tag.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
  return match ? (match[1] ?? match[2]) : null
}

function externalAnchor(href) {
  return `<a href="${attr(href)}" target="_blank" rel="noopener noreferrer">`
}

// The replacement for one opening <a> tag, and the tag that closes it.
function rewriteAnchor(tag, { otuHref, twBase }) {
  const href = hrefOf(tag)

  if (href === null) return [tag, '</a>']

  const otu = href.match(/^\/otus\/(\d+)\/?$/)
  if (otu) {
    return [
      `<a href="${attr(otuHref(otu[1]))}" data-content-link="otu" data-id="${otu[1]}">`,
      '</a>'
    ]
  }

  for (const [pattern, kind] of BUTTON_KINDS) {
    const match = href.match(pattern)
    if (match) {
      return [
        `<button type="button" class="${LINK_CLASS}" data-content-link="${kind}" data-id="${match[1]}">`,
        '</button>'
      ]
    }
  }

  if (/^\/(?!\/)/.test(href)) return [externalAnchor(twBase + href), '</a>']
  if (/^(https?:)?\/\//i.test(href)) return [externalAnchor(href), '</a>']

  return [tag, '</a>']
}

function linkify(text) {
  return text.replace(
    BARE_URL,
    (url) => `<a href="${attr(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`
  )
}

/**
 * @param {string} html content text as rendered by `inventory/content`
 * @param {object} options
 * @param {(id: string) => string} options.otuHref href of a TaxonPages OTU page
 * @param {string} options.twBase TaxonWorks app URL, no trailing slash
 */
export function rewriteContentLinks(html, { otuHref, twBase }) {
  if (!html) return ''

  const closers = []

  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (/^<a[\s>]/i.test(part)) {
        const [open, close] = rewriteAnchor(part, { otuHref, twBase })
        closers.push(close)
        return open
      }
      if (/^<\/a\s*>$/i.test(part)) return closers.pop() || part
      if (part.startsWith('<')) return part

      return closers.length ? part : linkify(part)
    })
    .join('')
}
