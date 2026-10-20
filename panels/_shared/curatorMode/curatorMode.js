import { getCurrentInstance, onMounted, ref } from 'vue'

/**
 * Curator mode: shows "Edit in TaxonWorks" links that the public does not
 * need to see.
 *
 * Turned on by opening any page once with `?curator=1` (in the hash part,
 * `/#/otus/1?curator=1`, or before it, `/?curator=1#/otus/1`), turned off
 * with `?curator=0`. The choice is kept in this browser's localStorage.
 *
 * This only hides links. It protects nothing: the TaxonWorks pages behind
 * them ask for a TaxonWorks login.
 *
 * Components get the switch with `useCuratorMode()`, which reads the URL and
 * storage once the component is mounted. Not earlier: with server rendering
 * the server never sees the browser's storage, so it renders without curator
 * mode, and the browser must match that HTML before it adds the links
 * (otherwise Vue reports a hydration mismatch). Every component that shows
 * curator links calls it, so no further setup is needed. The red leave
 * button (`CuratorModeButton.vue`) comes from the project's `layout.js`.
 */

const STORAGE_KEY = 'taxonpages:curator-mode'

export const isCuratorMode = ref(false)

let isStarted = false

/**
 * The `curator` value in a URL, '1', '0' or null. The hash part counts too,
 * because the site routes in it.
 *
 * @param {string} href
 * @returns {string|null}
 */
export function readCuratorSwitch(href) {
  let url

  try {
    url = new URL(href)
  } catch {
    return null
  }

  const hashQuery = url.hash.includes('?') ? url.hash.split('?')[1] : ''

  return (
    new URLSearchParams(hashQuery).get('curator') ??
    url.searchParams.get('curator')
  )
}

function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function applySwitch(href) {
  const value = readCuratorSwitch(href)
  const storage = getStorage()

  try {
    if (value === '1') storage?.setItem(STORAGE_KEY, '1')
    if (value === '0') storage?.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private window etc.): the switch lasts for this visit.
  }

  let stored = false

  try {
    stored = storage?.getItem(STORAGE_KEY) === '1'
  } catch {}

  // Without a switch in the URL, keep what is stored, or what this visit
  // already had (storage may be blocked).
  if (value === '1') isCuratorMode.value = true
  else if (value === '0') isCuratorMode.value = false
  else isCuratorMode.value = stored || isCuratorMode.value
}

export function startCuratorMode() {
  if (isStarted || typeof window === 'undefined') return

  isStarted = true
  applySwitch(window.location.href)

  // Typing the switch into the address bar of an open page.
  window.addEventListener('hashchange', () => applySwitch(window.location.href))
  window.addEventListener('popstate', () => applySwitch(window.location.href))
}

/**
 * `isCuratorMode` for a component: starts curator mode once the component is
 * mounted, after hydration (see above). Use this in every component that
 * shows curator links, instead of importing `isCuratorMode` alone.
 *
 * @returns {import('vue').Ref<boolean>}
 */
export function useCuratorMode() {
  if (getCurrentInstance()) onMounted(startCuratorMode)

  return isCuratorMode
}

export function leaveCuratorMode() {
  try {
    getStorage()?.removeItem(STORAGE_KEY)
  } catch {}

  isCuratorMode.value = false
}

// The TaxonWorks web app, from the API URL.
// (`typeof` keeps the module loadable in node tests, where Vite's define is absent.)
const API_URL = typeof __APP_ENV__ !== 'undefined' ? __APP_ENV__.url : ''
const TW_BASE = String(API_URL || '').replace(/\/api\/v1\/?$/, '')

/**
 * Edit pages in TaxonWorks. Each task reads its record id from the query
 * (checked against the TaxonWorks source, development branch, 2026-10).
 */
export const twEditUrl = {
  source: (id) => `${TW_BASE}/tasks/sources/new_source?source_id=${id}`,
  collectionObject: (id) =>
    `${TW_BASE}/tasks/accessions/comprehensive?collection_object_id=${id}`,
  fieldOccurrence: (id) =>
    `${TW_BASE}/tasks/field_occurrences/new_field_occurrences?field_occurrence_id=${id}`,
  taxonName: (id) =>
    `${TW_BASE}/tasks/nomenclature/new_taxon_name?taxon_name_id=${id}`,
  image: (id) => `${TW_BASE}/tasks/images/browse?image_id=${id}`,
  depiction: (id) => `${TW_BASE}/depictions/${id}/edit`,
  lead: (id) => `${TW_BASE}/tasks/leads/new_lead?lead_id=${id}`,
  biologicalAssociation: (id) =>
    `${TW_BASE}/tasks/biological_associations/new_ba?biological_association_id=${id}`,
  assertedDistribution: (id) =>
    `${TW_BASE}/tasks/asserted_distributions/new_asserted_distribution?asserted_distribution_id=${id}`
}

/** An OTU in TaxonWorks' "Browse OTUs" task (format confirmed by the user). */
export function twOtuUrl(id) {
  return `${TW_BASE}/tasks/otus/browse?otu_id=${id}`
}

/** A key (its root lead) in TaxonWorks' "Use a key" task. */
export function twUseKeyUrl(rootLeadId) {
  return `${TW_BASE}/tasks/leads/show?lead_id=${rootLeadId}`
}

/**
 * A source's own page in TaxonWorks, which lists its attached PDFs (with a
 * viewer). The API never exposes a source's documents, so there is no direct
 * PDF link; see readme.md.
 */
export function twSourcePageUrl(id) {
  return `${TW_BASE}/sources/${id}`
}

/** The record page itself (read-only view) in TaxonWorks. */
export function twRecordUrl(path) {
  return `${TW_BASE}${path}`
}
