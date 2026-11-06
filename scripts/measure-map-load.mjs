// Measures how long the species map (PanelMapV2) takes to draw, in a real
// browser: headless Chromium, browser cache off, one fresh page load per
// species. Reports when the first area or marker appears, when the map is
// complete, how many map layers it has, and whether the slow
// distribution.geojson request was used. Results are compared in
// panels/PanelMapV2/load-times.md.
//
//   node scripts/measure-map-load.mjs                        # local dev server
//   node scripts/measure-map-load.mjs --base https://example.org/
//   node scripts/measure-map-load.mjs --base … 723601 729972  # other species
//
// Needs Chromium (CHROMIUM env var, else `chromium` on the PATH). Pages are
// opened as <base>#/otus/<id>/overview (hash routing).

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The species of the first measurement (2026-11-06), see load-times.md.
const DEFAULT_OTUS = [723601, 729972, 732706, 730565, 738662]
const WAIT_MS = 25000
const PORT = 9334

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const base = (baseIndex >= 0 ? args[baseIndex + 1] : 'http://localhost:5173/').replace(/\/?$/, '/')
const otus = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--base').map(Number)

const profile = mkdtempSync(join(tmpdir(), 'map-load-'))
const browser = spawn(
  process.env.CHROMIUM || 'chromium',
  ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'],
  { stdio: 'ignore' }
)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let tabs = null

for (let i = 0; i < 50 && !tabs; i++) {
  await wait(200)
  tabs = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => null)
}

const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)

await new Promise((resolve) => (ws.onopen = resolve))

let id = 0
let slowRequests = 0
const pending = {}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)

  if (
    message.method === 'Network.requestWillBeSent' &&
    message.params.request.url.includes('distribution.geojson')
  ) {
    slowRequests++
  }
  if (pending[message.id]) {
    pending[message.id](message.result)
    delete pending[message.id]
  }
}

const send = (method, params = {}) =>
  new Promise((resolve) => {
    pending[++id] = resolve
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value

await send('Network.enable')
await send('Page.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })

// Samples the number of map layers (area paths + markers) every 50 ms.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__layers = []; const t0 = performance.now(); const timer = setInterval(() => {
    const n = document.querySelectorAll('.leaflet-overlay-pane path').length + document.querySelectorAll('.leaflet-marker-pane > *').length
    const last = __layers[__layers.length - 1]
    if (!last || last[1] !== n) __layers.push([Math.round(performance.now() - t0), n])
    if (performance.now() - t0 > ${WAIT_MS}) clearInterval(timer)
  }, 50)`
})

const open = async (url) => {
  await send('Page.navigate', { url: 'about:blank' })
  await wait(300)
  await send('Page.navigate', { url })
}

console.log(`${base} (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`)

// One page first, so the app's own files are loaded before measuring.
await open(`${base}#/otus/720718/overview`)
await wait(12000)

for (const otu of otus.length ? otus : DEFAULT_OTUS) {
  slowRequests = 0
  await open(`${base}#/otus/${otu}/overview`)
  await wait(WAIT_MS)

  const samples = JSON.parse(await evaluate('JSON.stringify(window.__layers)'))
  const drawn = samples.filter(([, n]) => n > 0)
  const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

  console.log(
    `  ${otu}: first ${drawn.length ? seconds(drawn[0][0]) : '-'}, ` +
      `complete ${drawn.length ? seconds(drawn[drawn.length - 1][0]) : '-'}, ` +
      `${drawn.length ? drawn[drawn.length - 1][1] : 0} layers, ` +
      `distribution.geojson ${slowRequests ? 'used' : 'not used'}`
  )
}

ws.close()
browser.kill()
await new Promise((resolve) => browser.once('exit', resolve))

// Chromium's helper processes can still be writing to the profile; it is a
// temporary folder either way.
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
} catch {}
