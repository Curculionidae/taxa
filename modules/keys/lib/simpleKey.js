// Simple keys (TaxonWorks `is_virtual` leads): a root lead plus a flat list of
// OTUs, no couplets. They stand for a published key that is not transcribed into
// TaxonWorks (example: key 35019, Datonychus). Used by the key page, the Keys
// index and the Keys panel on OTU pages.

// Full reference text of one /citations row (requested with extend[]=source).
export function citationFullText(c) {
  return c?.source?.cached || c?.citation_source_body || ''
}

// A key's primary source: the citation flagged is_original (origin_citation).
// A simple key keeps its published source as a plain citation on the root lead,
// so for a simple key the root's first citation is the fallback.
// rootCitations: full reference texts of the root lead's citations.
export function primarySource({ originCitation, isSimpleKey, rootCitations }) {
  if (originCitation) return originCitation
  if (!isSimpleKey) return null
  return (rootCitations || []).find(Boolean) || null
}

// Recognise a simple key from the /leads/key/:id `leads` map alone, for when the
// /leads list row (which carries is_virtual) is unavailable. Every lead below the
// root hangs directly off the root, has no text and points at an OTU. A couplet
// lead of a normal key always has text.
export function looksLikeSimpleKey(leads) {
  const all = Object.values(leads || {})
  const root = all.find((l) => l?.parent_id == null)
  const rest = all.filter((l) => l && l !== root)
  if (!root || !rest.length) return false
  const rootId = Object.keys(leads).find((k) => leads[k] === root)
  return rest.every(
    (l) =>
      String(l.parent_id) === String(rootId) &&
      !l.text &&
      l.target_type === '/api/v1/otus'
  )
}
