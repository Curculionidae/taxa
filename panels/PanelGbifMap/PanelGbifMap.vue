<template>
  <VCard v-if="showMap">
    <VCardHeader class="flex items-center gap-3">
      <img
        :src="gbifMark"
        alt="GBIF"
        class="h-8 w-auto shrink-0"
      />
      <h2 class="text-md grow">GBIF occurrences map</h2>
      <PanelDropdown
        panel-key="panel:gbif-map"
        :menu-options="gbifMenuOptions"
      />
    </VCardHeader>
    <div class="relative w-full h-96 overflow-hidden isolate">
      <div
        ref="mapEl"
        class="absolute inset-0"
      />
      <button
        type="button"
        @click="openExplore"
        class="absolute bottom-2 left-2 z-[1000] px-2 py-1 text-xs rounded bg-base-background border border-base-border shadow hover:bg-base-foreground"
      >
        Explore on GBIF.org
      </button>
      <SelectInput
        v-model="basemapKey"
        class="absolute top-2 right-2 z-[1000] bg-base-background shadow"
        aria-label="Basemap"
      >
        <option
          v-for="(cfg, key) in BASEMAPS"
          :key="key"
          :value="key"
        >
          {{ cfg.label }}
        </option>
      </SelectInput>
    </div>
    <p class="px-5 py-2 text-xs opacity-60">
      {{ plottedLabel }}
    </p>
  </VCard>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import {
  useGbifMatch,
  deriveScientificName,
  recordRequest,
  gbifMenuOptions,
  CHECKLIST_KEY,
  GBIF_OCCURRENCE_BASE,
  GBIF_OCCURRENCE_DETAIL
} from '../_gbifShared/useGbifMatch'
import {
  occurrenceName,
  epithetKey,
  tallyOccurrenceNames,
  scopeCaption
} from '../_gbifShared/gbifNameFilter'
import { resolveGbifTaxonScope } from '../_gbifShared/gbifTaxonScope'
import { fetchGbifBackboneConcept } from '../_gbifShared/gbifBackboneConcept'
import gbifMark from '../_gbifShared/gbif-mark.svg'
import '../_gbifShared/gbif-tokens.css'
import PanelDropdown from '@/modules/otus/components/Panel/PanelDropdown.vue'
import { useOtuPageRequestStore } from '@/modules/otus/store/request'

// Two map modes:
//  - density: GBIF's own hex-density tiles for the taxon — ALL records, but the
//    tile API only takes one `taxonKey` and can't be name-filtered. Safe only
//    when GBIF's concept matches TaxonWorks' (the 300-record probe finds nothing
//    GBIF folds in that TaxonWorks doesn't).
//  - markers: otherwise. The first 300 georeferenced records, name-filtered to
//    this taxon + its TW synonyms, plotted as points.
const GBIF_OCCURRENCE_SEARCH = 'https://api.gbif.org/v1/occurrence/search'
const GBIF_DENSITY_TILE =
  'https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@2x.png'
const PAGE = 300 // occurrence/search page size
const MARKER_PAGES = 3 // …so up to 900 points in marker mode

const BASEMAPS = {
  dark: {
    label: 'Dark Gray',
    url: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri'
  },
  topo: {
    label: 'Topographic',
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri'
  }
}

const props = defineProps({
  otuId: { type: [Number, String], required: true },
  taxonId: { type: [Number, String], required: true },
  taxon: { type: Object, default: undefined },
  otu: { type: Object, default: undefined }
})

const scientificName = computed(() => deriveScientificName(props.taxon, props.otu))
const { match, gbifKey } = useGbifMatch(scientificName)

// Clean "Genus species" for captions (no subgenus / authorship); falls back to
// whatever TaxonWorks gave us.
const taxonDisplayName = computed(
  () => match.value?.usage?.canonicalName || scientificName.value
)

const occurrences = ref([]) // { lat, lng, key, name, year, country } — marker mode
const totalCount = ref(null) // GBIF's georeferenced rollup count
const lumpedNames = ref([]) // names GBIF folds in that TaxonWorks doesn't
const hasSynonyms = ref(false) // TaxonWorks lists synonyms → filter spans them
const matchesTW = ref(false) // GBIF concept == TW concept → density-tile mode
const mapEl = ref(null)
const basemapKey = ref('dark')

let mapInstance = null
let markerLayer = null
let densityLayer = null
let basemapLayer = null

const mapMode = computed(() => (matchesTW.value ? 'density' : 'markers'))

const showMap = computed(
  () =>
    (matchesTW.value && (totalCount.value || 0) > 0) ||
    occurrences.value.length > 0
)

const plottedLabel = computed(() => {
  if (mapMode.value === 'density') {
    const n = totalCount.value
    return (
      `GBIF's taxonomy matches TaxonWorks for ${taxonDisplayName.value}: ` +
      `the tiled map shows every GBIF record` +
      (typeof n === 'number' && n > 0
        ? ` (${n.toLocaleString()} georeferenced).`
        : `.`)
    )
  }
  return scopeCaption({
    shown: occurrences.value.length,
    total: totalCount.value,
    lumpedNames: lumpedNames.value,
    noun: `georeferenced occurrence${occurrences.value.length === 1 ? '' : 's'}`,
    taxonName: taxonDisplayName.value,
    includesSynonyms: hasSynonyms.value
  })
})

const requestStore = useOtuPageRequestStore()

function toPoint(r) {
  return {
    lat: r.decimalLatitude,
    lng: r.decimalLongitude,
    key: r.key,
    name: occurrenceName(r, CHECKLIST_KEY),
    year: r.year || null,
    country: r.country || r.countryCode || ''
  }
}

function pageUrl(keys, offset) {
  const u = new URL(GBIF_OCCURRENCE_SEARCH)
  u.searchParams.set('checklistKey', CHECKLIST_KEY)
  keys.forEach((k) => u.searchParams.append('taxonKey', k))
  u.searchParams.set('hasCoordinate', 'true')
  u.searchParams.set('hasGeospatialIssue', 'false')
  u.searchParams.set('limit', String(PAGE))
  u.searchParams.set('offset', String(offset))
  return u.toString()
}

async function fetchOccurrences() {
  const forName = scientificName.value // guard against stale OTU navigation
  occurrences.value = []
  totalCount.value = null
  lumpedNames.value = []
  hasSynonyms.value = false
  matchesTW.value = false

  const [{ names, keys }, backbone] = await Promise.all([
    resolveGbifTaxonScope(scientificName.value, props.taxonId, {
      rejectHigherRank: true
    }),
    fetchGbifBackboneConcept(scientificName.value)
  ])
  if (scientificName.value !== forName) return
  hasSynonyms.value = names.length > 1
  if (!keys.length) {
    totalCount.value = 0
    recordRequest(requestStore, 'panel:gbif-map', { url: '', data: null })
    return
  }

  // Density tiles can't be name-filtered, so they're only safe when GBIF's
  // taxonomy agrees with TaxonWorks: the backbone lists no synonym whose epithet
  // falls outside the TaxonWorks name set (a 300-record probe alone can miss a
  // lumped species whose records sort past the page).
  const twEpithets = new Set(names.map(epithetKey))
  const backboneAgrees =
    !!backbone &&
    twEpithets.has(epithetKey(backbone.acceptedName)) &&
    (backbone.synonymNames || []).every((n) => twEpithets.has(epithetKey(n)))

  try {
    // Probe page: decides density vs markers, and is page 0 of marker mode.
    const first = pageUrl(keys, 0)
    const res = await fetch(first)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (scientificName.value !== forName) return

    recordRequest(requestStore, 'panel:gbif-map', { url: first, data })
    totalCount.value = typeof data?.count === 'number' ? data.count : null

    const t0 = tallyOccurrenceNames(data?.results || [], names, CHECKLIST_KEY)

    // Both signals must agree before trusting the un-filterable density tiles.
    if (!t0.excluded.length && backboneAgrees) {
      matchesTW.value = true
      return
    }

    // Marker mode: name-filtered points, paged out to MARKER_PAGES.
    const excluded = new Map(t0.excluded.map((e) => [e.name, true]))
    let kept = t0.keptRows
    const total = data?.count || 0
    if (total > PAGE) {
      const offsets = []
      for (let p = 1; p < MARKER_PAGES && p * PAGE < total; p++) {
        offsets.push(p * PAGE)
      }
      const more = await Promise.all(
        offsets.map((o) =>
          fetch(pageUrl(keys, o))
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        )
      )
      if (scientificName.value !== forName) return
      for (const d of more) {
        if (!d?.results) continue
        const t = tallyOccurrenceNames(d.results, names, CHECKLIST_KEY)
        kept = kept.concat(t.keptRows)
        t.excluded.forEach((e) => excluded.set(e.name, true))
      }
    }

    lumpedNames.value = [...excluded.keys()]
    occurrences.value = kept
      .filter(
        (r) =>
          typeof r.decimalLatitude === 'number' &&
          typeof r.decimalLongitude === 'number'
      )
      .map(toPoint)
  } catch (e) {
    if (scientificName.value === forName) {
      occurrences.value = []
      totalCount.value = 0
    }
    recordRequest(requestStore, 'panel:gbif-map', { url: '', data: null })
  }
}

async function initMap() {
  if (typeof window === 'undefined' || !mapEl.value || mapInstance) return

  const L = (await import('leaflet')).default

  mapInstance = L.map(mapEl.value, {
    center: [20, 0],
    zoom: 1,
    minZoom: 1,
    worldCopyJump: true,
    scrollWheelZoom: false,
    attributionControl: true
  })

  setBasemap(L, basemapKey.value)
  renderMap(L)
}

function clearOverlays() {
  if (markerLayer) {
    markerLayer.remove()
    markerLayer = null
  }
  if (densityLayer) {
    densityLayer.remove()
    densityLayer = null
  }
}

function renderMap(L) {
  if (!mapInstance) return
  clearOverlays()
  if (mapMode.value === 'density') addDensityLayer(L)
  else renderMarkers(L)
}

function addDensityLayer(L) {
  if (!gbifKey.value) return
  const params = new URLSearchParams({
    style: 'classic.poly',
    bin: 'hex',
    hexPerTile: '70',
    taxonKey: String(gbifKey.value),
    checklistKey: CHECKLIST_KEY,
    srs: 'EPSG:3857'
  })
  densityLayer = L.tileLayer(`${GBIF_DENSITY_TILE}?${params}`, {
    attribution: 'Occurrences &copy; <a href="https://www.gbif.org">GBIF</a>',
    maxNativeZoom: 14,
    opacity: 0.9
  }).addTo(mapInstance)
  mapInstance.setView([20, 0], 1)
}

function setBasemap(L, key) {
  if (!mapInstance) return
  if (basemapLayer) {
    basemapLayer.remove()
    basemapLayer = null
  }
  const cfg = BASEMAPS[key]
  basemapLayer = L.tileLayer(cfg.url, {
    attribution: cfg.attribution,
    maxZoom: 18
  }).addTo(mapInstance)
}

function renderMarkers(L) {
  if (!mapInstance) return

  markerLayer = L.layerGroup()
  for (const o of occurrences.value) {
    const m = L.circleMarker([o.lat, o.lng], {
      radius: 4,
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.6,
      className: 'gbif-occ-marker'
    })
    const bits = [
      o.name,
      [o.year, o.country].filter(Boolean).join(' · '),
      `<a href="${GBIF_OCCURRENCE_DETAIL}/${o.key}" target="_blank" rel="noopener noreferrer">GBIF occurrence ${o.key}</a>`
    ].filter(Boolean)
    m.bindPopup(bits.join('<br>'))
    m.addTo(markerLayer)
  }
  markerLayer.addTo(mapInstance)

  const pts = occurrences.value.map((o) => [o.lat, o.lng])
  if (pts.length === 1) {
    mapInstance.setView(pts[0], 6)
  } else if (pts.length > 1) {
    mapInstance.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 8 })
  }
}

function openExplore() {
  const params = new URLSearchParams()
  // CoL usage key → needs checklist_key for the gbif.org occurrence UI to resolve it.
  if (gbifKey.value) {
    params.set('checklist_key', CHECKLIST_KEY)
    params.set('taxon_key', String(gbifKey.value))
  }
  params.set('has_coordinate', 'true')
  if (mapInstance) {
    const b = mapInstance.getBounds()
    const ring = [
      [b.getWest(), Math.max(-90, b.getSouth())],
      [b.getEast(), Math.max(-90, b.getSouth())],
      [b.getEast(), Math.min(90, b.getNorth())],
      [b.getWest(), Math.min(90, b.getNorth())],
      [b.getWest(), Math.max(-90, b.getSouth())]
    ]
      .map(([lng, lat]) => `${lng} ${lat}`)
      .join(', ')
    params.set('geometry', `POLYGON((${ring}))`)
  }
  window.open(`${GBIF_OCCURRENCE_BASE}?${params}`, '_blank', 'noopener')
}

function destroyMap() {
  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
    markerLayer = null
    densityLayer = null
    basemapLayer = null
  }
}

watch(
  gbifKey,
  (key) => {
    destroyMap()
    if (key) fetchOccurrences()
    else {
      occurrences.value = []
      totalCount.value = null
      matchesTW.value = false
    }
  },
  { immediate: true }
)

watch([showMap, mapEl, mapMode], async ([show, el]) => {
  if (!show || !el) return
  await nextTick()
  if (mapInstance) {
    renderMap((await import('leaflet')).default)
  } else {
    initMap()
  }
})

watch(basemapKey, async (key) => {
  if (!mapInstance) return
  setBasemap((await import('leaflet')).default, key)
})

onBeforeUnmount(destroyMap)
</script>

<style scoped>
:deep(.gbif-occ-marker) {
  stroke: var(--pp-gbif);
  fill: var(--pp-gbif);
}
</style>
