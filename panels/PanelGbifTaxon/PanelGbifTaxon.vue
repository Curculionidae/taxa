<template>
  <VCard>
    <VCardHeader class="flex items-center gap-3">
      <img
        :src="gbifMark"
        alt="GBIF"
        class="h-8 w-auto shrink-0"
      />
      <h2 class="text-md grow">This taxon in GBIF</h2>
      <PanelDropdown
        panel-key="panel:gbif-taxon"
        :menu-options="gbifMenuOptions"
      />
    </VCardHeader>
    <VCardContent class="text-sm">
      <VSpinner
        v-if="loading"
        logo-class="w-6 h-6"
        legend=""
      />

      <p
        v-else-if="error"
        class="opacity-60"
      >
        Could not load GBIF match.
      </p>

      <p
        v-else-if="!match"
        class="opacity-60"
      >
        No confident match could be found on GBIF for
        <em>{{ scientificName }}</em
        >.
      </p>

      <div
        v-else
        class="space-y-2"
      >
        <p
          class="text-base"
          v-html="headingName"
        />

        <p
          v-if="summary"
          class="text-xs opacity-70 leading-relaxed"
        >
          GBIF and TaxonWorks don&rsquo;t always classify names or synonymies the
          same way. Every GBIF panel here counts only records whose identification
          is a name both treat as this taxon.
        </p>

        <p
          v-if="synonymNote"
          class="text-xs opacity-80 leading-relaxed"
        >
          GBIF treats <span v-html="synonymNote.ourFormatted" /> as a synonym of
          <span v-html="synonymNote.acceptedFormatted" /> and merges their
          records. The panels below keep only the records identified as
          <em>{{ synonymNote.name }}</em>.
        </p>

        <ol
          v-else-if="classification.length"
          class="flex flex-wrap gap-x-1 text-xs opacity-80"
        >
          <li
            v-for="rank in classification"
            :key="rank.key"
            class="after:content-['›'] after:ml-1 last:after:content-['']"
          >
            <span class="uppercase opacity-60 mr-1">{{ rank.rank }}</span>
            {{ rank.name }}
          </li>
        </ol>

        <div class="text-xs opacity-80">
          <span v-if="summaryLoading && !summary">Loading GBIF records…</span>
          <span v-else-if="summary === undefined">
            GBIF record summary unavailable.
          </span>
          <template v-else-if="summary">
            <a
              :href="occurrenceUrl"
              target="_blank"
              rel="noopener"
              class="text-primary-color underline"
            >
              <strong>{{ approx(summary.occ) }}</strong>
              occurrence{{ summary.occ === 1 ? '' : 's' }}
            </a>
            in GBIF
            <span class="opacity-70">
              : {{ approx(summary.img) }} with images,
              {{ approx(summary.geo) }} georeferenced
            </span>
          </template>
        </div>

        <!-- Name overlap: GBIF's taxonomy-backbone synonymy vs TaxonWorks' -->
        <template v-if="nameVenn">
          <div class="gv-heads">
            <span class="gv-head">
              <span
                class="gv-dot"
                :style="{ background: 'var(--pp-tw)' }"
              />TaxonWorks: <em>{{ nameVenn.twValid }}</em>
            </span>
            <span class="gv-head">
              <span
                class="gv-dot"
                :style="{ background: 'var(--pp-gbif)' }"
              />GBIF: <em>{{ nameVenn.gbifValid }}</em>
            </span>
          </div>
          <div
            class="gbif-venn"
            :style="{ '--rows': nameVenn.rows }"
            role="img"
            :aria-label="nameVenn.aria"
          >
            <div class="gv-circle gv-tw" />
            <div class="gv-circle gv-gb" />

            <div class="gv-zone gv-zone-tw">
              <span class="gv-zh">TaxonWorks only</span>
              <span
                v-for="n in nameVenn.tw"
                :key="`vt-${n}`"
                class="gv-item"
              >{{ n }}</span>
              <span
                v-if="nameVenn.twMore"
                class="gv-more"
              >+{{ nameVenn.twMore }}</span>
              <span
                v-if="!nameVenn.tw.length"
                class="gv-none"
              >&mdash;</span>
            </div>

            <div class="gv-zone gv-zone-mid">
              <span class="gv-zh">shared</span>
              <span
                v-for="n in nameVenn.shared"
                :key="`vs-${n}`"
                class="gv-item"
              >{{ n }}</span>
              <span
                v-if="nameVenn.sharedMore"
                class="gv-more"
              >+{{ nameVenn.sharedMore }}</span>
            </div>

            <div class="gv-zone gv-zone-gb">
              <span class="gv-zh">GBIF only</span>
              <span
                v-for="n in nameVenn.gbif"
                :key="`vg-${n}`"
                class="gv-item"
              >{{ n }}</span>
              <span
                v-if="nameVenn.gbifMore"
                class="gv-more"
              >+{{ nameVenn.gbifMore }}</span>
              <span
                v-if="!nameVenn.gbif.length"
                class="gv-none"
              >&mdash;</span>
            </div>
          </div>
          <p class="mt-1 text-xs opacity-60">
            The Images and occurrences-map panels below show only records
            identified as one of the
            <strong>{{ nameVenn.sharedTotal }}</strong> shared
            name{{ nameVenn.sharedTotal === 1 ? '' : 's' }}.
          </p>
        </template>

        <p
          v-if="summary && summary.excluded?.length"
          class="text-xs opacity-60"
        >
          GBIF also groups <strong>{{ fmt(excludedTotal) }}</strong>
          record{{ excludedTotal === 1 ? '' : 's' }} identified as
          <em>{{ lumpedList }}</em> with this taxon:
          {{ excludedTotal === 1 ? 'not a synonym' : 'not synonyms' }} on
          TaxonWorks, so {{ excludedTotal === 1 ? 'it is' : 'they are' }} left
          out above
          (<a
            :href="occurrenceUrl"
            target="_blank"
            rel="noopener"
            class="underline"
          >view on GBIF</a>).
        </p>

        <p
          v-else-if="summary"
          class="text-xs opacity-60"
        >
          GBIF's taxonomy matches TaxonWorks for this taxon, so the occurrences
          map shows every GBIF record{{ summary.sampled ? ', not a 300-record sample' : '' }}.
        </p>

        <details
          v-if="summary && (summary.included?.length || summary.excluded?.length || twOnly.length)"
          class="text-xs"
        >
          <summary class="cursor-pointer opacity-70 select-none">
            Records by identified name<template v-if="summary.sampled">
              (GBIF's first {{ summary.sampleSize }} of
              {{ fmt(summary.raw) }})</template>
          </summary>
          <div class="mt-1.5 space-y-2 pl-1">
            <div v-if="summary.included?.length">
              <div class="opacity-50 uppercase tracking-wide mb-0.5">
                Included: this taxon on TaxonWorks
              </div>
              <ul class="space-y-px">
                <li
                  v-for="e in summary.included"
                  :key="`inc-${e.name}`"
                  class="flex justify-between gap-4"
                >
                  <em>{{ e.name }}</em>
                  <span class="opacity-50 tabular-nums shrink-0">{{ e.count }}</span>
                </li>
              </ul>
            </div>
            <div v-if="summary.excluded?.length">
              <div class="opacity-50 uppercase tracking-wide mb-0.5">
                Excluded: other names GBIF groups with this taxon
              </div>
              <ul class="space-y-px">
                <li
                  v-for="e in summary.excluded"
                  :key="`exc-${e.name}`"
                  class="flex justify-between gap-4"
                >
                  <em>{{ e.name }}</em>
                  <span class="opacity-50 tabular-nums shrink-0">{{ e.count }}</span>
                </li>
              </ul>
            </div>
            <div v-if="twOnly.length">
              <div class="opacity-50 uppercase tracking-wide mb-0.5">
                TaxonWorks names with no sampled records
              </div>
              <ul class="space-y-px opacity-70">
                <li
                  v-for="n in twOnly"
                  :key="`two-${n}`"
                >
                  <em>{{ n }}</em>
                </li>
              </ul>
            </div>
          </div>
        </details>

        <p class="flex justify-end">
          <a
            :href="gbifUrl"
            target="_blank"
            rel="noopener"
            class="inline-block px-3 py-1.5 rounded text-white text-xs font-medium hover:brightness-95"
            :style="{ background: 'var(--pp-gbif)' }"
          >
            View on GBIF.org
          </a>
        </p>
      </div>
    </VCardContent>
  </VCard>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  useGbifMatch,
  deriveScientificName,
  recordRequest,
  gbifMenuOptions,
  CHECKLIST_KEY,
  GBIF_TAXON_BASE,
  GBIF_OCCURRENCE_BASE
} from '../_gbifShared/useGbifMatch'
import gbifMark from '../_gbifShared/gbif-mark.svg'
import '../_gbifShared/gbif-tokens.css'
import {
  canonicalName,
  epithetKey,
  shortName,
  tallyOccurrenceNames
} from '../_gbifShared/gbifNameFilter'
import { resolveGbifTaxonScope } from '../_gbifShared/gbifTaxonScope'
import { fetchGbifBackboneConcept } from '../_gbifShared/gbifBackboneConcept'
import PanelDropdown from '@/modules/otus/components/Panel/PanelDropdown.vue'
import { useOtuPageRequestStore } from '@/modules/otus/store/request'

const GBIF_OCCURRENCE_SEARCH = 'https://api.gbif.org/v1/occurrence/search'
const SAMPLE = 300 // GBIF occurrence/search max page

const props = defineProps({
  otuId: { type: [Number, String], required: true },
  taxonId: { type: [Number, String], required: true },
  taxon: { type: Object, default: undefined },
  otu: { type: Object, default: undefined }
})

const scientificName = computed(() => deriveScientificName(props.taxon, props.otu))
const {
  loading,
  error,
  match,
  rawMatch,
  matchUrl,
  targetUsage,
  gbifKey,
  classification
} = useGbifMatch(scientificName)

// GBIF handed back an `acceptedUsage` that is a *different* taxon — i.e. it
// treats our name as a synonym (SYNONYM, AMBIGUOUS_SYNONYM, MISAPPLIED, …) and
// folds the records together, showing the accepted taxon's name / classification.
// Driven entirely by the match response, so it fires for any such name, not a
// hard-coded pair. `canonicalName` ignores subgenus / authorship / year, so a
// mere spelling or author variant of the same name does NOT trip it.
const synonymNote = computed(() => {
  const m = match.value
  const acc = m?.acceptedUsage
  if (!m || !acc?.key) return null
  const ourName = m.usage?.canonicalName || m.usage?.name || scientificName.value
  const accName = acc.canonicalName || acc.name
  if (!accName || canonicalName(accName) === canonicalName(ourName)) return null
  return {
    name: ourName,
    // OUR name (the synonym), not targetUsage — that resolves to the accepted
    // one for a plain SYNONYM, which would read "X is a synonym of X".
    ourFormatted: m.usage?.formattedName || m.usage?.name || ourName,
    acceptedFormatted: acc.formattedName || acc.name
  }
})

// Heading: always our matched name, never the synonymy-resolved accepted one.
const headingName = computed(
  () => match.value?.usage?.formattedName || targetUsage.value?.formattedName || ''
)

const requestStore = useOtuPageRequestStore()

watch([matchUrl, rawMatch], ([url, data]) => {
  if (url) recordRequest(requestStore, 'panel:gbif-taxon', { url, data })
})

// GBIF summary for the whole TaxonWorks concept (accepted name + all TW
// synonyms): how many occurrences, how many carry images (→ the Images panel),
// how many are georeferenced (→ the Map panel). All name-filtered to the TW
// concept; there's no filtered-count endpoint, so one 300-record sample gives
// the ratios and `count` scales them. `estimated` when the population > sample.
const summary = ref(null) // { occ, img, geo, raw, estimated } — from a record sample
const gbifBackbone = ref(null) // { acceptedName, synonymNames } — taxonomy, not records
const summaryLoading = ref(false)
const scopeKeys = ref([])

const gbifUrl = computed(() => `${GBIF_TAXON_BASE}/${gbifKey.value}`)
const occurrenceUrl = computed(() => {
  const p = new URLSearchParams()
  // scopeKeys are Catalogue-of-Life usage keys — the gbif.org occurrence UI only
  // resolves those with checklist_key alongside.
  p.set('checklist_key', CHECKLIST_KEY)
  ;(scopeKeys.value.length ? scopeKeys.value : [gbifKey.value])
    .filter(Boolean)
    .forEach((k) => p.append('taxon_key', k))
  return `${GBIF_OCCURRENCE_BASE}?${p}`
})

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '')
const approx = (n) => (summary.value?.estimated ? '~' : '') + fmt(n)

// How the sampled GBIF records split: names TaxonWorks treats as this taxon
// (included) vs other names GBIF groups under the same key (excluded).
const overlap = computed(() => {
  const sum = (a) => (a || []).reduce((s, e) => s + e.count, 0)
  const included = sum(summary.value?.included)
  const excluded = sum(summary.value?.excluded)
  const total = included + excluded
  return {
    included,
    excluded,
    total,
    pct: (n) => (total ? (n / total) * 100 : 0)
  }
})
const excludedTotal = computed(() => overlap.value.excluded)

// TaxonWorks names (accepted + synonyms) with no record in the GBIF sample —
// the TaxonWorks-only lobe of the overlap diagram.
const twOnly = computed(() => {
  const all = summary.value?.allowedNames || []
  const seen = new Set(
    (summary.value?.included || []).map((e) => canonicalName(e.name))
  )
  return all.filter((n) => !seen.has(canonicalName(n)))
})

// Name-overlap diagram, built from GBIF's TAXONOMY BACKBONE (its synonym list
// for the accepted taxon) vs TaxonWorks' synonym list — not from any occurrence
// sample. Names are keyed by epithet so a species recombined into another genus
// still matches. null until the backbone concept has loaded.
const VENN_CAP = 5
const nameVenn = computed(() => {
  const g = gbifBackbone.value
  const twNames = summary.value?.allowedNames || []
  if (!g || !twNames.length) return null

  const twByEp = new Map()
  twNames.forEach((n) => {
    const k = epithetKey(n)
    if (k && !twByEp.has(k)) twByEp.set(k, shortName(n))
  })
  const gByEp = new Map()
  ;[g.acceptedName, ...g.synonymNames].forEach((n) => {
    const k = epithetKey(n)
    if (k && !gByEp.has(k)) gByEp.set(k, shortName(n))
  })

  const shared = []
  const tw = []
  const gbif = []
  for (const [k, disp] of twByEp) (gByEp.has(k) ? shared : tw).push(disp)
  for (const [k, disp] of gByEp) if (!twByEp.has(k)) gbif.push(disp)

  // Nothing to illustrate — just the accepted name, no synonyms either side.
  if (!tw.length && !gbif.length && shared.length <= 1) return null

  const cut = (a) => ({ list: a.slice(0, VENN_CAP), more: Math.max(0, a.length - VENN_CAP) })
  const c = { tw: cut(tw), shared: cut(shared), gbif: cut(gbif) }
  const lines = (x) => x.list.length + (x.more ? 1 : 0)

  return {
    twValid: shortName(twNames[0]),
    gbifValid: shortName(g.acceptedName),
    tw: c.tw.list,
    twMore: c.tw.more,
    shared: c.shared.list,
    sharedMore: c.shared.more,
    sharedTotal: shared.length,
    gbif: c.gbif.list,
    gbifMore: c.gbif.more,
    rows: Math.max(2, lines(c.tw), lines(c.shared), lines(c.gbif)),
    aria:
      `Name overlap from GBIF's taxonomy backbone: ${shared.length} name` +
      `${shared.length === 1 ? '' : 's'} shared with TaxonWorks, ${tw.length} ` +
      `in TaxonWorks only, ${gbif.length} only in GBIF's synonymy.`
  }
})
const lumpedList = computed(() => {
  const n = summary.value?.lumpedNames || []
  if (!n.length) return ''
  const head = n.slice(0, 3).join(', ')
  return n.length > 3 ? `${head}, and others` : head
})

async function fetchSummary() {
  const forName = scientificName.value // guard against stale OTU navigation
  summary.value = null
  gbifBackbone.value = null
  summaryLoading.value = true
  try {
    const [{ names, keys }, backbone] = await Promise.all([
      resolveGbifTaxonScope(scientificName.value, props.taxonId, {
        rejectHigherRank: true
      }),
      fetchGbifBackboneConcept(scientificName.value)
    ])
    if (scientificName.value !== forName) return
    gbifBackbone.value = backbone
    scopeKeys.value = keys
    if (!keys.length) {
      summary.value = undefined
      return
    }

    const url = new URL(GBIF_OCCURRENCE_SEARCH)
    url.searchParams.set('checklistKey', CHECKLIST_KEY)
    keys.forEach((k) => url.searchParams.append('taxonKey', k))
    url.searchParams.set('limit', String(SAMPLE))
    const requestUrl = url.toString()

    const res = await fetch(requestUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (scientificName.value !== forName) return
    recordRequest(requestStore, 'panel:gbif-taxon', { url: requestUrl, data })

    const raw = typeof data?.count === 'number' ? data.count : 0
    const rows = data?.results || []
    if (!rows.length) {
      summary.value = {
        occ: raw, img: 0, geo: 0, raw,
        estimated: false, sampled: false,
        included: [], excluded: [], lumpedNames: [], allowedNames: names
      }
      return
    }

    const { included, excluded, keptRows: kept } = tallyOccurrenceNames(
      rows,
      names,
      CHECKLIST_KEY
    )
    const ratio = kept.length / rows.length
    const withImg = kept.filter((r) =>
      (r.media || []).some((m) => !m.type || m.type === 'StillImage')
    ).length
    const withGeo = kept.filter(
      (r) =>
        typeof r.decimalLatitude === 'number' &&
        typeof r.decimalLongitude === 'number'
    ).length

    const exact = raw <= rows.length
    summary.value = {
      raw,
      estimated: !exact && kept.length !== rows.length,
      occ: exact ? kept.length : Math.round(raw * ratio),
      img: exact ? withImg : Math.round(raw * (withImg / rows.length)),
      geo: exact ? withGeo : Math.round(raw * (withGeo / rows.length)),
      lumpedNames: excluded.map((e) => e.name),
      included, // {name, count}[] within the TaxonWorks concept
      excluded, // {name, count}[] GBIF folds in, not a TW synonym
      sampled: !exact, // per-name counts are from a sample, not the population
      sampleSize: rows.length,
      allowedNames: names // accepted + every TW synonym name
    }
  } catch (e) {
    if (scientificName.value === forName) summary.value = undefined
  } finally {
    if (scientificName.value === forName) summaryLoading.value = false
  }
}

watch(
  gbifKey,
  (key) => {
    if (key) fetchSummary()
    else {
      summary.value = null
      scopeKeys.value = []
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.gv-heads {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.66rem;
  opacity: 0.75;
  margin: 0.35rem 0 0.1rem;
}
.gv-head { display: inline-flex; align-items: baseline; gap: 0.3rem; }
.gv-head em { font-weight: 500; }
.gv-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex: none;
  transform: translateY(0.05rem);
}

.gbif-venn {
  position: relative;
  margin: 0 0 0.15rem;
  min-height: calc(1.4rem + var(--rows, 2) * 1.05rem);
}
.gv-circle {
  position: absolute;
  inset: 0 auto 0 auto;
  top: 0;
  bottom: 0;
  width: 62%;
  border-radius: 50%;
  border: 1.5px solid;
  pointer-events: none;
}
.gv-tw {
  left: 0;
  border-color: var(--pp-tw);
  background: color-mix(in srgb, var(--pp-tw) 13%, transparent);
}
.gv-gb {
  right: 0;
  border-color: var(--pp-gbif);
  background: color-mix(in srgb, var(--pp-gbif) 13%, transparent);
}
.gv-zone {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 0.66rem;
  line-height: 1.28;
  min-width: 0;
}
.gv-zone-tw { left: 1%; width: 33%; align-items: flex-start; text-align: left; }
.gv-zone-mid { left: 33.5%; width: 33%; align-items: center; text-align: center; }
.gv-zone-gb { right: 1%; width: 33%; align-items: flex-end; text-align: right; }
.gv-zh {
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.5;
  margin-bottom: 1px;
}
.gv-item {
  font-style: italic;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gv-more,
.gv-none {
  opacity: 0.5;
}
</style>
