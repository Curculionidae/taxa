/**
 * concurrencyPool.js
 *
 * A small worker-pool: runs `fn` over `items` with at most `limit` concurrent
 * calls in flight, rather than a plain `Promise.all(items.map(fn))` (which
 * would fire every item's request simultaneously, risking 429s or per-origin
 * connection queuing for a large item list).
 *
 * `shouldStop`, checked before each item, lets a caller abandon the remaining
 * queue once its result is no longer wanted (e.g. a newer request superseded
 * this one). An item already in flight is allowed to finish naturally; only
 * the next item is skipped.
 *
 * Depended on by:
 *   - ./fetchAllPages.js
 *   - ../PanelSpecimenOccurrences/components/SpeciesBars.vue
 *   - ../../modules/keys/composables/useKeyGeography.js
 *
 * If you change this file, sanity-check all three call sites.
 */

/**
 * @param {Array} items
 * @param {number} limit - max concurrent `fn` calls
 * @param {(item: any) => Promise<void>} fn
 * @param {() => boolean} [shouldStop]
 * @returns {Promise<void>}
 */
export async function mapPool(items, limit, fn, shouldStop) {
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      if (shouldStop?.()) return
      await fn(items[i++])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
