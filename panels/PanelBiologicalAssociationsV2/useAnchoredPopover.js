import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** Position a body-teleported overlay within the visible viewport. */
export function popoverPosition(anchor, box, viewport, align = 'start') {
  const preferredLeft = align === 'end' ? anchor.right - box.width : anchor.left
  const left = Math.max(16, Math.min(preferredLeft, viewport.width - box.width - 16))
  const below = anchor.bottom + 8
  const top = below + box.height <= viewport.height - 16
    ? below : Math.max(16, anchor.top - box.height - 8)
  return { left: `${left}px`, top: `${top}px` }
}

/** Shared positioning and dismissal for header help and the relationship
 * selection. Teleport escapes the panel/table scroll containers, while the
 * trigger stays in the normal responsive layout.
 *
 * `closeOnScroll` (the default) dismisses the overlay as soon as anything
 * outside it scrolls -- right for a help bubble, wrong for a menu that
 * collects a draft selection: the Advanced table is its own scroll container,
 * so one wheel tick on the way to Apply used to throw the tick boxes away.
 * With `closeOnScroll: false` the overlay follows its trigger instead, and
 * only closes once the trigger has scrolled clear out of the viewport.
 */
export function useAnchoredPopover(visible, close, align = 'start', closeOnScroll = true) {
  const trigger = ref(null)
  const overlay = ref(null)
  const position = ref({ left: '16px', top: '16px' })
  let observer
  let frame = 0
  const triggerElement = () => trigger.value?.$el || trigger.value

  async function reposition() {
    await nextTick()
    if (!visible.value || !triggerElement() || !overlay.value) return
    const anchor = triggerElement().getBoundingClientRect()
    // A menu that stays open while the page scrolls must not keep hanging at
    // the clamped viewport edge once its button is gone -- nothing would tell
    // the reader what it belongs to.
    if (!closeOnScroll && (anchor.bottom <= 0 || anchor.top >= window.innerHeight)) return close()
    position.value = popoverPosition(
      anchor, overlay.value.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight }, align
    )
  }

  /** One reposition per frame; scroll fires far more often than that. */
  function scheduleReposition() {
    if (frame || typeof requestAnimationFrame === 'undefined') return
    frame = requestAnimationFrame(() => { frame = 0; reposition() })
  }

  function outsideClick(event) {
    if (!triggerElement()?.contains(event.target) && !overlay.value?.contains(event.target)) close()
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close()
  }

  function onScroll(event) {
    if (overlay.value?.contains(event.target)) return
    if (closeOnScroll) close()
    else scheduleReposition()
  }

  function onResize() {
    if (closeOnScroll) close()
    else scheduleReposition()
  }

  watch([visible, overlay], () => {
    observer?.disconnect()
    if (visible.value && overlay.value) observer?.observe(overlay.value)
    reposition()
  }, { flush: 'post' })
  onMounted(() => {
    if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(reposition)
    document.addEventListener('pointerdown', outsideClick)
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    if (frame) cancelAnimationFrame(frame)
    document.removeEventListener('pointerdown', outsideClick)
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('scroll', onScroll, true)
  })
  return { trigger, overlay, position }
}
