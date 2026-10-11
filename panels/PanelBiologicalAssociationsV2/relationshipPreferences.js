import { readBrowserSession, writeBrowserSession } from './browserSessionStorage.js'

const SESSION_STORAGE_KEY = 'taxonpages:relationship-session-preferences'

// A session cookie is shared by tabs, unlike sessionStorage. The larger
// preference map stays in localStorage but is valid only for that session.
export function readSessionRelationshipPreferences(browser = globalThis) {
  try {
    const preferences = readBrowserSession(SESSION_STORAGE_KEY, browser)
    if (!preferences || Array.isArray(preferences)) return {}
    return Object.fromEntries(Object.entries(preferences)
      .filter(([, value]) => typeof value === 'boolean'))
  } catch {
    return {}
  }
}

export function writeSessionRelationshipPreferences(preferences, browser = globalThis) {
  writeBrowserSession(SESSION_STORAGE_KEY, preferences, browser)
}

export function relationshipSelectedByDefault(relationship) {
  return !/(?:legacy|undefined relationship)/i.test(relationship)
}

export function selectedRelationshipsForOptions(options, preferences = {}) {
  return options.filter(relationship =>
    typeof preferences[relationship] === 'boolean'
      ? preferences[relationship]
      : relationshipSelectedByDefault(relationship)
  )
}

export function updateRelationshipPreferences(options, selectedRelationships, preferences = {}) {
  const selected = new Set(selectedRelationships)
  return Object.fromEntries([
    ...Object.entries(preferences),
    ...options.map(relationship => [relationship, selected.has(relationship)])
  ])
}

/**
 * Biological-association index rows expose only the relationship name. Build
 * the name-to-id lookup once from /biological_relationships so the Expert
 * endpoint can apply its native biological_relationship_id[] filter before
 * pagination. Keep arrays because TaxonWorks does not require names to be
 * unique across independently created relationship records.
 */
export function indexRelationshipIds(relationships = []) {
  const idsByName = new Map()
  for (const relationship of relationships) {
    const name = relationship?.name?.trim?.()
    if (!name || relationship?.id == null) continue
    if (!idsByName.has(name)) idsByName.set(name, [])
    const ids = idsByName.get(name)
    if (!ids.includes(relationship.id)) ids.push(relationship.id)
  }
  return idsByName
}

export function relationshipIdsForSelection(selectedRelationships, idsByName) {
  return [...new Set(
    selectedRelationships.flatMap(name => idsByName.get(name) || [])
  )]
}
