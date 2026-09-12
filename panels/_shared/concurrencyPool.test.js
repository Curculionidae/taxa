import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPool } from './concurrencyPool.js'

test('mapPool: processes every item', async () => {
  const seen = []
  await mapPool([1, 2, 3, 4], 2, async (n) => { seen.push(n) })
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4])
})

test('mapPool: never runs more than `limit` concurrently', async () => {
  let active = 0
  let maxActive = 0
  await mapPool(
    Array.from({ length: 10 }, (_, i) => i),
    3,
    async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 1))
      active--
    }
  )
  assert.ok(maxActive <= 3, `expected max 3 concurrent, saw ${maxActive}`)
})

test('mapPool: shouldStop halts before the next item, in-flight items still finish', async () => {
  const processed = []
  let stop = false
  await mapPool(
    [1, 2, 3, 4, 5],
    1, // concurrency 1 makes the stop point deterministic
    async (n) => {
      processed.push(n)
      if (n === 2) stop = true
    },
    () => stop
  )
  // item 1 runs, then item 2 runs and sets stop=true, then the pool checks
  // shouldStop before grabbing item 3 and returns.
  assert.deepEqual(processed, [1, 2])
})

test('mapPool: empty items array resolves immediately', async () => {
  let called = false
  await mapPool([], 4, async () => { called = true })
  assert.equal(called, false)
})
