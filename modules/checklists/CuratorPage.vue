<!--
  Curator page of the country checklists (route checklists-curator,
  /checklists/curator): look up one record or area and see where it lands,
  how, and both outlines on a map.

  Shown in curator mode only (panels/_shared/curatorMode/, ?curator=1);
  otherwise a short note. The lookup is in the route query, ?lookup=AD%20556796,
  so a lookup can be linked and reloaded (works with and without hash mode).

  How a lookup runs
    1. parseLookup (placement/format.js) reads the text; anything else gives a
       plain message naming the accepted forms.
    2. lookupLive (placement/live.js) fetches the record from TaxonWorks.
    3. placeRecord (placement/engine.js) places it with the engine context made
       from the cache files only (placement/geometry-browser.js,
       loadCacheContext: context.json and rules.json), so the decision equals
       the build's; formatExplanation writes it as the build's --explain does.
    4. The cache is asked whether it lists the record (the checklist file of the
       result, else unplaced.json; live.js cacheStatus). For an area, its row
       in areas.json.
    5. PlacementMap shows the record's own outline (or point) and the outline
       the placement chose.
  Cache files are fetched once per visit; outlines only when needed.
-->
<template>
  <main class="min-h-screen bg-base-background text-base-content">
    <header class="border-b border-base-border/40 bg-base-foreground">
      <div class="container mx-auto box-border flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
        <h1 class="text-2xl font-bold">
          How records are placed
        </h1>
        <p class="text-sm text-base-content/70">
          Look up a record or area to see which country checklist it lands in, each step of the decision and its source.
        </p>
        <RouterLink
          :to="{ name: 'checklists' }"
          class="text-sm text-secondary hover:underline"
        >
          Country checklists
        </RouterLink>
      </div>
    </header>

    <div class="container mx-auto box-border flex min-w-0 flex-col gap-4 px-4 py-4">
      <p
        v-if="!isCuratorMode"
        class="rounded-lg border border-base-border bg-base-foreground p-4 text-sm"
      >
        Open this page with ?curator=1
      </p>

      <template v-else>
        <div class="rounded-lg border border-base-border bg-base-foreground p-4">
          <PlacementLookup
            :initial="lookupText"
            :busy="busy"
            :result="result"
            @find="find"
          />
        </div>

        <div
          v-if="result && !result.error"
          class="rounded-lg border border-base-border bg-base-foreground p-4"
        >
          <PlacementMap
            :own="mapLayers.own"
            :assigned="mapLayers.assigned"
            :own-kind="mapLayers.ownKind"
          />
        </div>
      </template>
    </div>
  </main>
</template>

<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { parseLookup, formatExplanation } from './placement/format.js'
import { placeRecord } from './placement/engine.js'
import { loadCacheContext, siteFetchJson } from './placement/geometry-browser.js'
import { lookupLive, cacheStatus } from './placement/live.js'
import { expandChecklist } from './data/compact.js'
import { useCuratorMode, twEditUrl, twRecordUrl, twOtuUrl } from '../../panels/_shared/curatorMode/curatorMode.js'
import PlacementLookup from './components/PlacementLookup.vue'
import PlacementMap from './components/PlacementMap.vue'

const { base_url = '/' } = __APP_ENV__

const isCuratorMode = useCuratorMode()
const route = useRoute()
const router = useRouter()
const fetchJson = siteFetchJson(base_url)

const busy = ref(false)
const result = shallowRef(null)
const mapLayers = shallowRef({ own: null, assigned: null, ownKind: null })
const lookupText = computed(() => String(route.query.lookup ?? ''))

// Cache files, each fetched once per visit.
const once = new Map()
const load = (key, fn) => {
  if (!once.has(key)) once.set(key, fn().catch((error) => { once.delete(key); throw error }))
  return once.get(key)
}
const cacheContext = () => load('context', () => loadCacheContext({ fetchJson }))
const indexFile = () => load('index', () => fetchJson('checklists/index.json'))
const unplacedFile = () => load('unplaced', () => fetchJson('checklists/unplaced.json'))
const areasFile = () => load('areas', () => fetchJson('checklists/areas.json'))
const countryRecords = (file) => load(`country:${file}`, async () => expandChecklist(await fetchJson(`checklists/countries/${file}`)))

const INVALID = 'Type a kind and an id: GA, GZ, AD, CO or FO, for example AD 556796, GZ 10453 or CO 1385165.'
const SHAPE_KIND = { GA: 'GeographicArea', GZ: 'Gazetteer' }

// Find puts the lookup into the address; the same lookup again runs it again
// (a curator checking a record right after fixing it in TaxonWorks).
function find(text) {
  const lookup = String(text ?? '').trim()
  if (lookup === lookupText.value) runLookup(lookup)
  else router.push({ query: { ...route.query, lookup } })
}

// Every change of ?lookup= runs the lookup (also the first visit and reloads).
let run = 0
watch([lookupText, isCuratorMode], () => {
  if (isCuratorMode.value && lookupText.value) runLookup(lookupText.value)
}, { immediate: true })

async function runLookup(text) {
  const current = ++run
  const parsed = parseLookup(text)
  if (!parsed) {
    result.value = { error: `"${text}" is not a lookup. ${INVALID}` }
    busy.value = false
    return
  }
  busy.value = true
  try {
    const areaLookup = parsed.kind === 'GA' || parsed.kind === 'GZ'
    const [{ ctx, context }, areas] = await Promise.all([cacheContext(), areaLookup ? areasFile() : null])
    const live = await lookupLive(parsed, undefined, { areas: areas ?? [] })
    if (current !== run) return
    if (live.error) {
      result.value = errorResult(parsed, live)
      return
    }
    const placement = await placeRecord(live.record, ctx, live.area)
    const status = areaLookup ? areaStatus(areas, live.area) : await recordStatus(parsed, live, placement)
    const layers = await layersOf(live, placement, ctx, context)
    if (current !== run) return
    result.value = {
      text: formatExplanation(live.subject, placement),
      links: linksOf(parsed, live),
      status,
      notes: layers.notes
    }
    mapLayers.value = layers
  } catch (error) {
    if (current === run) result.value = { error: `The lookup failed: ${error?.message || error}` }
  } finally {
    if (current === run) busy.value = false
  }
}

function errorResult({ kind, id }, live) {
  if (live.error === 'used by no record') {
    const name = live.stub ? `${live.stub.name} (${kind} ${id})` : `${kind} ${id}`
    const details = live.stub?.children.length
      ? [`It is the parent of ${live.stub.children.map((child) => `${child.name} (${child.key})`).join(', ')}.`]
      : []
    return { error: `${name} is used by no record, so TaxonWorks gives nothing to place.`, details }
  }
  return { error: live.error }
}

// What the cache says about a record: its checklist file, else unplaced.json.
async function recordStatus({ kind, id }, live, placement) {
  const [index, unplaced] = await Promise.all([indexFile(), unplacedFile()])
  const name = placement.checklist?.name ?? null
  const entry = name ? index.countries.find((country) => country.name === name) : null
  const records = entry ? await countryRecords(entry.file) : null
  return cacheStatus({ kind, id, dwc: live.dwc ?? null, absent: live.absent }, { checklistName: name, records, unplaced })
}

// What the cache says about an area: its row in areas.json.
function areaStatus(areas, area) {
  const row = areas?.find((entry) => entry.key === area.key)
  if (!row?.placement) return { listed: false, text: 'not in the cache (no record used this area when it was built)' }
  const { checklist, part, state } = row.placement
  const count = `${row.records} ${row.records === 1 ? 'record' : 'records'} on this area`
  if (!checklist) return { listed: false, text: `not listed: ${row.placement.reason} (${count})` }
  const extra = [part && `part ${part}`, state && `state ${state}`].filter(Boolean)
  return { listed: true, text: `listed in ${checklist.name}${extra.length ? `, ${extra.join(', ')}` : ''} (${count})` }
}

function linksOf({ kind, id }, live) {
  const links = []
  if (kind === 'AD') links.push({ label: `Edit AD ${id} in TaxonWorks`, href: twEditUrl.assertedDistribution(id) })
  if (kind === 'CO') links.push({ label: `Edit CO ${id} in TaxonWorks`, href: twEditUrl.collectionObject(id) })
  if (kind === 'FO') links.push({ label: `Edit FO ${id} in TaxonWorks`, href: twEditUrl.fieldOccurrence(id) })
  if (live.area) {
    const path = live.area.kind === 'GZ' ? `/gazetteers/${live.area.id}` : `/geographic_areas/${live.area.id}`
    links.push({ label: `${live.area.name} (${live.area.key}) in TaxonWorks`, href: twRecordUrl(path) })
  }
  if (live.otuId) links.push({ label: `OTU ${live.otuId} in TaxonWorks`, href: twOtuUrl(live.otuId) })
  return links
}

// The two map layers, and a note for each one that has nothing to show.
async function layersOf(live, placement, ctx, context) {
  const notes = []
  const geometry = ctx.geometry
  let own = null
  if (live.area) {
    const key = `${SHAPE_KIND[live.area.kind]}/${live.area.id}`
    const polygons = ctx.shapes.has(key) ? await geometry.outlinePolygons(key) : null
    if (polygons?.length) own = { label: `${live.area.name} (${live.area.key}), the record's area`, polygons }
    else notes.push(`No outline cached for ${live.area.name} (${live.area.key}).`)
  } else {
    const lat = Number(live.record.lat)
    const lng = Number(live.record.lng)
    const hasPoint = String(live.record.lat ?? '').trim() !== '' && String(live.record.lng ?? '').trim() !== '' && Number.isFinite(lat) && Number.isFinite(lng)
    if (hasPoint) own = { label: `coordinates ${lat}, ${lng}`, point: [lat, lng] }
    else notes.push('The record has no coordinates to show on the map.')
  }

  let assigned = null
  if (placement.checklist) {
    const fallback = context.outlines.find((outline) => outline.id === placement.checklist.id)?.outline
    const key = placement.shape?.key ?? (fallback?.startsWith('fallback/') ? fallback : null)
    const polygons = key ? await geometry.outlinePolygons(key) : null
    const name = placement.shape?.name ?? placement.checklist.name
    if (polygons?.length) assigned = { label: `${name}, where the placement puts it${placement.shape ? '' : ' (fallback outline)'}`, polygons }
    else notes.push(`No outline cached for ${placement.checklist.name}.`)
  }
  return { own, assigned, ownKind: live.record.type === 'FieldOccurrence' ? 'FieldOccurrence' : 'CollectionObject', notes }
}
</script>
