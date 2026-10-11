import { readBrowserSession, writeBrowserSession } from './browserSessionStorage.js'

const VIEW_MODE_KEY = 'taxonpages:biological-associations:view'

/** The three views, in the order their buttons appear. `standard` is the
 *  Field Assistant; the code name stayed after the label was changed. */
export const VIEW_MODES = Object.freeze(['standard', 'advanced', 'expert'])

export const VIEW_MODE_LABELS = Object.freeze({
  standard: 'Field Assistant',
  advanced: 'Advanced',
  expert: 'Raw data'
})

export const DEFAULT_VIEW_MODE = 'standard'

/**
 * The view the reader last chose, for the next taxon page and the next tab.
 * Someone comparing two taxa in Advanced should not have to reselect it on
 * every page, and the same session cookie that validates the Advanced column
 * settings validates this: it is shared between tabs, and it expires with the
 * browser session rather than following the reader indefinitely.
 *
 * Anything but a mode this panel still has falls back to the Field Assistant,
 * so a renamed or dropped view cannot leave the panel with no table at all.
 */
export function readViewMode(browser = globalThis) {
  const mode = readBrowserSession(VIEW_MODE_KEY, browser)
  return VIEW_MODES.includes(mode) ? mode : DEFAULT_VIEW_MODE
}

export function writeViewMode(mode, browser = globalThis) {
  if (VIEW_MODES.includes(mode)) writeBrowserSession(VIEW_MODE_KEY, mode, browser)
}
