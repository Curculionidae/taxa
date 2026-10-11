const SESSION_COOKIE = 'taxonpages_relationship_session'

// Nomenclatural codes distinguish plants/animals without guessing from the
// association direction. Unknown groups stay isolated to their own taxon page.
export function advancedScope(taxon, taxonId) {
  const rank = taxon?.rank || taxon?.rank_string?.split('::').at(-1)
  const code = (taxon?.nomenclatural_code || taxon?.rank_string || '').toLowerCase()
  const group = /iczn/.test(code) ? 'animals' : /icn(?!p)/.test(code) ? 'plants' : `taxon-${taxonId}`
  return `${group}:${String(rank || taxonId).toLowerCase()}`
}

function sessionToken(browser) {
  return browser.document.cookie.split(/;\s*/)
    .find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1)
}

// Only a session token lives in the cookie. Larger table settings remain in
// localStorage, but cannot be restored after that browser session expires.
export function readBrowserSession(key, browser = globalThis) {
  try {
    const session = sessionToken(browser)
    if (!session) return null
    const saved = JSON.parse(browser.localStorage.getItem(key))
    return saved?.session === session ? saved.preferences : null
  } catch {
    return null
  }
}

export function writeBrowserSession(key, preferences, browser = globalThis) {
  try {
    let session = sessionToken(browser)
    if (!session) {
      session = browser.crypto.randomUUID?.()
        || Array.from(browser.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
      browser.document.cookie = `${SESSION_COOKIE}=${session}; Path=/; SameSite=Lax${browser.location?.protocol === 'https:' ? '; Secure' : ''}`
    }
    browser.localStorage.setItem(key, JSON.stringify({ session, preferences }))
  } catch {
    // Blocking browser storage must not prevent local table interaction.
  }
}
