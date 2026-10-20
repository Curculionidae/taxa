const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}

/**
 * HTML as the reader sees it, for matching texts: no tags, the common
 * entities decoded, spacing collapsed. Used by the bibliography search and
 * by the curator-mode overlays to match shown names and citations.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToPlainText(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim()
}
