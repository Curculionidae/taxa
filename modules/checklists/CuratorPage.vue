<!--
  Curator page of the country checklists (route checklists-curator,
  /checklists/curator): where records land, why, and what the build made.

  Shown in curator mode only (panels/_shared/curatorMode/, ?curator=1);
  otherwise a short note. Five tabs, the active one in ?tab= (none for the
  lookup), each starting with one line on what it is based on (the build
  date is index.json `updated`):
    Record or area  (no ?tab)      look up one record or area (below); live
    OTU             ?tab=otu       every record of one OTU, placed live
                                   (components/OtuPlacements.vue, ?otu=<id>)
    Area tree       ?tab=areas     areas.json as a tree (components/AreaTree.vue)
    Not placed      ?tab=unplaced  unplaced.json by reason (components/UnplacedList.vue)
    Rules           ?tab=rules     rules.json and the copy of placement.yml
                                   (components/RulesView.vue); the route hash
                                   #L<N> marks a line, the target of every
                                   placement.yml:N link on the page
                                   (components/RefText.vue)
  A row clicked in the OTU, tree or unplaced list opens the lookup tab with
  ?lookup=<KIND> <id>. The cache files are fetched once per visit and shared
  with the tabs through `cache`.

  The lookup is in the route query, ?lookup=AD%20556796, so a lookup can be
  linked and reloaded (works with and without hash mode).

  How a lookup runs
    1. parseLookup (placement/format.js) reads the text; anything else gives a
       plain message naming the accepted forms.
    2. lookupLive (placement/live.js) fetches the record from TaxonWorks.
    3. placeLive (placement/live.js, placeRecord of placement/engine.js)
       places it with the engine context made from the cache files only
       (placement/geometry-browser.js, loadCacheContext: context.json and
       rules.json), so the decision equals the build's; formatExplanation
       writes it as the build's --explain does.
    4. The cache is asked whether it lists the record (the checklist file of the
       result, else unplaced.json; live.js cacheStatus). For an area, its row
       in areas.json. When the live result differs from the cache
       (overview.js differsFromCache), a line says to rebuild.
    5. PlacementMap shows the record's own outline (or point) and the outline
       the placement chose.
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
        <div class="rounded-lg border border-base-border bg-base-foreground px-4 pt-1">
          <div
            class="flex flex-wrap border-b border-base-border/60"
            role="tablist"
            aria-label="Curator views"
            @keydown="onTabKey"
          >
            <button
              v-for="item in TABS"
              :id="`curator-tab-${item.id}`"
              :key="item.id"
              :ref="(el) => { if (el) tabButtons[item.id] = el }"
              class="border-b-2 px-3 py-2 text-sm font-medium"
              :class="tab === item.id ? 'border-secondary text-base-content' : 'border-transparent text-base-content/60 hover:text-base-content'"
              type="button"
              role="tab"
              :aria-selected="tab === item.id"
              :tabindex="tab === item.id ? 0 : -1"
              :aria-controls="tab === item.id ? `curator-panel-${item.id}` : undefined"
              @click="selectTab(item.id)"
            >
              {{ item.label }}
            </button>
          </div>
          <p
            class="py-2 text-sm text-base-soft"
          >
            {{ basis || '\u00a0' }}
          </p>
        </div>

        <section
          :id="`curator-panel-${tab}`"
          role="tabpanel"
          :aria-labelledby="`curator-tab-${tab}`"
          class="flex min-w-0 flex-col gap-4"
        >

          <template v-if="tab === 'lookup'">
            <div class="rounded-lg border border-base-border bg-base-foreground p-4">
              <PlacementLookup
                :initial="lookupText"
                :busy="busy"
                :result="result"
                @find="find"
              />
            </div>

            <!-- The map box is kept while a lookup runs (no jump when the result
                 arrives) and shows that it is loading. -->
            <div
              v-if="busy || (result && !result.error)"
              class="rounded-lg border border-base-border bg-base-foreground p-4"
            >
              <PlacementMap
                :own="mapLayers.own"
                :assigned="mapLayers.assigned"
                :own-kind="mapLayers.ownKind"
                :loading="busy"
              />
            </div>
          </template>

          <div
            v-else
            class="rounded-lg border border-base-border bg-base-foreground p-4"
          >
            <OtuPlacements
              v-if="tab === 'otu'"
              :otu-id="otuId"
              :cache="cache"
              :built="built"
              @select-otu="selectOtu"
              @lookup="lookUp"
            />
            <AreaTree
              v-else-if="tab === 'areas'"
              :load-areas="cache.areas"
              @lookup="lookUp"
            />
            <UnplacedList
              v-else-if="tab === 'unplaced'"
              :load-unplaced="cache.unplaced"
              :load-areas="cache.areas"
              @lookup="lookUp"
            />
            <RulesView
              v-else-if="tab === 'rules'"
              :load-rules="cache.rules"
              :load-rules-text="cache.rulesText"
            />
          </div>
        </section>
      </template>
    </div>
  </main>
</template>

<script setup>
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { parseLookup, formatExplanation } from './placement/format.js'
import { loadCacheContext, siteFetchJson } from './placement/geometry-browser.js'
import { lookupLive, cacheStatus, placeLive, otuLeftOut } from './placement/live.js'
import { makeAPIRequest } from '@/utils/request'
import { cachedPlacement, differsFromCache } from './placement/overview.js'
import { recordLocation } from './placement/engine.js'
import { expandChecklist } from './data/compact.js'
import { useCuratorMode, twEditUrl, twRecordUrl, twOtuUrl } from '../../panels/_shared/curatorMode/curatorMode.js'
import PlacementLookup from './components/PlacementLookup.vue'
import PlacementMap from './components/PlacementMap.vue'
import OtuPlacements from './components/OtuPlacements.vue'
import AreaTree from './components/AreaTree.vue'
import UnplacedList from './components/UnplacedList.vue'
import RulesView from './components/RulesView.vue'

const { base_url = '/' } = __APP_ENV__

const isCuratorMode = useCuratorMode()
const route = useRoute()
const router = useRouter()
const fetchJson = siteFetchJson(base_url)

const busy = ref(false)
const result = shallowRef(null)
const mapLayers = shallowRef({ own: null, assigned: null, ownKind: null })
const lookupText = computed(() => String(route.query.lookup ?? ''))

// Tabs: the active one is ?tab= (the lookup when absent), like ?lookup=.
const TABS = [
  { id: 'lookup', label: 'Record or area' },
  { id: 'otu', label: 'OTU' },
  { id: 'areas', label: 'Area tree' },
  { id: 'unplaced', label: 'Not placed' },
  { id: 'rules', label: 'Rules' }
]
const tab = computed(() => (TABS.some((item) => item.id === route.query.tab) ? route.query.tab : 'lookup'))
const otuId = computed(() => (/^\d+$/.test(String(route.query.otu ?? '')) ? Number(route.query.otu) : null))
const tabButtons = {}

function selectTab(id) {
  const query = { ...route.query, tab: id === 'lookup' ? undefined : id }
  router.push({ query })
}

// Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
function onTabKey(event) {
  const index = TABS.findIndex((item) => item.id === tab.value)
  const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }
  if (!(event.key in moves)) return
  event.preventDefault()
  const next = TABS[(moves[event.key] + TABS.length) % TABS.length].id
  selectTab(next)
  nextTick(() => tabButtons[next]?.focus())
}

function selectOtu(id) {
  router.push({ query: { ...route.query, otu: String(id) } })
}

// A row clicked in any list: look it up in the lookup tab.
function lookUp(text) {
  router.push({ query: { ...route.query, tab: undefined, lookup: text } })
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
}

// The build date (index.json updated) and what each tab is based on.
const built = ref('')
const basis = computed(() => {
  if (!built.value) return ''
  return tab.value === 'lookup' || tab.value === 'otu'
    ? `Live from TaxonWorks, placed with the rules and data of the build of ${built.value}.`
    : `As built on ${built.value}.`
})

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
const rulesFile = () => load('rules', () => fetchJson('checklists/rules.json'))
// The rules file as the build copied it, as text.
const rulesText = () => load('rulesText', async () => {
  const base = base_url.endsWith('/') ? base_url : `${base_url}/`
  const response = await fetch(`${base}checklists/placement.yml`)
  if (!response.ok) throw new Error(`could not load checklists/placement.yml (${response.status})`)
  return response.text()
})

// The cache files for the tabs, each a function giving a promise.
const cache = {
  context: cacheContext,
  index: indexFile,
  unplaced: unplacedFile,
  areas: areasFile,
  rules: rulesFile,
  rulesText,
  countryRecords
}

watch(isCuratorMode, (on) => {
  if (on && !built.value) indexFile().then((index) => { built.value = index.updated ?? '' }).catch(() => {})
}, { immediate: true })

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
  // The layers of the last lookup would stand for this one while it loads.
  mapLayers.value = { own: null, assigned: null, ownKind: null }
  try {
    const areaLookup = parsed.kind === 'GA' || parsed.kind === 'GZ'
    const [{ ctx, context }, areas] = await Promise.all([cacheContext(), areaLookup ? areasFile() : null])
    const live = await lookupLive(parsed, undefined, { areas: areas ?? [] })
    if (current !== run) return
    if (live.error) {
      result.value = errorResult(parsed, live)
      return
    }
    const placement = await placeLive(live, ctx)
    const status = areaLookup ? areaStatus(areas, live.area, placement) : await recordStatus(parsed, live, placement)
    const index = await indexFile()
    const layers = await layersOf(live, placement, ctx, context)
    if (current !== run) return
    result.value = {
      text: formatExplanation(live.subject, placement),
      links: linksOf(parsed, live),
      status,
      differs: status.differs ? `Differs from the cache (built ${index.updated}): rebuild the checklists to update.` : '',
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

// What the cache says about a record: its checklist file, else unplaced.json;
// and whether the live placement differs from it. A record the build leaves
// out (absent, rank genus) never differs.
async function recordStatus({ kind, id }, live, placement) {
  const [index, unplaced] = await Promise.all([indexFile(), unplacedFile()])
  const name = placement.checklist?.name ?? null
  const entry = name ? index.countries.find((country) => country.name === name) : null
  const records = entry ? await countryRecords(entry.file) : null
  let status = cacheStatus({ kind, id, dwc: live.dwc ?? null, absent: live.absent, typeReason: live.typeReason ?? null }, { checklistName: name, records, unplaced })
  // A record the cache does not list may belong to an OTU the build leaves
  // out (a genus, a host plant, whose specimens have no superfamily in their
  // DwC row): ask TaxonWorks for the OTU's rank and parents.
  if (!status.listed && status.text === 'not listed in the cache' && live.otuId) {
    const reason = await otuReason(live.otuId)
    if (reason) status = { listed: false, text: `not listed: ${reason}`, leftOut: true }
  }
  const leftOut = live.absent || status.leftOut
  const differs = !leftOut && differsFromCache(placement, cachedPlacement({ kind, id }, { checklistName: name, records, unplaced }))
  return { ...status, differs }
}

// Why the build leaves out the distributions of an OTU (live.js otuLeftOut), or null.
async function otuReason(otuId) {
  try {
    const { data } = await makeAPIRequest.get(`/otus/${otuId}`, { params: { extend: ['parents'] } })
    const rank = data.taxon_name_id ? (await makeAPIRequest.get(`/taxon_names/${data.taxon_name_id}`)).data.rank ?? null : null
    return otuLeftOut({ rank, parentNames: Object.keys(data.parents ?? {}) })
  } catch {
    return null
  }
}

// What the cache says about an area: its row in areas.json, and whether the
// live placement differs from it.
function areaStatus(areas, area, placement) {
  const row = areas?.find((entry) => entry.key === area.key)
  if (!row?.placement) return { listed: false, text: 'not in the cache (no record used this area when it was built)' }
  const { checklist, part, state } = row.placement
  const count = `${row.records} ${row.records === 1 ? 'record' : 'records'} on this area`
  const cached = checklist ? { checklist: checklist.name, part, state: null } : { reason: row.placement.reason }
  const differs = differsFromCache({ ...placement, state: null }, cached)
  if (!checklist) return { listed: false, text: `not listed: ${row.placement.reason} (${count})`, differs }
  const extra = [part && `part ${part}`, state && `state ${state}`].filter(Boolean)
  return { listed: true, text: `listed in ${checklist.name}${extra.length ? `, ${extra.join(', ')}` : ''} (${count})`, differs }
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
  } else if (live.record.type === 'AssertedDistribution') {
    notes.push('The distribution has no area to show on the map.')
  } else {
    // What the engine tested (engine.js recordLocation): coordinates, else the
    // georeference shape with its inside point; else the collecting event area
    // when that area placed the record.
    const location = recordLocation(live.record)
    const eventArea = live.record.eventArea
    if (location?.shape) {
      own = { label: `the georeference shape, inside point ${location.point.lat}, ${location.point.lng}`, polygons: location.shape, point: [location.point.lat, location.point.lng] }
    } else if (location) {
      own = { label: `coordinates ${location.point.lat}, ${location.point.lng}`, point: [location.point.lat, location.point.lng] }
    } else if (eventArea?.name != null && placement.steps.some((step) => step.via === 'eventArea')) {
      const key = `${SHAPE_KIND[eventArea.kind]}/${eventArea.id}`
      const polygons = ctx.shapes.has(key) ? await geometry.outlinePolygons(key) : null
      if (polygons?.length) own = { label: `${eventArea.name} (${eventArea.key}), the collecting event's area`, polygons }
      else notes.push(`No outline cached for the collecting event's area ${eventArea.name} (${eventArea.key}).`)
    } else {
      notes.push('The record has no coordinates, no georeference shape and no collecting event area that placed it.')
    }
  }

  let assigned = null
  if (placement.checklist) {
    const fallback = context.outlines.find((outline) => outline.id === placement.checklist.id)?.outline
    const key = placement.shape?.key ?? (fallback?.startsWith('fallback/') ? fallback : null)
    const polygons = key ? await geometry.outlinePolygons(key) : null
    const name = placement.shape?.name ?? placement.checklist.name
    const naturalEarth = key?.startsWith('fallback/') ? ' (Natural Earth outline)' : ''
    if (polygons?.length) assigned = { label: `${name}, where the placement puts it${naturalEarth}`, polygons }
    else notes.push(`No outline cached for ${placement.checklist.name}.`)
  }
  return { own, assigned, ownKind: live.record.type === 'FieldOccurrence' ? 'FieldOccurrence' : 'CollectionObject', notes }
}
</script>
