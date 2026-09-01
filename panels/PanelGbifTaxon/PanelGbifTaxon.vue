<template>
  <VCard>
    <VCardHeader class="flex items-center gap-3">
      <img
        :src="gbifMark"
        alt="GBIF"
        class="h-8 w-auto shrink-0"
      />
      <h2
        class="text-md grow"
        v-html="titleHtml"
      />
      <PanelDropdown
        panel-key="panel:gbif-taxon"
        :menu-options="gbifMenuOptions"
      />
    </VCardHeader>

    <VCardContent class="text-sm">
      <template v-if="!mounted" />

      <VSpinner
        v-else-if="loading && !model"
        logo-class="w-6 h-6"
        legend=""
      />

      <p
        v-else-if="!model"
        class="text-base-soft"
      >
        No GBIF comparison to show.
      </p>

      <p
        v-else-if="model.error"
        class="text-base-soft"
      >
        Could not load the GBIF comparison.
      </p>

      <p
        v-else-if="model.matched === false"
        class="text-base-soft"
      >
        No confident match could be found on GBIF for
        <em>{{ model.twName || scientificName }}</em>.
      </p>

      <div
        v-else
        class="space-y-3"
      >
        <p v-html="matchedLineHtml" />

        <template v-if="model.rankEligible !== false">
          <div class="flex items-start gap-3">
            <svg
              class="rel-ico"
              width="60"
              height="34"
              viewBox="0 0 52 30"
              role="img"
              :aria-label="line1"
            >
              <rect
                v-for="(r, i) in relIconRects"
                :key="i"
                :class="r.cls"
                :x="r.x"
                :y="r.y"
                :width="r.w"
                :height="r.h"
                rx="2"
              />
            </svg>

            <div class="min-w-0 flex-1">
              <p>{{ line1 }}</p>

              <div
                class="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-base-soft"
              >
                <span
                  v-if="model.relation.symbol"
                  class="shorthand"
                >
                  <span class="tw">TaxonWorks</span>&nbsp;<span>{{
                    model.relation.symbol
                  }}</span>&nbsp;<span class="gb">Catalogue of Life</span>
                </span>
                <span v-if="model.relation.symbol">·</span>
                <span>by name overlap{{ provisionalSuffix }}</span>
                <span>·</span>
                <button
                  type="button"
                  class="text-secondary underline"
                  @click="showExplainer = !showExplainer"
                >
                  how this is measured
                </button>
              </div>

              <p
                v-if="showExplainer"
                class="mt-2 border-t border-base-muted pt-2 text-xs text-base-soft leading-relaxed"
                v-html="explainerHtml"
              />
            </div>
          </div>

          <template v-if="isNoComparison">
            <div
              v-if="model.zones.notComparable.length"
              class="text-xs"
            >
              <div
                class="mb-1 text-base-soft"
                v-html="`Names TaxonWorks files under ${em(model.twName)} that Catalogue of Life does not contain`"
              />
              <ul class="space-y-0.5">
                <li
                  v-for="n in model.zones.notComparable"
                  :key="`nc-${n}`"
                  class="italic"
                >
                  {{ n }}
                </li>
              </ul>
            </div>
            <div
              v-if="model.zones.inDataOnly.length"
              class="mt-2 text-xs"
            >
              <div
                class="mb-1 text-base-soft"
                v-html="`In the occurrence records, in neither circumscription of ${em(model.twName)}`"
              />
              <ul class="space-y-0.5">
                <li
                  v-for="e in model.zones.inDataOnly"
                  :key="`data-${e.name}`"
                >
                  <span class="italic">{{ e.name }}</span
                  ><span
                    v-if="e.count != null"
                    class="ml-1 text-base-soft"
                    >{{ fmt(e.count) }}</span
                  >
                </li>
              </ul>
            </div>
          </template>

          <template v-else-if="showCalmLine">
            <ul
              v-if="model.zones.consensus.length > 1"
              class="flex flex-wrap gap-1.5 text-xs"
            >
              <li
                v-for="e in model.zones.consensus"
                :key="`chip-${e.name}`"
                class="rounded border border-base-muted px-1.5 py-0.5 italic"
              >
                {{ e.short }}
              </li>
            </ul>
          </template>

          <div
            v-else
            class="overflow-x-auto"
          >
            <table class="ztable text-xs">
              <caption
                class="pb-1 text-left text-xs text-base-soft"
                v-html="captionHtml"
              />
              <thead>
                <tr class="border-b border-base-muted">
                  <th class="text-base-soft">Name</th>
                  <th
                    class="text-base-soft"
                    v-html="colHeadTw"
                  />
                  <th
                    class="ic text-base-soft"
                    aria-label="relation between the two placements"
                  />
                  <th
                    class="text-base-soft"
                    v-html="colHeadCol"
                  />
                  <th class="rec text-base-soft">GBIF records</th>
                </tr>
              </thead>
              <tbody>
                <!-- In both circumscriptions -->
                <template v-if="model.zones.consensus.length">
                  <tr class="zheading bg-base-muted text-base-soft">
                    <td
                      colspan="5"
                      v-html="`In both circumscriptions of ${em(model.twName)}`"
                    />
                  </tr>
                  <tr
                    v-for="e in model.zones.consensus"
                    :key="`cons-${e.name}`"
                    class="border-b border-base-muted"
                  >
                    <td>
                      <span class="nm">{{ e.name }}</span>
                      <span
                        v-if="e.matchTier && e.matchTier !== 'none'"
                        class="tier"
                        :class="{ weak: e.matchTier === 'weak' }"
                        :title="tierTitle(e.matchTier)"
                        >{{ e.matchTier }}</span
                      >
                    </td>
                    <td>{{ twRoleLabel(e) }}</td>
                    <td class="ic">
                      <RelIcon kind="congruent" />
                    </td>
                    <td>{{ colSideLabel(e) }}</td>
                    <td
                      class="rec"
                      :class="{ 'is-zero': e.records === 0 }"
                    >
                      <template v-if="e.records != null">{{
                        fmt(e.records)
                      }}</template>
                    </td>
                  </tr>
                </template>

                <!-- TaxonWorks files under X; CoL keeps separate -->
                <template v-if="model.zones.twKeepsIn.length">
                  <tr
                    class="zheading bg-base-muted text-base-soft"
                    :style="accentStyle('tw')"
                  >
                    <td
                      colspan="5"
                      v-html="`TaxonWorks files under ${em(model.twName)}; Catalogue of Life keeps separate`"
                    />
                  </tr>
                  <tr
                    v-for="e in model.zones.twKeepsIn"
                    :key="`keep-${e.name}`"
                    class="border-b border-base-muted"
                  >
                    <td>
                      <span class="nm">{{ e.name }}</span>
                    </td>
                    <td>{{ twRoleLabel(e) }}</td>
                    <td class="ic">
                      <RelIcon kind="includes" />
                    </td>
                    <td>separate accepted species</td>
                    <td
                      class="rec"
                      :class="{ 'is-zero': e.records === 0 }"
                    >
                      <template v-if="e.records != null">{{
                        fmt(e.records)
                      }}</template>
                    </td>
                  </tr>
                </template>

                <!-- CoL files under X; TaxonWorks places elsewhere -->
                <template v-if="model.zones.colFoldsIn.length">
                  <tr
                    class="zheading bg-base-muted text-base-soft"
                    :style="accentStyle('gb')"
                  >
                    <td
                      colspan="5"
                      v-html="`Catalogue of Life files under ${em(model.twName)}; TaxonWorks places elsewhere`"
                    />
                  </tr>
                  <tr
                    v-for="row in model.zones.colFoldsIn"
                    :key="`fold-${row.name}`"
                    class="border-b border-base-muted"
                  >
                    <td>
                      <span class="nm">{{ row.name }}</span>
                      <span
                        v-if="row.matchTier && row.matchTier !== 'none'"
                        class="tier"
                        :class="{ weak: row.matchTier === 'weak' }"
                        :title="tierTitle(row.matchTier)"
                        >{{ row.matchTier }}</span
                      >
                      <div
                        v-if="row.otherCombinations && row.otherCombinations.length"
                        class="also"
                        v-html="`also written ${row.otherCombinations.map(em).join(', ')} in Catalogue of Life`"
                      />
                    </td>
                    <td>
                      <VSpinner
                        v-if="row.pending && !row.twPlacementParts"
                        logo-class="w-3 h-3"
                        legend=""
                      />
                      <template v-else-if="row.twPlacementParts"
                        ><span
                          v-html="row.twPlacementParts.html"
                        /><RouterLink
                          v-if="row.twPlacementParts.otuId"
                          class="lnk-tw"
                          :to="{
                            name: 'otus-id',
                            params: { id: row.twPlacementParts.otuId }
                          }"
                          ><em>{{ row.twPlacementParts.name }}</em></RouterLink
                        ><span
                          v-if="row.twPlacementParts.tail"
                          v-html="row.twPlacementParts.tail"
                      /></template>
                    </td>
                    <td class="ic">
                      <RelIcon :kind="rowIconKey('colFoldsIn', row)" />
                    </td>
                    <td>synonym</td>
                    <td
                      class="rec"
                      :class="{ 'is-zero': row.records === 0 }"
                    >
                      <template v-if="row.records != null">{{
                        fmt(row.records)
                      }}</template>
                    </td>
                  </tr>
                </template>

                <!-- Misapplied -->
                <template v-if="model.zones.misapplied.length">
                  <tr
                    class="zheading bg-base-muted text-base-soft"
                    :style="accentStyle('gb')"
                  >
                    <td
                      colspan="5"
                      v-html="`Misapplied to ${em(model.twName)} in Catalogue of Life`"
                    />
                  </tr>
                  <tr
                    v-for="e in model.zones.misapplied"
                    :key="`mis-${e.name}`"
                    class="border-b border-base-muted"
                  >
                    <td>
                      <span class="nm">{{ e.name }}</span>
                    </td>
                    <td />
                    <td class="ic">
                      <RelIcon kind="none" />
                    </td>
                    <td>misapplied, excluded</td>
                    <td class="rec" />
                  </tr>
                </template>

                <!-- In the records, in neither circumscription -->
                <template v-if="model.zones.inDataOnly.length">
                  <tr class="zheading bg-base-muted text-base-soft">
                    <td
                      colspan="5"
                      v-html="`In the occurrence records, in neither circumscription of ${em(model.twName)}`"
                    />
                  </tr>
                  <tr
                    v-for="e in model.zones.inDataOnly"
                    :key="`data-${e.name}`"
                    class="border-b border-base-muted"
                  >
                    <td class="nm">{{ e.name }}</td>
                    <td />
                    <td class="ic" />
                    <td class="text-base-soft">not resolved</td>
                    <td class="rec">
                      <template v-if="e.count != null">{{ fmt(e.count) }}</template>
                    </td>
                  </tr>
                </template>

                <!-- Not comparable -->
                <template v-if="model.zones.notComparable.length">
                  <tr class="zheading bg-base-muted text-base-soft">
                    <td colspan="5">Not comparable</td>
                  </tr>
                  <tr
                    v-for="n in model.zones.notComparable"
                    :key="`nc-${n}`"
                    class="border-b border-base-muted"
                  >
                    <td class="nm">{{ n }}</td>
                    <td />
                    <td class="ic" />
                    <td class="text-base-soft">not in Catalogue of Life</td>
                    <td class="rec" />
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </template>

        <div
          v-if="model.counts"
          class="border-t border-base-muted pt-2 text-xs text-base-content leading-relaxed"
        >
          <p
            v-if="model.counts.total != null"
            v-html="summaryHtml"
          />
          <p v-else>Record counts are not available.</p>
          <p
            v-if="inDataOnlySumN"
            class="mt-1 text-base-soft"
          >
            {{ fmt(inDataOnlySumN) }} further records carry names not resolved
            into the comparison above (for example BIN placeholders).
          </p>
        </div>

        <p
          v-if="openInGbifHtml"
          class="text-xs"
          v-html="openInGbifHtml"
        />

        <p
          v-if="model.rankEligible === false"
          class="text-xs text-base-soft"
        >
          Concept comparison is shown for species and lower ranks.
        </p>
      </div>
    </VCardContent>
  </VCard>
</template>

<script setup>
import { ref, computed, watch, onMounted, h } from 'vue'
import {
  resolveConceptAlignment,
  fetchTwPlacement
} from '../_gbifShared/gbifConceptAlignment'
import {
  deriveScientificName,
  gbifMenuOptions,
  recordRequest
} from '../_gbifShared/useGbifMatch'
import { canonicalName } from '../_gbifShared/gbifNameFilter'
import gbifMark from '../_gbifShared/gbif-mark.svg'
import '../_gbifShared/gbif-tokens.css'
import PanelDropdown from '@/modules/otus/components/Panel/PanelDropdown.vue'
import { useOtuPageRequestStore } from '@/modules/otus/store/request'

const props = defineProps({
  otuId: { type: [Number, String], required: true },
  taxonId: { type: [Number, String], required: true },
  taxon: { type: Object, default: undefined },
  otu: { type: Object, default: undefined }
})

const scientificName = computed(() =>
  deriveScientificName(props.taxon, props.otu)
)

const requestStore = useOtuPageRequestStore()

const model = ref(null)
const loading = ref(false)
const mounted = ref(false)
const showExplainer = ref(false)

// ---- HTML helpers (v-html output escapes user data, wraps names in <em>) ----
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
const em = (s) => `<em>${esc(s)}</em>`
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '')

// ---- relation icon (Franz and Peet 2009, Fig. 2). Coordinates copied from
//      docs/gbif-viz-options.html, viewBox 0 0 52 30 ----
const ICONS = {
  congruent: [
    { cls: 'tw', x: 7, y: 6, w: 36, h: 18 },
    { cls: 'gb', x: 10, y: 8, w: 36, h: 18 }
  ],
  included: [
    { cls: 'gb', x: 4, y: 4, w: 44, h: 22 },
    { cls: 'tw', x: 14, y: 10, w: 18, h: 10 }
  ],
  includes: [
    { cls: 'tw', x: 4, y: 4, w: 44, h: 22 },
    { cls: 'gb', x: 20, y: 10, w: 18, h: 10 }
  ],
  overlap: [
    { cls: 'tw', x: 4, y: 6, w: 28, h: 18 },
    { cls: 'gb', x: 22, y: 6, w: 26, h: 18 }
  ],
  none: [
    { cls: 'tw', x: 4, y: 7, w: 19, h: 16 },
    { cls: 'gb', x: 30, y: 7, w: 19, h: 16 }
  ]
}
const relIconRects = computed(
  () => ICONS[model.value?.relation?.icon] || ICONS.overlap
)

// Small inline relation icon for a single zone-table row. `kind` is one of the
// ICONS keys, or null (a colFoldsIn row whose TaxonWorks placement has not
// resolved yet) in which case nothing renders.
const RelIcon = (props) => {
  const rects = ICONS[props.kind]
  return rects
    ? h(
        'svg',
        {
          class: 'rel-ico-sm',
          width: 34,
          height: 20,
          viewBox: '0 0 52 30',
          'aria-hidden': 'true'
        },
        rects.map((r, i) =>
          h('rect', {
            key: i,
            class: r.cls,
            x: r.x,
            y: r.y,
            width: r.w,
            height: r.h,
            rx: 2
          })
        )
      )
    : null
}
RelIcon.props = ['kind']

// The per-row relation between a name's TaxonWorks placement and its Catalogue
// of Life placement. consensus and twKeepsIn are fixed by the zone; colFoldsIn
// depends on the reverse lookup (row.twPlacement), so it returns null until that
// lands.
function rowIconKey(zone, row) {
  if (zone === 'consensus') return 'congruent'
  if (zone === 'twKeepsIn') return 'includes'
  if (zone === 'misapplied') return 'none'
  if (zone === 'colFoldsIn') {
    const p = row?.twPlacement
    if (!p) return null
    if (!p.known) return 'none'
    if (p.valid) return 'included'
    if (p.synonymOf) return 'overlap'
    return null
  }
  return null
}

// ---- title ----
const titleHtml = computed(() => {
  const name = model.value?.twName || scientificName.value
  return name ? `${em(name)} in GBIF` : 'This taxon in GBIF'
})

// ---- 8.1 matched-name line ----
const matchedLineHtml = computed(() => {
  const m = model.value
  if (!m) return ''
  if (m.twAcceptedIsColSynonym) {
    return (
      `Catalogue of Life treats ${em(m.twName)} as a synonym of ` +
      `${em(m.colAcceptedName)} and files its records there. The comparison ` +
      `below is against ${em(m.colAcceptedName)}.`
    )
  }
  return `${em(m.colAcceptedName)} <span class="text-base-soft">· accepted in Catalogue of Life.</span>`
})

// ---- 8.2 relation statement ----
const line1 = computed(() => {
  const r = model.value?.relation
  if (!r) return ''
  return r.confidence === 'uncertain' && r.alternative?.plain
    ? `${r.alternative.plain}, or ${r.plain}`
    : r.plain
})

const provisionalSuffix = computed(() => {
  const r = model.value?.relation
  return r?.confidence === 'provisional'
    ? `, ${r.checkedNames} of ${r.totalNames} TaxonWorks names could be checked against Catalogue of Life`
    : ''
})

// ---- 8.3 explainer (verbatim copy, names substituted) ----
const explainerHtml = computed(() => {
  const m = model.value
  if (!m) return ''
  const tw = em(m.twName)
  const col = em(m.colAcceptedName)
  return (
    `This compares the names TaxonWorks treats as ${tw} with the names ` +
    `Catalogue of Life groups under its own ${col}. Each name is matched by ` +
    `its epithet, author and year, and where the original combination lines ` +
    `up on both sides the names are confirmed to share a type. It does not ` +
    `compare written diagnoses or the specimen records behind either concept. ` +
    `GBIF here is an aggregated checklist, not an authored revision, so read ` +
    `the result as a starting point for a person to judge.`
  )
})

// ---- 8.4 table ----
const captionHtml = computed(
  () =>
    `Every name TaxonWorks or Catalogue of Life files under ${em(
      model.value?.twName
    )}, and what the other source does with it.`
)
const colHeadTw = computed(() => `TaxonWorks:<br>${em(model.value?.twName)}`)
// Plain name, no link: the table's names are not links (the Catalogue of Life
// accepted taxon has its own link in the "Open in GBIF" line below).
const colHeadCol = computed(
  () => `Catalogue of Life:<br>${em(model.value?.colAcceptedName)}`
)

function accentStyle(which) {
  if (which === 'tw') return { '--pp-accent': 'var(--pp-tw)' }
  if (which === 'gb') return { '--pp-accent': 'var(--pp-gbif)' }
  return {}
}

function twRoleLabel(e) {
  return e.role === 'accepted' ? 'valid name' : 'synonym'
}

function colSideLabel(e) {
  const acc = model.value?.colAcceptedName || ''
  return canonicalName(e.name) === canonicalName(acc) ? 'accepted name' : 'synonym'
}

// Split a TaxonWorks placement into up to three template-safe pieces:
//   html  a v-html lead fragment (may be '')
//   name  the linked target name, rendered inside a RouterLink when otuId is set
//   tail  a v-html fragment after the link (starts with a non-space char)
// Any whitespace that must sit next to the link lives inside html/tail, never in
// a template text node, so Vue whitespace-condense leaves it alone.
function placementParts(p) {
  if (!p || !p.known) return { html: 'not in TaxonWorks' }
  if (p.ambiguous) return { html: 'more than one match in TaxonWorks' }
  const target = p.valid ? p.validName : p.synonymOf
  if (!target) {
    return {
      html: p.valid ? 'valid species in TaxonWorks' : 'synonym in TaxonWorks'
    }
  }
  const named = p.targetAuthor ? `${target} ${p.targetAuthor}` : target
  if (p.valid) {
    return p.otuId
      ? { html: '', name: named, otuId: p.otuId, tail: ', valid species' }
      : { html: `${em(named)}, valid species` }
  }
  return p.otuId
    ? { html: 'synonym of ', name: named, otuId: p.otuId }
    : { html: `synonym of ${em(named)}` }
}

function tierTitle(t) {
  if (t === 'homotypic')
    return 'The original combination lines up on both sides, so the names are confirmed to share a type.'
  if (t === 'probable')
    return 'Epithet, author and year agree, but the shared type could not be confirmed, so a secondary homonym is not fully ruled out.'
  if (t === 'weak')
    return 'Only the epithet matches, or the year is missing or differs by more than one. This lowers confidence where the relation depends on it.'
  return ''
}

// No match key shared between the two name sets: the relation is "cannot be
// compared". Show line 1 and the leftover name lists only, never the table.
const isNoComparison = computed(() => model.value?.relation?.icon === 'none')

const showCalmLine = computed(() => {
  const m = model.value
  if (!m?.zones || m.relation?.symbol !== '≡') return false
  const z = m.zones
  return !(
    z.twKeepsIn.length ||
    z.colFoldsIn.length ||
    z.misapplied.length ||
    z.inDataOnly.length ||
    z.notComparable.length
  )
})

// ---- 8.6 occurrence summary ----
const summaryHtml = computed(() => {
  const m = model.value
  if (!m?.counts || m.counts.total == null) return ''
  const href = esc(m.urls?.scopedOccurrence || '')
  const total = `<a href="${href}" target="_blank" rel="noopener" class="lnk-gbif">${fmt(
    m.counts.total
  )}</a>`
  const { withImage, withCoordinate } = m.counts
  const detail =
    typeof withImage === 'number' && typeof withCoordinate === 'number'
      ? ` (${fmt(withImage)} imaged, ${fmt(withCoordinate)} mapped)`
      : ''
  return `GBIF holds ${total} records${detail}.`
})

const inDataOnlySumN = computed(() =>
  (model.value?.zones?.inDataOnly || []).reduce((s, r) => s + (r.count || 0), 0)
)

// ---- 8.7 open in GBIF ----
const openInGbifHtml = computed(() => {
  const u = model.value?.urls
  if (!u) return ''
  const items = [
    [u.colTaxon, 'Catalogue of Life', 'The taxonomy the panels here use'],
    [
      u.backboneTaxon,
      'backbone',
      "GBIF's default view, which may group the names differently"
    ],
    [
      u.backboneOccurrence,
      'all occurrences',
      "Everything GBIF has, grouped GBIF's default way, not filtered by this project"
    ],
    [
      u.scopedOccurrence,
      'panel set',
      'The filtered set behind Images, Map and Type specimens'
    ]
  ]
  const links = items
    .filter(([href]) => href)
    .map(
      ([href, label, title]) =>
        `<a class="lnk-gbif" target="_blank" rel="noopener" href="${esc(
          href
        )}" title="${esc(title)}">${esc(label)}</a>`
    )
  if (!links.length) return ''
  return `<span class="text-base-soft">Open in GBIF:</span> ${links.join(
    ' &middot; '
  )}`
})

// ---- TaxonWorks placement for a colFoldsIn row ----
// `row` must be the reactive element from model.value.zones.colFoldsIn, so the
// per-row icon and the placement link update when the lookup lands.
async function resolvePlacementRow(row) {
  if (row.twPlacement || row.pending) return
  row.pending = true
  try {
    row.twPlacement = await fetchTwPlacement(row.name)
    row.twPlacementParts = placementParts(row.twPlacement)
  } finally {
    row.pending = false
  }
}

// ---- load ----
async function load() {
  if (typeof window === 'undefined') return
  const name = scientificName.value
  // Drop the previous taxon's model on every navigation so the spinner shows
  // during the fetch instead of the stale relation row / table / <h2> name.
  model.value = null
  if (!name) return
  const forName = name
  loading.value = true
  showExplainer.value = false
  try {
    const result = await resolveConceptAlignment(name, props.taxonId, {
      rejectHigherRank: true
    })
    if (scientificName.value !== forName) return
    model.value = result
    // Each colFoldsIn row needs one reverse lookup for its relation icon and
    // its "TaxonWorks places it under X" link. Resolve them in parallel through
    // the reactive model (not `result`) so the cells fill in as each returns.
    // This is a deliberate deviation from spec 5.4 ("0 reverse lookups on
    // load"); the row count is small (typically one to five).
    for (const row of model.value?.zones?.colFoldsIn || []) {
      resolvePlacementRow(row)
    }
    if (result?.urls?.scopedOccurrence) {
      recordRequest(requestStore, 'panel:gbif-taxon', {
        url: result.urls.scopedOccurrence,
        data: result
      })
    }
  } catch (e) {
    if (scientificName.value === forName)
      model.value = { matched: false, error: true }
  } finally {
    if (scientificName.value === forName) loading.value = false
  }
}

onMounted(() => {
  mounted.value = true
})

watch(scientificName, load, { immediate: true })
</script>

<style scoped>
.rel-ico {
  flex: none;
  margin-top: 0.15rem;
}
.rel-ico rect {
  fill-opacity: 0.22;
  stroke-width: 2;
}
.rel-ico .tw {
  fill: var(--pp-tw);
  stroke: var(--pp-tw);
}
.rel-ico .gb {
  fill: var(--pp-gbif);
  stroke: var(--pp-gbif);
}

/* Link colour encodes the destination: green for gbif.org, site blue for a
   TaxonWorks page. */
.lnk-gbif {
  color: var(--pp-gbif);
  text-decoration: underline;
}
.lnk-tw {
  color: var(--pp-tw);
  text-decoration: underline;
}

.shorthand {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.shorthand .tw {
  color: var(--pp-tw);
  font-weight: 600;
}
.shorthand .gb {
  color: var(--pp-gbif);
}

.ztable {
  width: 100%;
  border-collapse: collapse;
}
.ztable th,
.ztable td {
  text-align: left;
  padding: 0.3rem 0.4rem;
  vertical-align: top;
}
.ztable thead th {
  font-weight: 600;
}
.ztable .nm {
  font-style: italic;
}
.ztable .also {
  font-style: normal;
  font-size: 0.65rem;
  opacity: 0.55;
  margin-top: 0.1rem;
}
.ztable .ic {
  width: 2.6rem;
  padding-left: 0.2rem;
  padding-right: 0.2rem;
  text-align: center;
}
.rel-ico-sm {
  vertical-align: middle;
}
.rel-ico-sm rect {
  fill-opacity: 0.22;
  stroke-width: 2;
}
.rel-ico-sm .tw {
  fill: var(--pp-tw);
  stroke: var(--pp-tw);
}
.rel-ico-sm .gb {
  fill: var(--pp-gbif);
  stroke: var(--pp-gbif);
}
.ztable .rec {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ztable .rec.is-zero {
  opacity: 0.5;
}

.zheading td {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.68rem;
  font-weight: 700;
  padding-top: 0.5rem;
  box-shadow: inset 3px 0 0 var(--pp-accent, transparent);
}

.tier {
  display: inline-block;
  font-style: normal;
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 0.2rem;
  margin-left: 0.3rem;
  white-space: nowrap;
  opacity: 0.65;
}
.tier.weak {
  font-weight: 700;
  opacity: 1;
}
</style>
