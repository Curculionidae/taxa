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
    <div class="relative w-full h-96 overflow-hidden rounded-b isolate">
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
  GBIF_OCCURRENCE_BASE
} from '../_gbifShared/useGbifMatch'
import gbifMark from '../_gbifShared/gbif-mark.svg'
import PanelDropdown from '@/modules/otus/components/Panel/PanelDropdown.vue'
import { useOtuPageRequestStore } from '@/modules/otus/store/request'

const GBIF_MAP_CAPABILITIES =
  'https://api.gbif.org/v2/map/occurrence/density/capabilities.json'
const GBIF_TILE_TEMPLATE =
  'https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@2x.png'
const BASEMAPS = {
  topo: {
    label: 'Topographic',
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri'
  },
  dark: {
    label: 'Dark Gray',
    url: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
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
const { gbifKey } = useGbifMatch(scientificName)

const georeferencedCount = ref(null)
const mapEl = ref(null)
const basemapKey = ref('topo')
let mapInstance = null
let gbifTileLayer = null
let basemapLayer = null

const showMap = computed(
  () =>
    typeof georeferencedCount.value === 'number' && georeferencedCount.value > 0
)

const requestStore = useOtuPageRequestStore()

async function fetchMapCapabilities(taxonKey) {
  georeferencedCount.value = null

  const url = new URL(GBIF_MAP_CAPABILITIES)
  url.searchParams.set('taxonKey', taxonKey)
  url.searchParams.set('checklistKey', CHECKLIST_KEY)
  const requestUrl = url.toString()

  try {
    const res = await fetch(requestUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    georeferencedCount.value =
      typeof data?.total === 'number' ? data.total : 0
    recordRequest(requestStore, 'panel:gbif-map', { url: requestUrl, data })
  } catch (e) {
    georeferencedCount.value = 0
    recordRequest(requestStore, 'panel:gbif-map', { url: requestUrl, data: null })
  }
}

async function initMap(taxonKey) {
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

  addGbifLayer(L, taxonKey)
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
  if (gbifTileLayer) gbifTileLayer.bringToFront()
}

function addGbifLayer(L, taxonKey) {
  if (!mapInstance) return

  if (gbifTileLayer) {
    gbifTileLayer.remove()
    gbifTileLayer = null
  }

  const params = new URLSearchParams({
    style: 'classic.poly',
    bin: 'hex',
    hexPerTile: '70',
    taxonKey,
    checklistKey: CHECKLIST_KEY,
    srs: 'EPSG:3857'
  })

  gbifTileLayer = L.tileLayer(`${GBIF_TILE_TEMPLATE}?${params}`, {
    attribution: 'Occurrences &copy; <a href="https://www.gbif.org">GBIF</a>',
    maxZoom: 18
  }).addTo(mapInstance)
}

function openExplore() {
  if (!mapInstance) return

  const bounds = mapInstance.getBounds()
  const minLat = Math.max(-90, bounds.getSouth())
  const maxLat = Math.min(90, bounds.getNorth())
  const minLng = bounds.getWest()
  const maxLng = bounds.getEast()

  const ring = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat]
  ]
    .map(([lng, lat]) => `${lng} ${lat}`)
    .join(', ')

  const wkt = `POLYGON((${ring}))`
  const url = `${GBIF_OCCURRENCE_BASE}?geometry=${encodeURIComponent(wkt)}`

  window.open(url, '_blank', 'noopener')
}

function destroyMap() {
  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
    gbifTileLayer = null
    basemapLayer = null
  }
}

watch(
  gbifKey,
  (key) => {
    destroyMap()
    if (key) fetchMapCapabilities(key)
    else georeferencedCount.value = null
  },
  { immediate: true }
)

watch([showMap, mapEl, gbifKey], async ([show, el, key]) => {
  if (!show || !el || !key) return
  await nextTick()
  if (mapInstance) {
    addGbifLayer((await import('leaflet')).default, key)
  } else {
    initMap(key)
  }
})

watch(basemapKey, async (key) => {
  if (!mapInstance) return
  const L = (await import('leaflet')).default
  setBasemap(L, key)
})

onBeforeUnmount(destroyMap)
</script>
