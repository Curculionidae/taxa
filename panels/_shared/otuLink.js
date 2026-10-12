/**
 * otuLink.js
 *
 * Name and link target of an OTU, wherever one is shown as itself (a partner
 * in an association, a key's scope, a search hit). The four naming cases are
 * set out in ./otuTag.js; in short, an OTU whose own name differs from its
 * taxon name ("Carex sp.", "Salix spp." filed on the genus) is shown under the
 * own name and links to the page of its taxon, every other OTU is shown under
 * its taxon name (or its own, when that is all it has) and links to itself.
 *
 * Read from the OTU record, not from markup: `/otus?otu_id[]=…&extend[]=
 * taxon_name` gives `name` (the own name) and `taxon_name` (`cached`,
 * `cached_html`, `cached_author_year`, `rank`) as plain fields. An association
 * only carries its partner's `object_tag` / `object_label`, so for those the
 * record is fetched here, batched and shared between panels. The tag readers
 * in ./otuTag.js are the fallback when that fails.
 *
 * "The page of its taxon" is the OTU on the same TaxonName that has no name of
 * its own (Carex L., OTU 1408614, for "Carex sp." 735260 and "Carex spp."
 * 737529; lowest id when there are several). When there is none ("Arisaema
 * sp." is the only OTU on Arisaema), the OTU's own page is all there is.
 *
 * A specimen is not an OTU shown as itself: its link stays on the OTU it is
 * filed under. Callers pass OTUs only.
 *
 * Depended on by:
 *   - ./DwcTable.vue (biological associations section)
 *   - ../PanelSpecimenOccurrences/components/SingleSpeciesOccurrences.vue
 *     (association chip on a list row)
 *   - ../PanelBiologicalAssociationsV2/PanelBiologicalAssociationsV2.vue
 *     (raw data table)
 *   - ../PanelMapV2/components/Search/ListResults.vue and OtuSearch.vue
 *   - ../../modules/keys/KeysIndex.vue (key scope)
 *   - ../PanelContentV2/contentSources.js (otuNaming only, the "Entered
 *     under" heading)
 */
import { escHtml, splitScientificName } from './scientificName.js'
import {
  nameKey,
  otuDisplayNameHtml,
  otuDistinctOwnName,
  otuLinksToTaxonPage,
  otuTaxonLabel
} from './otuTag.js'

// Loaded lazily so this file stays importable under `node --test`, which can't
// resolve the `@/` alias (the tests inject their own `request`).
const apiGet = (url, config) =>
  import('@/utils/request').then((m) => m.makeAPIRequest.get(url, config))

const CHUNK = 50
const PER = 500

// String(otuId) → Promise. A promise is stored as soon as a lookup starts, so
// panels asking for the same OTU at once share one request; a failed one is
// dropped again and retried by the next caller.
const rowCache = new Map() // → the OTU record, taxon_name extended
const pageCache = new Map() // → page OTU id

// An OTU record that carries everything naming needs: fetched with
// extend[]=taxon_name, or with no TaxonName to extend. A `taxon_name` without
// `cached` (some thinner object a caller attached) does not count: it would
// name the OTU wrongly, and from rowCache for every panel.
function isOtuRecord(o) {
  return (
    !!o && 'name' in o && 'taxon_name_id' in o &&
    (o.taxon_name_id == null || typeof o.taxon_name?.cached === 'string')
  )
}

/**
 * How one OTU is named. Pure.
 *
 * @param {object} otu  an OTU record with `taxon_name` extended; or, as the
 *   fallback, anything with an `object_tag` (and `object_label`).
 * @returns {{ ownName: string|null, html: string|null,
 *   label: {italic: string, plain: string}, redirects: boolean }}
 *   `ownName`   the own name when it is the name to show, else null
 *   `html`      the name as v-html-safe HTML
 *   `label`     the same as an italic part + a plain part, for text displays
 *   `redirects` true when the link goes to the page of the taxon
 */
export function otuNaming(otu) {
  if (!isOtuRecord(otu)) {
    const tag = otu?.object_tag
    const ownName = otuDistinctOwnName(tag)
    return {
      ownName,
      html: otuDisplayNameHtml(tag),
      label: ownName
        ? { italic: '', plain: ownName }
        : splitScientificName(otuTaxonLabel(otu?.object_label, tag)),
      redirects: otuLinksToTaxonPage(tag)
    }
  }

  const own = String(otu.name || '').trim()
  const taxon = otu.taxon_name || null
  const ownName = own && !(taxon && nameKey(own) === nameKey(taxon.cached)) ? own : null
  if (ownName || !taxon) {
    return {
      ownName: ownName || null,
      html: ownName ? escHtml(ownName) : null,
      label: { italic: '', plain: ownName || '' },
      redirects: !!ownName && !!taxon
    }
  }
  const author = taxon.cached_author_year || ''
  return {
    ownName: null,
    html: [taxon.cached_html || escHtml(taxon.cached), escHtml(author)].filter(Boolean).join(' '),
    label: splitScientificName([taxon.cached, author].filter(Boolean).join(' '), { rank: taxon.rank }),
    redirects: false
  }
}

/**
 * The page OTU among the OTUs of one TaxonName: the lowest-id one without a
 * name of its own, or null when every one of them has one.
 */
export function pickTaxonPageOtu(otus) {
  const plain = (otus || [])
    .filter((o) => !o.name)
    .sort((a, b) => Number(a.id) - Number(b.id))
  return plain[0] || null
}

// Every row of /otus for the ids, in chunks, following pages until a short one.
async function fetchOtus(request, param, ids, extend) {
  const rows = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    for (let page = 1; ; page++) {
      const { data } = await request('/otus', {
        params: { [param]: ids.slice(i, i + CHUNK), per: PER, page, ...(extend ? { extend } : {}) }
      })
      if (!Array.isArray(data)) throw new TypeError('/otus did not return a list')
      rows.push(...data)
      if (data.length < PER) break
    }
  }
  return rows
}

// Runs `load(keys)` once for the keys not in `cache` yet and stores one promise
// per key; resolves to Map<key, value> for all `keys`, a failed key left out.
// A key the answer does not hold counts as failed, so it is asked again.
async function throughCache(cache, keys, load, what) {
  const fresh = keys.filter((key) => !cache.has(key))
  if (fresh.length) {
    const batch = load(fresh)
    for (const key of fresh) {
      const pending = batch.then((byKey) => {
        if (!byKey.has(key)) throw new Error(`otuLink: no ${what} for ${key}`)
        return byKey.get(key)
      })
      cache.set(key, pending)
      pending.catch(() => cache.delete(key))
    }
    batch.catch((e) => console.warn(`otuLink: ${what} lookup failed`, e))
  }
  const out = new Map()
  await Promise.all(
    keys.map((key) => cache.get(key).then((value) => out.set(key, value), () => {}))
  )
  return out
}

/**
 * Name and link target for a list of OTUs.
 *
 * @param {Array<object>} otus  OTU records (with `taxon_name` extended: no
 *   request needed to name them), or association entities `{ id, object_tag,
 *   object_label }` (their records are fetched, one batched request).
 * @returns {Promise<Map<string, {html, label, ownName, otuId}>>}
 *   String(otuId) → `otuNaming()` of the OTU plus `otuId`, the page to link
 *   to. One entry per input. Never rejects: an OTU whose record could not be
 *   fetched is named from its tag, one whose taxon page could not be resolved
 *   links to itself, and both are tried again on the next call.
 */
export async function resolveOtuLinks(otus, { request = apiGet } = {}) {
  const byKey = new Map()
  for (const otu of otus || []) {
    if (otu?.id != null && !byKey.has(String(otu.id))) byKey.set(String(otu.id), otu)
  }

  for (const [key, otu] of byKey) {
    if (isOtuRecord(otu) && !rowCache.has(key)) rowCache.set(key, Promise.resolve(otu))
  }
  const records = await throughCache(
    rowCache,
    [...byKey.keys()],
    async (keys) => {
      const rows = await fetchOtus(request, 'otu_id[]', keys.map((k) => byKey.get(k).id), ['taxon_name'])
      return new Map(rows.map((row) => [String(row.id), row]))
    },
    'OTU record'
  )

  const links = new Map()
  for (const [key, otu] of byKey) {
    const record = records.get(key)
    const { redirects, ...naming } = otuNaming(record || otu)
    // Without the record the tag still says whether the link is redirected,
    // and the object passed in may carry the TaxonName to look its page up by.
    const taxonNameId = record?.taxon_name_id ?? otu.taxon_name_id
    links.set(key, { ...naming, otuId: otu.id, redirects, taxonNameId })
  }

  const redirected = [...links].filter(([, l]) => l.redirects && l.taxonNameId != null).map(([key]) => key)
  const pages = await throughCache(
    pageCache,
    redirected,
    async (keys) => {
      const taxonNameIds = [...new Set(keys.map((k) => links.get(k).taxonNameId))]
      const siblings = new Map()
      for (const s of await fetchOtus(request, 'taxon_name_id[]', taxonNameIds)) {
        const id = String(s.taxon_name_id)
        if (!siblings.has(id)) siblings.set(id, [])
        siblings.get(id).push(s)
      }
      return new Map(
        keys.map((k) => [
          k,
          pickTaxonPageOtu(siblings.get(String(links.get(k).taxonNameId)))?.id ?? byKey.get(k).id
        ])
      )
    },
    'taxon page'
  )

  for (const [key, { redirects, taxonNameId, ...link }] of links) {
    links.set(key, { ...link, otuId: pages.get(key) ?? link.otuId })
  }
  return links
}

/**
 * The link for one OTU before, or without, resolveOtuLinks(): named from what
 * the object itself carries, linking to itself. For a list that renders while
 * its links are still resolving.
 */
export function otuLinkFallback(otu) {
  const { redirects, ...naming } = otuNaming(otu)
  return { ...naming, otuId: otu?.id ?? null }
}
