import { onBeforeUnmount, onMounted, watch } from 'vue'
import { isCuratorMode, startCuratorMode } from './curatorMode.js'
import { PENCIL_PATH, ICON_PATHS, EDIT_LINK_CLASS, linkClassFor } from './pencilIcon.js'

/**
 * Curator-mode pencils added to a package panel after it has rendered, for
 * the `OverlayPanel<Name>` panels: they render the package panel unchanged
 * and only add these links. See readme.md in this folder.
 *
 * The pencils are plain links carrying `data-tw-edit`, placed right after the
 * element they belong to, and removed again when curator mode is left. If a
 * package update changes the markup an overlay looks for, it finds nothing
 * and adds nothing; the panel itself keeps working.
 */

const MARK = 'data-tw-edit'

export function makePencil(href, iconClass = 'size-3.5') {
  const link = document.createElement('a')

  link.setAttribute(MARK, '')
  link.href = href
  link.target = '_blank'
  link.rel = 'noopener'
  link.title = 'Edit in TaxonWorks'
  link.setAttribute('aria-label', 'Edit in TaxonWorks')
  link.className = `${EDIT_LINK_CLASS} ml-1 align-middle`
  link.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" ' +
    `stroke-width="1.5" stroke="currentColor" class="${iconClass}" aria-hidden="true">` +
    `<path stroke-linecap="round" stroke-linejoin="round" d="${PENCIL_PATH}" /></svg>`

  return link
}

export function isPencil(element) {
  return Boolean(element?.hasAttribute?.(MARK))
}

export function hasPencil(element) {
  return isPencil(element.nextElementSibling)
}

/** Puts a pencil after `element`, unless it has one or has left the page. */
export function addPencil(element, href, iconClass) {
  if (href && element.isConnected && !hasPencil(element)) {
    element.after(makePencil(href, iconClass))
  }
}

const HOST = 'data-tw-edit-host'
const HOST_CLASSES = ['relative', 'pr-16']

function makeLink({ href, icon = 'pencil', title }, iconClass) {
  const link = makePencil(href, iconClass)

  link.className = linkClassFor(icon)
  link.querySelector('path').setAttribute('d', ICON_PATHS[icon] || ICON_PATHS.pencil)
  if (title) {
    link.title = title
    link.setAttribute('aria-label', title)
  }

  return link
}

export function hasRowPencil(row) {
  return Boolean(row.querySelector(`:scope > [${MARK}]`))
}

/**
 * Puts links (`{ href, icon, title }`, left to right) at the right end of
 * `row`, vertically centred: the row gets room on the right and the links sit
 * there, absolutely positioned. Undone by `removePencils`.
 */
export function addRowLinks(row, links, iconClass = 'size-4') {
  const shown = links.filter((link) => link?.href)

  if (!shown.length || !row.isConnected || hasRowPencil(row)) return

  const box = document.createElement('span')

  box.setAttribute(MARK, '')
  box.className = 'absolute right-5 top-1/2 -translate-y-1/2 flex items-center gap-2'
  shown.forEach((link) => box.append(makeLink(link, iconClass)))
  row.setAttribute(HOST, '')
  row.classList.add(...HOST_CLASSES)
  row.append(box)
}

/** One pencil at the right end of `row`, see `addRowLinks`. */
export function addRowPencil(row, href, iconClass) {
  addRowLinks(row, [{ href }], iconClass)
}

export function removePencils(root) {
  root.querySelectorAll(`[${MARK}]`).forEach((pencil) => pencil.remove())
  root.querySelectorAll(`[${HOST}]`).forEach((row) => {
    row.classList.remove(...HOST_CLASSES)
    row.removeAttribute(HOST)
  })
}

/**
 * Runs `decorate(root)` on the panel under `rootRef` while curator mode is
 * on: once, and again a moment after each change of its HTML (panels load
 * and expand after the first render). `decorate` must skip what already has
 * a pencil: adding one is a change too, which then finds nothing new.
 *
 * @param {import('vue').Ref<Element>} rootRef
 * @param {(root: Element) => void} decorate
 */
export function useOverlayPencils(rootRef, decorate) {
  let observer = null
  let timer = null

  function update() {
    const root = rootRef.value

    if (!root) return
    if (isCuratorMode.value) decorate(root)
    else removePencils(root)
  }

  function scheduleUpdate() {
    clearTimeout(timer)
    timer = setTimeout(update, 50)
  }

  function observe(isOn) {
    observer?.disconnect()
    observer = null

    if (isOn && rootRef.value && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(scheduleUpdate)
      observer.observe(rootRef.value, { childList: true, subtree: true })
    }

    scheduleUpdate()
  }

  onMounted(() => {
    startCuratorMode()
    watch(isCuratorMode, observe, { immediate: true })
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    clearTimeout(timer)
  })
}
