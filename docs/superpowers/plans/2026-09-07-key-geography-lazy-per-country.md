# Key geography lazy per-country redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eager, all-country geography sweep in the dichotomous-key
filter with a lazy probe that only fetches after the reader picks a country, and
consolidate every hard-coded geographic set into one module.

**Architecture:** Nothing fetches on key load. The picker shows a static country
list. On country selection, one flat `/dwc_occurrences?<rankcols>&country=C&occurrenceStatus=present&per=1`
presence probe is fired per terminal (and per expected completeness taxon) per
selected country, at concurrency 8, results cached per `(country, probe-signature)`.
A one-time no-country "has data" probe per terminal separates *unknown* from
*out of area*. `/asserted_distributions` walks and `/otus/:id/inventory/dwc.json`
leave the common path; `inventory/dwc.json` stays only as the fallback for
subgenus / nameless terminals.

**Tech Stack:** Vue 3 composables + `@sfgrp/taxonpages` package internals;
`makeAPIRequest` (axios) against `https://sfg.taxonworks.org/api/v1`; pure libs
tested with `node --test` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-09-07-key-geography-lazy-per-country-design.md`

## Global Constraints

- Pure libs live in `modules/keys/lib/`, tested with `node:test` (`import { test } from 'node:test'`),
  run by `npm test`. Match the existing `modules/keys/lib/*.test.js` style.
- No new colour literals or Tailwind palette classes; theme tokens only (CLAUDE.md).
- No em/en dashes or `" - "` in prose, comments, commit messages, UI copy — commas / colons / parens.
- Every flat probe sends `occurrenceStatus=present` and `per=1`; presence is read
  from the `Pagination-Total` response header, response-body length as fallback.
- Probe by the **valid** taxon-name string: redirect synonyms through
  `effectiveTaxonNameId` (`modules/keys/lib/validTaxonName.js`) before taking the name.
- Region-only records are **not** expanded to member countries. A shape that
  resolves to no single country is simply invisible to a `country=` probe. Do not
  reintroduce client-side TDWG expansion.
- Local `modules/` changes need a full `npm run dev` restart to take effect
  (no HMR for this tree).
- Concurrency: reuse the existing `mapPool(items, limit, fn, shouldStop)` helper
  in `useKeyGeography.js`; probe pools run at limit 8.
- Generation guard: every async path in `useKeyGeography.load()` and in
  `KeyView`'s completeness pipeline already captures `myGen === ++gen` /
  `myGen === loadGen` and bails when stale. Keep that pattern on every new path.

---

## File Structure

**Create**
- `modules/keys/lib/geoData.js` — the single home for hard-coded geographic sets:
  `ISO_NAME`, `NAME_ALIASES_DISPLAY`, `ASIAN_RUSSIA`, `SLUG_LABEL`,
  `EUROPEAN_RUSSIA`, `GEOGRAPHY_PRESETS`. Data only, plus trivially derived maps.
- `modules/keys/lib/geoData.test.js`
- `modules/keys/lib/geoProbe.js` — `probeParams(term)`, `PRESENCE_PARAMS`, `probeSig`.
- `modules/keys/lib/geoProbe.test.js`

**Modify**
- `modules/keys/lib/geoNormalize.js` — import the data from `geoData.js`; keep every function.
- `modules/keys/lib/geoNormalize.test.js` — no behaviour change; runs as-is.
- `modules/keys/lib/geoMatch.js` — `territoryStatus` and `leadGeoStatus` gain a
  "has data anywhere" input so an empty selected-country set can mean *out* not *unknown*.
- `modules/keys/lib/geoMatch.test.js`
- `modules/keys/lib/completeness.js` — `geoScope` gains `hasDataByTaxonId`; thread into `geoStatusOf`.
- `modules/keys/lib/completeness.test.js`
- `modules/keys/composables/useKeyGeography.js` — full rewrite to the lazy model.
- `modules/keys/KeyView.vue` — new composable wiring; per-country completeness
  pill; provide `hasDataByOtu`; drop `scopeOtuIdRef` / `geoScopeOtuId` /
  `assembleExpectedTerritories` / `fetchTaxonTerritories` / `territoriesByExpectedId`.
- `modules/keys/components/GeographyPicker.vue` — territory list is the static
  list; remove the per-row `otuCount` span.
- `modules/keys/components/TaxonLink.vue` — dim only when the terminal has data
  somewhere but in none of the selected countries.
- `modules/keys/components/GuidedView.vue` — pass `hasDataByOtu` to `leadGeoStatus`.
- `modules/keys/components/FullKeyView.vue` — pass `hasDataByOtu` to `leadGeoStatus`.

**Delete**
- `panels/PanelKeys/geographyCategories.js` — its one importer (`KeyView.vue`) repoints to `geoData.js`.

**Untouched (interfaces preserved):** `geoScope.js` (`fieldForRank` is reused;
`needsDescendantAd` / `needsSpecimenPass` become dead but are left in place),
`geoPrefs.js`, `validTaxonName.js`, `KeyHeader.vue`, `GeographyPicker.vue` props
shape (minus `otuCount`).

---

## Task 1: Consolidate hard-coded geographic sets into `geoData.js`

Pure data move. No behaviour change. Existing tests must stay green.

**Files:**
- Create: `modules/keys/lib/geoData.js`
- Create: `modules/keys/lib/geoData.test.js`
- Modify: `modules/keys/lib/geoNormalize.js` (top: replace inline constants with an import)
- Modify: `modules/keys/KeyView.vue:68` (import path)
- Delete: `panels/PanelKeys/geographyCategories.js`

**Interfaces:**
- Produces:
  - `ISO_NAME: Record<string,string>` (ISO2 -> canonical English name)
  - `NAME_ALIASES_DISPLAY: Record<string,string>` (alt spelling -> ISO2)
  - `ASIAN_RUSSIA: Set<string>` (lowercased WGSRPD unit names east of the Urals)
  - `SLUG_LABEL: Record<string,string>` (e.g. `{ 'russia-european': 'European Russia' }`)
  - `EUROPEAN_RUSSIA: { key: 'russia-european', label: 'European Russia' }`
  - `GEOGRAPHY_PRESETS: Array<{ id, label, members: string[] }>` (moved verbatim
    from `geographyCategories.js`; `members` are territory keys as
    `geoNormalize` emits them)

- [ ] **Step 1: Create `geoData.js` with the moved constants**

Move these verbatim out of `modules/keys/lib/geoNormalize.js`: `ISO_NAME` (the
full object), `NAME_ALIASES_DISPLAY`, `ASIAN_RUSSIA`, `SLUG_LABEL`,
`EUROPEAN_RUSSIA`. Move `GEOGRAPHY_PRESETS` out of
`panels/PanelKeys/geographyCategories.js` (rename the default-export array to a
named `GEOGRAPHY_PRESETS`). File header:

```js
// The single home for every hard-coded geographic set the dichotomous-key
// geography filter relies on: the country list, the alternate-spelling map, the
// Asian-Russia WGSRPD units, slug labels, and the named region presets. Pure
// data, no Vue, no network. Consumers (geoNormalize.js functions, geoProbe.js,
// KeyView's picker) import from here; nothing else may define country names,
// codes, aliases, or groupings. See docs/superpowers/specs/2026-09-07-key-geography-lazy-per-country-design.md section 7a.

export const ISO_NAME = { /* ...moved verbatim... */ }

export const NAME_ALIASES_DISPLAY = { /* ...moved verbatim... */ }

export const ASIAN_RUSSIA = new Set([ /* ...moved verbatim... */ ])

export const SLUG_LABEL = { 'russia-european': 'European Russia' }

export const EUROPEAN_RUSSIA = { key: 'russia-european', label: 'European Russia' }

// Named region groupings. Each expands to its FULL member list regardless of
// which members the current key reaches, so the geographic-completeness
// denominator is never silently narrowed. `members` are territory keys as
// geoNormalize.js emits them (ISO 3166-1 alpha-2 plus the `russia-european` slug).
// Add a grouping = add an entry. Edit what counts as "Europe" = edit the array.
export const GEOGRAPHY_PRESETS = [
  {
    id: 'europe',
    label: 'Europe',
    members: [
      'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE',
      'FO', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT',
      'LU', 'MT', 'MD', 'MC', 'ME', 'MK', 'NL', 'NO', 'PL', 'PT', 'RO', 'SM',
      'RS', 'SK', 'SI', 'ES', 'SJ', 'SE', 'CH', 'TR', 'UA', 'GB', 'VA',
      'russia-european'
    ]
  }
]
```

- [ ] **Step 2: Write `geoData.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ISO_NAME, NAME_ALIASES_DISPLAY, GEOGRAPHY_PRESETS, EUROPEAN_RUSSIA
} from './geoData.js'

test('ISO_NAME keys are 2-letter uppercase, values non-empty', () => {
  for (const [k, v] of Object.entries(ISO_NAME)) {
    assert.match(k, /^[A-Z]{2}$/)
    assert.ok(v && typeof v === 'string')
  }
})

test('every NAME_ALIASES_DISPLAY target is a known ISO code or the euro-russia slug', () => {
  const known = new Set(Object.keys(ISO_NAME))
  for (const iso of Object.values(NAME_ALIASES_DISPLAY)) {
    assert.ok(known.has(iso), `alias target ${iso} not in ISO_NAME`)
  }
})

test('every GEOGRAPHY_PRESETS member resolves to a known country or a known slug', () => {
  const known = new Set([...Object.keys(ISO_NAME), EUROPEAN_RUSSIA.key])
  for (const g of GEOGRAPHY_PRESETS) {
    assert.ok(g.id && g.label && Array.isArray(g.members))
    for (const m of g.members) assert.ok(known.has(m), `${g.id} member ${m} unknown`)
  }
})

test('GEOGRAPHY_PRESETS ids are unique', () => {
  const ids = GEOGRAPHY_PRESETS.map((g) => g.id)
  assert.equal(new Set(ids).size, ids.length)
})
```

- [ ] **Step 3: Run the new test, expect FAIL then PASS**

Run: `npm test 2>&1 | grep -E "geoData|# (pass|fail)"`
Expected first run: the file errors (import not found) until Step 1 is saved; once both are saved, PASS.

- [ ] **Step 4: Repoint `geoNormalize.js`**

At the top of `modules/keys/lib/geoNormalize.js`, delete the inline `ISO_NAME`,
`NAME_ALIASES_DISPLAY`, `ASIAN_RUSSIA`, `SLUG_LABEL`, `EUROPEAN_RUSSIA`
definitions and add:

```js
import {
  ISO_NAME, NAME_ALIASES_DISPLAY, ASIAN_RUSSIA, SLUG_LABEL, EUROPEAN_RUSSIA
} from './geoData.js'
```

Leave every function (`norm`, `slug`, `nameToIso`, `countryName`, `allCountries`,
`territoryLabel`, `russiaTerritory`, `normalizeShape`, `normalizeCountryString`)
and the derived `NAME_ALIASES` / `NAME_ISO` / `SLUG_LABEL` usage exactly as they are.

- [ ] **Step 5: Repoint `KeyView.vue` and delete `geographyCategories.js`**

In `modules/keys/KeyView.vue` change line 68 from

```js
import geoCategories from '../../panels/PanelKeys/geographyCategories.js'
```

to

```js
import { GEOGRAPHY_PRESETS as geoCategories } from './lib/geoData.js'
```

Then `git rm panels/PanelKeys/geographyCategories.js`. Grep to confirm no other
importer: `grep -rn geographyCategories --include=*.js --include=*.vue . | grep -v node_modules` -> no hits.

- [ ] **Step 6: Full test run**

Run: `npm test 2>&1 | tail -8`
Expected: `# pass` count = previous total + 4, `# fail 0`.

- [ ] **Step 7: Build check**

Run: `npm run build 2>&1 | tail -12`
Expected: build completes with no unresolved-import error for `geoData.js` or `geographyCategories.js`.

- [ ] **Step 8: Commit**

```bash
git add modules/keys/lib/geoData.js modules/keys/lib/geoData.test.js \
        modules/keys/lib/geoNormalize.js modules/keys/KeyView.vue
git rm panels/PanelKeys/geographyCategories.js
git commit -m "refactor(keys): consolidate hard-coded geographic sets into geoData.js

All country names, alias spellings, Asian-Russia units, slug labels and the
region presets now live in modules/keys/lib/geoData.js. geoNormalize.js keeps
only functions; geographyCategories.js is deleted and KeyView repointed. No
behaviour change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012Z8okD4WPviUoryHTuHjaa"
```

---

## Task 2: `geoProbe.js` — rank to probe params

Pure. Given a resolved terminal, produce the flat `/dwc_occurrences` filter
params and a canonical cache signature, or signal the `inventory/dwc.json` fallback.

**Files:**
- Create: `modules/keys/lib/geoProbe.js`
- Create: `modules/keys/lib/geoProbe.test.js`

**Interfaces:**
- Consumes: `fieldForRank` from `./geoScope.js`, `normRank` from `./completeness.js`.
- Produces:
  - `probeParams(term: { rank: string, name: string }) -> { params: Record<string,string>, sig: string } | { fallback: 'inventory' }`
  - `PRESENCE_PARAMS: { occurrenceStatus: 'present', per: 1 }` (spread into every flat probe)
  - `probeSig(params: Record<string,string>) -> string` (stable key: entries sorted, `k=v` joined by `&`)

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeParams, probeSig, PRESENCE_PARAMS } from './geoProbe.js'

test('family / subfamily / tribe / genus -> single column', () => {
  assert.deepEqual(probeParams({ rank: 'family', name: 'Curculionidae' }),
    { params: { family: 'Curculionidae' }, sig: 'family=Curculionidae' })
  assert.deepEqual(probeParams({ rank: 'subfamily', name: 'Entiminae' }),
    { params: { subfamily: 'Entiminae' }, sig: 'subfamily=Entiminae' })
  assert.deepEqual(probeParams({ rank: 'tribe', name: 'Otiorhynchini' }),
    { params: { tribe: 'Otiorhynchini' }, sig: 'tribe=Otiorhynchini' })
  assert.deepEqual(probeParams({ rank: 'genus', name: 'Curculio' }),
    { params: { genus: 'Curculio' }, sig: 'genus=Curculio' })
})

test('species -> genus + specificEpithet', () => {
  assert.deepEqual(probeParams({ rank: 'species', name: 'Otiorhynchus sulcatus' }),
    { params: { genus: 'Otiorhynchus', specificEpithet: 'sulcatus' },
      sig: 'genus=Otiorhynchus&specificEpithet=sulcatus' })
})

test('species with a subgenus parenthetical -> parenthetical dropped', () => {
  assert.deepEqual(
    probeParams({ rank: 'species', name: 'Otiorhynchus (Otiorhynchus) sulcatus' }),
    { params: { genus: 'Otiorhynchus', specificEpithet: 'sulcatus' },
      sig: 'genus=Otiorhynchus&specificEpithet=sulcatus' })
})

test('subgenus rank -> inventory fallback (0% flat column on this project)', () => {
  assert.deepEqual(probeParams({ rank: 'subgenus', name: 'Otiorhynchus' }),
    { fallback: 'inventory' })
})

test('rank above family -> inventory fallback', () => {
  assert.deepEqual(probeParams({ rank: 'superfamily', name: 'Curculionoidea' }),
    { fallback: 'inventory' })
})

test('missing / blank name -> inventory fallback', () => {
  assert.deepEqual(probeParams({ rank: 'genus', name: '' }), { fallback: 'inventory' })
  assert.deepEqual(probeParams({ rank: 'genus' }), { fallback: 'inventory' })
})

test('degenerate species name (one token, or genus === epithet) -> fallback', () => {
  assert.deepEqual(probeParams({ rank: 'species', name: 'Curculio' }), { fallback: 'inventory' })
})

test('PRESENCE_PARAMS is the always-added pair', () => {
  assert.deepEqual(PRESENCE_PARAMS, { occurrenceStatus: 'present', per: 1 })
})

test('probeSig is order-independent', () => {
  assert.equal(probeSig({ specificEpithet: 'sulcatus', genus: 'Otiorhynchus' }),
    'genus=Otiorhynchus&specificEpithet=sulcatus')
})
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test modules/keys/lib/geoProbe.test.js`
Expected: FAIL, "Cannot find module './geoProbe.js'".

- [ ] **Step 3: Implement `geoProbe.js`**

```js
// Pure. Resolve a key terminal (or a completeness target taxon) to the flat
// dwc_occurrences presence-probe params + a canonical cache signature, or the
// inventory/dwc.json fallback when no flat column applies.
//
// `name` must be the VALID taxon-name string (caller redirects synonyms through
// effectiveTaxonNameId first). See the design spec section 4.

import { fieldForRank } from './geoScope.js'
import { normRank } from './completeness.js'

export const PRESENCE_PARAMS = { occurrenceStatus: 'present', per: 1 }

export function probeSig(params) {
  return Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

export function probeParams(term) {
  const rank = normRank(term?.rank)
  const name = String(term?.name || '').trim()
  if (!name) return { fallback: 'inventory' }

  const field = fieldForRank(rank) // 'family' | 'subfamily' | 'tribe' | 'genus' | null
  if (field) {
    const params = { [field]: name }
    return { params, sig: probeSig(params) }
  }

  if (rank === 'species') {
    const parts = name.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/)
    const genus = parts[0]
    const epithet = parts[parts.length - 1]
    if (!genus || !epithet || genus === epithet) return { fallback: 'inventory' }
    const params = { genus, specificEpithet: epithet }
    return { params, sig: probeSig(params) }
  }

  // subgenus (0% flat-column population), unranked, anything above family
  return { fallback: 'inventory' }
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test modules/keys/lib/geoProbe.test.js`
Expected: all tests pass.

- [ ] **Step 5: Full suite**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add modules/keys/lib/geoProbe.js modules/keys/lib/geoProbe.test.js
git commit -m "feat(keys): geoProbe.js — rank to flat dwc_occurrences probe params

probeParams(term) maps family/subfamily/tribe/genus to a single column,
species to genus+specificEpithet (subgenus parenthetical dropped), and
everything else (subgenus, ranks above family, missing name) to the
inventory/dwc.json fallback. probeSig gives a stable per-(country) cache key.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012Z8okD4WPviUoryHTuHjaa"
```

---

## Task 3: `geoMatch.js` — distinguish *out* from *unknown* with a has-data flag

Lazy probing only ever populates a taxon's territory set with *selected*
countries, so an empty set no longer means "no data anywhere". Give
`territoryStatus` and `leadGeoStatus` an explicit "has data somewhere" input.
**Default it to `false`** (`hasDataAnywhere` unknown => empty set stays
`'unknown'`, exactly today's behaviour): a `true` default would flip every
existing empty-set case from `'unknown'` to `'out'` and break the current
`geoMatch.test.js` cases. Callers with real knowledge (Task 4 completeness,
Task 6/7 consumers) pass the actual boolean.

**Files:**
- Modify: `modules/keys/lib/geoMatch.js`
- Modify: `modules/keys/lib/geoMatch.test.js`

**Interfaces:**
- Produces:
  - `territoryStatus(set: Set<string>|null, effectiveKeys: Set<string>, hasDataAnywhere = false) -> 'in' | 'out' | 'unknown'`
  - `leadGeoStatus(reachableOtuIds, territoriesByOtu: Map, effectiveKeys: Set<string>, hasDataByOtu: Map<number,boolean> | null = null) -> 'in' | 'out' | 'unknown'`
    (when `hasDataByOtu` is null, calls `territoryStatus` with only two args, letting its default apply)

- [ ] **Step 1: Update the tests**

Add to `modules/keys/lib/geoMatch.test.js`:

```js
test('territoryStatus: empty set + hasDataAnywhere=false -> unknown', () => {
  assert.equal(territoryStatus(new Set(), new Set(['DE']), false), 'unknown')
})

test('territoryStatus: empty set + hasDataAnywhere=true -> out', () => {
  assert.equal(territoryStatus(new Set(), new Set(['DE']), true), 'out')
})

test('territoryStatus: default hasDataAnywhere is false -> empty set stays unknown', () => {
  assert.equal(territoryStatus(new Set(), new Set(['DE'])), 'unknown')
})

test('territoryStatus: a selected-country hit still wins over hasDataAnywhere -> in', () => {
  assert.equal(territoryStatus(new Set(['DE']), new Set(['DE', 'FR']), false), 'in')
})

test('territoryStatus: non-empty disjoint set -> out regardless of hasDataAnywhere', () => {
  assert.equal(territoryStatus(new Set(['MG']), new Set(['DE', 'FR']), false), 'out')
})

test('leadGeoStatus: all reachable terminals lack data anywhere -> unknown', () => {
  const terr = new Map()
  const has = new Map([[1, false], [2, false]])
  assert.equal(leadGeoStatus([1, 2], terr, new Set(['DE']), has), 'unknown')
})

test('leadGeoStatus: a reachable terminal has data but not in area -> out', () => {
  const terr = new Map()
  const has = new Map([[1, true]])
  assert.equal(leadGeoStatus([1], terr, new Set(['DE']), has), 'out')
})

test('leadGeoStatus: a reachable terminal is in area -> in', () => {
  const terr = new Map([[1, new Set(['DE'])]])
  const has = new Map([[1, true]])
  assert.equal(leadGeoStatus([1], terr, new Set(['DE']), has), 'in')
})

test('leadGeoStatus: no hasDataByOtu map -> empty set is unknown (today behaviour)', () => {
  const terr = new Map([[1, new Set()]])
  assert.equal(leadGeoStatus([1], terr, new Set(['DE'])), 'unknown')
})
```

Note: EVERY existing `territoryStatus` / `leadGeoStatus` test in this file must
still pass unchanged. The `false` default is chosen precisely so they do (the
existing `territoryStatus(new Set(), EFF) -> 'unknown'` and
`leadGeoStatus([1,2], {1:['MG'],2:Set()}, EFF) -> 'unknown'` cases rely on it).

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test modules/keys/lib/geoMatch.test.js`
Expected: the two new `hasDataAnywhere=true -> out` cases FAIL (current code
ignores the third arg and returns `'unknown'` for any empty set). Every other
case, new and existing, PASSES already.

- [ ] **Step 3: Implement**

Replace `territoryStatus` and `leadGeoStatus` in `modules/keys/lib/geoMatch.js`:

```js
// One taxon's territory key set vs the effective selection:
//   'in'      recorded from at least one selected territory
//   'out'     not in any selected territory, but recorded somewhere
//   'unknown' no distribution data at all (or no filter active)
// `set` under the lazy probe model only ever holds SELECTED countries, so an
// empty set is disambiguated by `hasDataAnywhere` (the no-country has-data
// probe). Default false: without that signal, an empty set stays 'unknown',
// matching the pre-lazy behaviour.
export function territoryStatus(set, effectiveKeys, hasDataAnywhere = false) {
  if (!effectiveKeys || effectiveKeys.size === 0) return 'in'
  if (set && set.size) {
    for (const k of set) if (effectiveKeys.has(k)) return 'in'
    return 'out'
  }
  return hasDataAnywhere ? 'out' : 'unknown'
}

// Roll a status up a lead: 'in' if ANY reachable terminal is in area; else
// 'unknown' if any reachable terminal is unknown (never dim a branch that might
// still be relevant); else 'out'. No reachable terminals -> 'unknown'.
export function leadGeoStatus(reachableOtuIds, territoriesByOtu, effectiveKeys, hasDataByOtu = null) {
  if (!effectiveKeys || effectiveKeys.size === 0) return 'in'
  let sawUnknown = false
  let sawAny = false
  for (const id of reachableOtuIds || []) {
    sawAny = true
    const set = territoriesByOtu.get(id) ?? territoriesByOtu.get(Number(id)) ?? null
    const st = hasDataByOtu
      ? territoryStatus(
          set,
          effectiveKeys,
          hasDataByOtu.get(id) ?? hasDataByOtu.get(Number(id)) ?? false
        )
      : territoryStatus(set, effectiveKeys)
    if (st === 'in') return 'in'
    if (st === 'unknown') sawUnknown = true
  }
  return !sawAny || sawUnknown ? 'unknown' : 'out'
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `node --test modules/keys/lib/geoMatch.test.js`
Expected: all pass.

- [ ] **Step 5: Full suite**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add modules/keys/lib/geoMatch.js modules/keys/lib/geoMatch.test.js
git commit -m "feat(keys): territoryStatus takes an explicit has-data-anywhere flag

Under lazy per-country probing an empty territory set means 'not in any
selected country', which is 'out' when the taxon has data somewhere and only
'unknown' when it has none. New optional arg, defaulted true so existing
callers are unchanged until wired up.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012Z8okD4WPviUoryHTuHjaa"
```

---

## Task 4: `completeness.js` — thread `hasDataByTaxonId` through the geographic pass

**Files:**
- Modify: `modules/keys/lib/completeness.js` (the `geoScope` destructure, `geoStatusOf`)
- Modify: `modules/keys/lib/completeness.test.js`

**Interfaces:**
- Consumes: `territoryStatus(set, eff, hasDataAnywhere)` from Task 3.
- Produces: `buildCompletenessReport`'s `geoScope` input gains an optional field:
  `geoScope.hasDataByTaxonId: Set<number> | null` — taxon-name ids known to have
  a present record somewhere (any country). Absent / null => `geoStatusOf` calls
  `territoryStatus` with its default (`hasDataAnywhere = false`), so an expected
  taxon with an empty territory set stays `'unknown'`, exactly today's behaviour.
  In the real Task 6 flow the Set is always supplied.

- [ ] **Step 1: Update tests**

In `modules/keys/lib/completeness.test.js`, find the geoScope test block and add:

```js
test('geoScope: expected taxon with empty territories + not in hasDataByTaxonId -> unknownExpected', () => {
  // build a minimal report input with one target taxon that has no territories
  // and is absent from hasDataByTaxonId; assert it lands in geographic.unknownExpected
  // (mirror the existing geoScope test's input shape)
})

test('geoScope: expected taxon with empty territories but IN hasDataByTaxonId -> excluded from denominator, not unknown', () => {
  // same input, taxon id added to hasDataByTaxonId; assert it is NOT in
  // unknownExpected and NOT counted in geographic.expectedCount
})
```

Fill both in against the existing geoScope test's `buildCompletenessReport({...})`
input shape in that file (reuse its `descendants` / `terminalTnIds` / `geoScope`
scaffold; only add `hasDataByTaxonId` and adjust `territoriesByTaxonId`).

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test modules/keys/lib/completeness.test.js`
Expected: the two new cases FAIL (current `geoStatusOf` returns 'unknown' for an empty set regardless).

- [ ] **Step 3: Implement**

In `buildCompletenessReport`, extend the `geoScope` read:

```js
  const geoEff = geoScope && geoScope.effectiveKeys
  const geoActive = !!(geoEff && geoEff.size)
  const geoByTid =
    geoActive && geoScope.territoriesByTaxonId instanceof Map
      ? geoScope.territoriesByTaxonId
      : null
  const geoHasData =
    geoActive && geoScope.hasDataByTaxonId instanceof Set
      ? geoScope.hasDataByTaxonId
      : null
  const geoStatusOf = (id) =>
    geoActive
      ? territoryStatus(
          geoByTid ? geoByTid.get(id) : null,
          geoEff,
          geoHasData ? geoHasData.has(id) : false
        )
      : undefined
```

`buildGeographic` needs no change: it already branches on `geoStatusOf(d.id)`
returning `'unknown'` / `'in'` / `'out'`.

- [ ] **Step 4: Run, expect PASS**

Run: `node --test modules/keys/lib/completeness.test.js`
Expected: all pass.

- [ ] **Step 5: Full suite**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add modules/keys/lib/completeness.js modules/keys/lib/completeness.test.js
git commit -m "feat(keys): completeness geoScope accepts hasDataByTaxonId

An expected taxon with no recorded presence in any selected country is
'out' (excluded from the area denominator) when it has data somewhere and
'unknown' (listed as unassessable) only when it has none. Optional Set,
null-safe to today's behaviour.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012Z8okD4WPviUoryHTuHjaa"
```

---

## Task 5: Rewrite `useKeyGeography.js` to the lazy per-country model

The core change. No composable test harness exists in this repo, so correctness
rides on Tasks 2 to 4 (pure, tested) plus the manual procedure in Step 6.

**Files:**
- Modify (rewrite): `modules/keys/composables/useKeyGeography.js`

**Interfaces:**
- Consumes: `probeParams`, `probeSig`, `PRESENCE_PARAMS` (`./lib/geoProbe.js` -> adjust path to `../lib/geoProbe.js`); `effectiveTaxonNameId` (`../lib/validTaxonName.js`); `normalizeCountryString`, `countryName`, `territoryLabel` (`../lib/geoNormalize.js`); `GEOGRAPHY_PRESETS` is NOT needed here (KeyView owns presets); `makeAPIRequest` (`@/utils/request`).
- Produces (the new return object):

```
useKeyGeography(terminalListRef) -> {
  allTerritories,   // computed<Array<{ key, label }>>  static country list, alpha by label
  territoriesByOtu, // ref<Map<number, Set<string>>>    per terminal: SELECTED countries it probed present in
  hasDataByOtu,     // ref<Map<number, boolean>>        per terminal: has a present record in ANY country
  loading,          // ref<boolean>                     true while any probe batch is in flight
  reset,            // () => void
  ensureLoaded,     // () => void   resolve terminals (rank + synonym redirect); NO distribution fetch
  syncSelection,    // (effectiveKeys: Set<string>) => Promise<void>
                    //   fire the one-time has-data batch (first call with a non-empty selection)
                    //   + a presence batch for any selected country not yet in the cache
  probeTaxa         // (taxa: Array<{ tnId:number, rank:string, name:string }>, effectiveKeys: Set<string>)
                    //   => Promise<{ territoriesByTaxonId: Map<number, Set<string>>, hasDataByTaxonId: Set<number> }>
                    //   used by KeyView's completeness pill for expected modal-rank taxa (in-key + gaps)
}
```

Shared internal state (all reset by `reset()` / a fresh `gen`):
- `terminals: Map<otuId, { rank, name, tnId, forceInventory?: boolean }>` (from `ensureLoaded`)
- `probeCache: Map<countryKey, Map<sig, boolean>>`
- `hasDataBySig: Map<sig, boolean>`
- `hasDataDone: boolean` (the one-time no-country batch has run for this `gen`)
- `inventoryCountryCache: Map<otuId, Set<countryKey>>` (fallback terminals only)
- `loadedFor: string | null` (the terminal-id signature `ensureLoaded` resolved)

- [ ] **Step 1: Rewrite the module**

Structure (write the full file; key mechanics below):

1. **Constants:** `PROBE_CONCURRENCY = 8`. Drop `DWC_CONCURRENCY`, `AD_*`,
   `FLAT_*`, `ROOT_PREFILTER_MIN_TERMINALS`, `SPECIMEN_TYPES`.

2. **Country list:** narrow `geoNormalize.allCountries()` to canonical entries
   only (drop the alias-spelling entries — they existed solely as probe targets
   for the removed eager sweep; the lazy probe sends `countryName(iso)`). It now
   returns `[{ key, label }]` for every ISO code, and `useKeyGeography` exposes a
   sorted-by-label copy as `allTerritories`. Region presets are added by KeyView,
   not here. Update `geoNormalize.test.js` if it asserts alias entries are present.

3. **`ensureLoaded()`**: if `terminals` already resolved for the current terminal
   id signature, return. Otherwise `GET /otus?otu_id[]=...&per=1000` ->
   `otuId -> taxon_name_id`; `GET /taxon_names?taxon_name_id[]=...&per=1000` ->
   `{ rank, name, cached_is_valid, cached_valid_taxon_name_id }`. For each
   terminal, `validTnId = effectiveTaxonNameId(row)`; if it differs and its row
   was not in the batch, fetch the missing valid rows once
   (same pattern as the current code's `validIdByTn` block). Store
   `terminals.set(otuId, { rank: validRow.rank, name: validRow.name, tnId: validTnId })`.
   No distribution call. Set `loading = false` at the end. Keep the
   `watch(terminalListRef, ...)` re-resolve.

4. **`probeOne(sig, params, countryKey)`** (internal): if
   `probeCache.get(countryKey)?.has(sig)` return cached. Else
   `GET /dwc_occurrences` with `{ ...params, country: countryName(countryKey) ?? territoryLabel(countryKey), ...PRESENCE_PARAMS }`,
   read `Pagination-Total` header (fallback body length), store boolean in
   `probeCache`, return it. Wrap in try/catch -> `false` on error ("one country
   short on data is tolerable"). Respect a `shouldStop` closure (`myGen !== gen`).

   Note on country string: `countryName(iso)` gives the canonical spelling; the
   spike showed the common ones match the cache. Alias spellings are a known
   follow-up (spec section 6, "Country-name spelling") — not blocking here.

5. **`probeHasData(sig, params)`** (internal): like `probeOne` but no `country`;
   cache in `hasDataBySig`.

6. **`inventoryCountries(otuId, shouldStop)`** (internal, fallback path):
   `GET /otus/:otuId/inventory/dwc.json`; collect `normalizeCountryString(row.country)?.key`
   for rows with `dwc_occurrence_object_type` in `CollectionObject | FieldOccurrence`
   OR (AssertedDistribution rows are fine here too — this fallback is only for
   small taxa) any row with a `country`. Cache in `inventoryCountryCache`. Used
   for both has-data (non-empty) and per-country (`set.has(countryKey)`).

7. **`syncSelection(effectiveKeys)`**: `const myGen = gen`. Ensure `ensureLoaded()`
   has run. Build the per-terminal probe descriptor list from `terminals` via
   `probeParams`. Then:
   - **has-data batch**, once: if `!hasDataDone`, `mapPool` over descriptors at
     `PROBE_CONCURRENCY`: flat -> `probeHasData`; fallback -> `inventoryCountries`
     non-empty. Fill `hasDataByOtu`. Set `hasDataDone = true`. `bump()`.
   - **presence batch**: for every `countryKey` in `effectiveKeys` not already a
     key of `probeCache` (or not covered for a fallback terminal), `mapPool` over
     `descriptor x newCountry` pairs: flat -> `probeOne`; fallback ->
     `inventoryCountries(otuId)` then membership test. After each country
     completes, update `territoriesByOtu`: for each terminal, the subset of
     `effectiveKeys` it is present in. `bump()` once at the end.
   - Guard every `await` with `if (myGen !== gen) return`.
   - `loading` true for the duration, false in a `finally`.

8. **`probeTaxa(taxa, effectiveKeys)`**: `const myGen = gen`. For each taxon
   compute `probeParams({ rank, name })`. `mapPool` (limit 8) over
   `taxon x countryKey(effectiveKeys)` using the SAME `probeOne` / `probeCache`
   (so a taxon that is also an in-key terminal is not re-fetched) and, once per
   taxon, `probeHasData` / fallback. Return
   `{ territoriesByTaxonId: Map<tnId, Set<countryKey∩present>>, hasDataByTaxonId: Set<tnId with any present> }`.
   Does not mutate `territoriesByOtu` / `hasDataByOtu` (those are terminal-scoped).

9. **`bump()`**: replace `territoriesByOtu.value` / `hasDataByOtu.value` with new
   `Map`s (Vue reactivity), same as the current code.

10. **`reset()`**: bump `gen`, clear `terminals`, `probeCache`, `hasDataBySig`,
    `inventoryCountryCache`, `territoriesByOtu`, `hasDataByOtu`, `hasDataDone = false`,
    `loading = false`, `loadedFor = null`.

11. **Delete** `fetchAllAD`, `adOtuId`, `resolveRootCandidates`,
    `findHomonymTnIds` usage for the removed pass (keep `findHomonymTnIds`? —
    NO: it guarded the bare-string family probe against same-rank homonyms.
    The lazy probe has the same exposure. **Keep `findHomonymTnIds`** and, in
    `ensureLoaded`, mark any terminal whose `{rank,name}` collides as
    `{ ...t, forceInventory: true }` so `probeParams` is bypassed to the
    `inventory` fallback for it. Port the function unchanged.),
    `territoriesByTn`, `allTerritories`'s `otuCount`, `otuToTnRef` (unless
    `probeTaxa` needs it — it gets tnId from KeyView, so drop it),
    `needsDescendantAd` / `needsSpecimenPass` imports.

- [ ] **Step 2: Type/lint sanity**

Run: `npm run build 2>&1 | tail -15`
Expected: no unresolved imports, no syntax errors. (Build does not exercise the
composable at runtime.)

- [ ] **Step 3: Full unit suite (unchanged libs still green)**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0` (this task adds no unit tests; it must not break existing ones).

- [ ] **Step 4: Restart dev server**

Run: `npm run dev` (kill any running instance first — `modules/` has no HMR).
Open `http://localhost:5173/#/key/3605` (a genus key, fast baseline).

- [ ] **Step 5: Manual verification — key 3605 (genus key)**

- Open the key. Network tab: **zero** `/dwc_occurrences`, `/asserted_distributions`,
  `/inventory/dwc.json` calls before touching the geography picker.
- Open the geography picker: the country list is the full static list, every
  country selectable, still no distribution calls.
- Select "Germany": a burst of `/dwc_occurrences?...&country=Germany&occurrenceStatus=present&per=1`
  calls (one per terminal + the has-data batch). Settles in ~1 to 2 s.
- Terminals recorded from Germany stay normal; terminals with data elsewhere but
  not Germany dim; terminals with no data anywhere are NOT dimmed.
- Add "France": only `country=France` calls fire (Germany not re-probed).
- Remove "France": no new calls; dimming recomputes from cache.

- [ ] **Step 6: Manual verification — key 5024 (families, the worst case)**

Open `http://localhost:5173/#/key/5024`.
- Key loads with no distribution calls.
- Select "Germany": settles in ~1 to 3 s (was 45 to 60 s). Higher-taxon
  terminals resolve; the "except Nanophyinae" compound terminal probes as plain
  `family=Brentidae` (slightly over-broad, expected).
- A subgenus or nameless terminal, if present, triggers exactly one
  `/otus/:id/inventory/dwc.json` for itself, not for a family.

- [ ] **Step 7: Commit**

```bash
git add modules/keys/composables/useKeyGeography.js
git commit -m "feat(keys): lazy per-country geography probing

useKeyGeography no longer sweeps every country on load. It resolves terminal
ranks only, exposes the static country list, and fetches presence
(/dwc_occurrences flat column + country + occurrenceStatus=present + per=1)
lazily per selected country at concurrency 8, plus a one-time no-country
has-data probe per terminal. probeTaxa serves the completeness pill the same
way for expected taxa. The AD descendant walk, the eager inventory pass, and
the root pre-filter are gone; inventory/dwc.json stays only as the subgenus /
nameless-terminal fallback. Homonym guard retained (forces the fallback).

One country selection: ~1 to 3 s, was 45 to 60 s on key 5024.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012Z8okD4WPviUoryHTuHjaa"
```

---

## Task 6: Wire `KeyView.vue` — new composable + per-country completeness pill

**Files:**
- Modify: `modules/keys/KeyView.vue`

**Interfaces:**
- Consumes: the Task 5 `useKeyGeography` return object; `buildCompletenessReport`
  with the Task 4 `geoScope.hasDataByTaxonId`.
- Produces: `provide('keyGeo', { ... hasDataByOtu, ... })` for Task 7 consumers.

- [ ] **Step 1: Swap the composable call and drop scope wiring**

- Line ~123: `const geo = useKeyGeography(terminalOtuList)` (remove the
  `geoScopeOtuId` argument).
- Delete `const geoScopeOtuId = computed(...)` (line ~122).
- Move `const resolvedScopeOtuId = ref(null)` back down next to `resolveScope()` /
  `scopeTaxonName` (line ~290) and delete the hoist comment at line ~90-98 and
  the "(resolvedScopeOtuId itself is declared up near `nodes`...)" comment.
  `meta`'s `otuId` and `loadScope` still read `resolvedScopeOtuId` — it just no
  longer needs to exist before `useKeyGeography`.
- `const geoTerritories = geo.allTerritories` stays. In the template / picker,
  `geoTerritories` is now `[{ key, label }]` (no `otuCount`).

- [ ] **Step 2: Add region presets to the picker list**

Where `geoTerritories` feeds `KeyHeader` / `GeographyPicker`, the picker already
takes `groupings` from `geoCategories` (now `GEOGRAPHY_PRESETS` via Task 1) and
`territories` from `geoTerritories`. No change needed beyond the `otuCount`
removal in Task 7. Confirm `geoTerritories.value` is the full static list.

- [ ] **Step 3: Replace the completeness-pill data assembly**

Delete: `territoriesByExpectedId` (ref), `geoTerrGen` (let), the
`assembleExpectedTerritories` function, the `fetchTaxonTerritories` function,
and the `import { normalizeShape }` usage there if now unused (keep
`territoryLabel` — still imported/used).

Replace the geo watch (currently lines ~200-218) with:

```js
// { tnId -> Set<countryKey> } and the has-data Set, for the geographic
// completeness pass. Rebuilt whenever the selection or the base report changes.
const geoExpected = ref({ territoriesByTaxonId: new Map(), hasDataByTaxonId: new Set() })
let geoExpectedGen = -1

watch(
  () => [geoEffective.value, targetTaxa.value, completenessLoading.value],
  async () => {
    const eff = geoEffective.value
    if (!eff.size || !targetTaxa.value.length) {
      geoCompletenessLoading.value = false
      geoExpected.value = { territoriesByTaxonId: new Map(), hasDataByTaxonId: new Set() }
      return
    }
    const myGen = ++geoExpectedGen
    geoCompletenessLoading.value = true
    // targetTaxa currently exposes { id, otuId }; extend it (Step 4) to carry
    // { id, otuId, rank, name }.
    const taxa = targetTaxa.value.map((t) => ({ tnId: t.id, rank: t.rank, name: t.name }))
    const res = await geo.probeTaxa(taxa, eff)
    if (myGen !== geoExpectedGen || myGen !== loadGen) return
    geoExpected.value = res
    geoCompletenessLoading.value = false
  },
  { immediate: true, deep: true }
)
```

`geoLoading` (line ~181) becomes:

```js
const geoLoading = computed(() => geo.loading.value || geoCompletenessLoading.value)
```

(unchanged text; `geo.loading` now covers the terminal probe batch).

- [ ] **Step 4: Give `targetTaxa` the rank + name the probe needs**

`baseReport`'s members carry `taxon: { id, otuId, name, authorYear }` but not
`rank`. Extend `taxRef` in `completeness.js` to include `rank: d.rank` (it is on
every `descendants` row already), and update `targetTaxa` in `KeyView.vue`:

```js
const targetTaxa = computed(() => {
  const r = baseReport.value
  if (!r) return []
  return [...r.groups.flatMap((g) => g.members), ...r.ungrouped]
    .map((m) => ({ id: m.taxon.id, otuId: m.taxon.otuId, rank: m.taxon.rank, name: m.taxon.name }))
})
```

Add a `completeness.test.js` assertion that `report.ungrouped[0].taxon.rank` is
populated. (Do this as part of this step, run `npm test`.)

- [ ] **Step 5: Feed `hasDataByTaxonId` into the report**

`completeness` computed (lines ~273-285):

```js
const completeness = computed(() => {
  const input = completenessInput.value
  if (!input) return null
  const eff = geoEffective.value
  const geoScope = eff.size
    ? {
        effectiveKeys: eff,
        territoriesByTaxonId: geoExpected.value.territoriesByTaxonId,
        hasDataByTaxonId: geoExpected.value.hasDataByTaxonId,
        label: geoSelectionLabel.value
      }
    : null
  return buildCompletenessReport({ ...input, geoScope })
})
```

- [ ] **Step 6: Update `provide('keyGeo', ...)` and `syncSelection` trigger**

```js
provide('keyGeo', {
  territoriesByOtu: geo.territoriesByOtu,
  hasDataByOtu: geo.hasDataByOtu,
  effective: geoEffective,
  selectionLabel: geoSelectionLabel,
  reachableTerminalsByNode
})

// Fire the terminal probe batch whenever the effective selection changes.
watch(geoEffective, (eff) => { if (eff.size) geo.syncSelection(eff) }, { deep: true })
```

Keep `@geo-open="geo.ensureLoaded()"` on the picker (now just resolves ranks).
`onMounted`: `if (geoEffective.value.size) { geo.ensureLoaded(); geo.syncSelection(geoEffective.value) }`.

- [ ] **Step 7: Update `load()` / `reset()` bookkeeping**

In `load()` remove `territoriesByExpectedId.value = new Map()` and
`geoTerrGen = -1`; add `geoExpected.value = { territoriesByTaxonId: new Map(), hasDataByTaxonId: new Set() }`
and `geoExpectedGen = -1`. `geo.reset()` stays.

- [ ] **Step 8: Build + full unit suite**

Run: `npm run build 2>&1 | tail -12 && npm test 2>&1 | tail -6`
Expected: build clean, `# fail 0`.

- [ ] **Step 9: Manual verification — the geographic completeness pill**

Restart `npm run dev`. On `#/key/5024`:
- Select "Germany". The geography completeness chip goes from "loading" to a
  count in ~1 to 3 s.
- Open the geographic completeness modal: `expectedCount` = German genera of the
  keyed families; `missing` lists German genera absent from the key;
  `unknownExpected` lists only taxa with NO distribution data anywhere (should be
  short, NOT hundreds of non-German genera);
  `outOfAreaTerminals` lists keyed terminals recorded elsewhere but not Germany.
- Compare the `missing` count against the pre-redesign value for the same key +
  country if you have it noted; a large discrepancy is a regression.
- On `#/key/3605` repeat: numbers should match the old behaviour closely (a
  genus key's targets are mostly in-key, so little changes).

- [ ] **Step 10: Commit**

```bash
git add modules/keys/KeyView.vue modules/keys/lib/completeness.js modules/keys/lib/completeness.test.js
git commit -m "feat(keys): per-country geographic completeness pill

KeyView drops assembleExpectedTerritories / fetchTaxonTerritories (the
per-gap-taxon AD descendant walk) for geo.probeTaxa: one flat per-country
probe per expected modal-rank taxon, sharing useKeyGeography's cache with the
terminal probes. hasDataByTaxonId feeds buildCompletenessReport so an expected
taxon absent from the selected area reads 'out' not 'unknown'. scopeOtuIdRef
wiring removed; taxRef now carries rank.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012Z8okD4WPviUoryHTuHjaa"
```

---

## Task 7: Update the dimming consumers and the picker row

**Files:**
- Modify: `modules/keys/components/TaxonLink.vue`
- Modify: `modules/keys/components/GuidedView.vue`
- Modify: `modules/keys/components/FullKeyView.vue`
- Modify: `modules/keys/components/GeographyPicker.vue`

**Interfaces:**
- Consumes: `keyGeo.hasDataByOtu` (added to the provide in Task 6);
  `leadGeoStatus(reachableOtuIds, territoriesByOtu, effectiveKeys, hasDataByOtu)` (Task 3).

- [ ] **Step 1: `TaxonLink.vue` — dim on has-data + not-in-area**

Replace the `outOfArea` computed (lines ~47-56):

```js
const outOfArea = computed(() => {
  if (props.suppressGeoDim || geoDimSuppressed?.value) return false
  const eff = geo?.effective?.value
  if (!eff || eff.size === 0) return false
  const id = Number(props.id)
  const hasData = geo.hasDataByOtu?.value?.get(id) ?? false
  if (!hasData) return false // unknown -> never dim
  const set = geo.territoriesByOtu.value.get(id)
  if (set && set.size) {
    for (const k of set) if (eff.has(k)) return false // present in a selected country
    return true
  }
  return true // has data somewhere, none of it in the selection
})
```

- [ ] **Step 2: `GuidedView.vue` — pass `hasDataByOtu` into `leadGeoStatus`**

Line ~85-89:

```js
function leadStatus(nodeId) {
  if (!geo) return 'in'
  return leadGeoStatus(
    geo.reachableTerminalsByNode.value.get(Number(nodeId)),
    geo.territoriesByOtu.value,
    geo.effective.value,
    geo.hasDataByOtu?.value ?? null
  )
}
```

- [ ] **Step 3: `FullKeyView.vue` — same fourth argument**

At the `leadGeoStatus(...)` call (around line 141), add
`geo.hasDataByOtu?.value ?? null` as the fourth argument. Confirm the file
injects `keyGeo` the same way `GuidedView.vue` does; if it reads `geo.territoriesByOtu.value`
it has the `geo` handle already.

- [ ] **Step 4: `GeographyPicker.vue` — drop the `otuCount` span**

Remove line ~71: `<span class="text-base-soft">{{ t.otuCount }}</span>` and any
now-empty wrapper / flex spacing left behind. Update the prop comment at line
~103 from `// [{ key, label, otuCount }]` to `// [{ key, label }]`. The
`territoryLabel` import and everything else stay.

- [ ] **Step 5: Build + unit suite**

Run: `npm run build 2>&1 | tail -12 && npm test 2>&1 | tail -6`
Expected: clean, `# fail 0`.

- [ ] **Step 6: Manual verification — dimming across all three views**

Restart `npm run dev`. On `#/key/5024` with "Germany" selected:
- **Guided view:** a couplet branch whose whole reachable subtree is recorded
  only outside Germany is dimmed; a branch with any German or any unknown
  terminal is not.
- **Full key view:** same dimming on the rendered leads.
- **Taxon links:** an individual terminal recorded elsewhere but not Germany is
  dimmed; one with no distribution data at all is plain (not dimmed); one in
  Germany is plain.
- Picker rows show `label` only, no trailing number, no layout gap.

- [ ] **Step 7: Commit**

```bash
git add modules/keys/components/TaxonLink.vue modules/keys/components/GuidedView.vue \
        modules/keys/components/FullKeyView.vue modules/keys/components/GeographyPicker.vue
git commit -m "feat(keys): dimming consumers use the has-data signal

TaxonLink dims a terminal only when it has a record somewhere but none in the
selected countries; leadGeoStatus takes hasDataByOtu so a branch is never
dimmed while a reachable terminal is merely unassessed. GeographyPicker rows
drop the per-country terminal count (no longer computed up front).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012Z8okD4WPviUoryHTuHjaa"
```

---

## Task 8: Docs and dead-code sweep

**Files:**
- Modify: `docs/feasibility_key_geography_filter.md` (append a pointer)
- Modify: `docs/superpowers/specs/2026-09-02-key-geography-filter-design.md` (append a superseded-by note)
- Modify: `modules/keys/lib/geoScope.js` (comment the now-unused exports) OR delete them
- Modify: `CLAUDE.md` if it documents the old flow (grep first)

- [ ] **Step 1: Feasibility doc pointer**

Append to `docs/feasibility_key_geography_filter.md`:

```markdown
## 2026-09-07: superseded by the lazy per-country redesign

The "replace the family/tribe pass with a per-country flat probe" recommendation
above was generalised: EVERY terminal rank now uses the per-country flat probe
(species via `genus` + `specificEpithet`), fired lazily only after the reader
selects a country. The eager all-country sweep, the `/asserted_distributions`
descendant walk and the eager `inventory/dwc.json` pass are gone.
See `docs/superpowers/specs/2026-09-07-key-geography-lazy-per-country-design.md`.
```

- [ ] **Step 2: Old spec superseded-by note**

At the top of `docs/superpowers/specs/2026-09-02-key-geography-filter-design.md`,
under the title:

```markdown
> **Loading strategy superseded 2026-09-07** by
> `2026-09-07-key-geography-lazy-per-country-design.md` (lazy per-country probe).
> The UI, selection model, presets and the two completeness measures below are
> still current.
```

- [ ] **Step 3: `geoScope.js` dead exports**

`needsDescendantAd` and `needsSpecimenPass` have no callers after Task 5
(`grep -rn "needsDescendantAd\|needsSpecimenPass" modules/ panels/ | grep -v test`).
Either delete them and their tests, or add a one-line comment
`// Unused since the 2026-09-07 lazy redesign; kept for reference.` Keep
`fieldForRank` and `RANK_TO_DWC_FIELD` (used by `geoProbe.js`). Decide based on
whether the tests still pass cleanly after deletion; default to deleting for DRY.

- [ ] **Step 4: `CLAUDE.md` check**

Run: `grep -n "useKeyGeography\|geography\|asserted_distributions.*descendants" CLAUDE.md`
If any line describes the eager/AD-walk flow, update it to one sentence pointing
at the new spec. If nothing matches, skip.

- [ ] **Step 5: Full suite + build**

Run: `npm test 2>&1 | tail -6 && npm run build 2>&1 | tail -8`
Expected: `# fail 0`, build clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(keys): point old geography docs at the lazy redesign; drop dead geoScope exports

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012Z8okD4WPviUoryHTuHjaa"
```

---

## Self-Review

**Spec coverage:**
- §3.1 lifecycle (no fetch on load / static picker / probe on selection / incremental) -> Task 5 Steps 1, 5, 6; Task 6 Step 6.
- §3.2 state (`probeCache`, `hasDataByOtu`) -> Task 5 Step 1.
- §3.3 backward-compatible `territoriesByOtu` provide -> Task 5 (return shape), Task 6 Step 6, Task 7.
- §4 unified probe (rank table, presence read, synonym redirect, homonym guard) -> Task 2 + Task 5 Step 1 item 11.
- §5 completeness pill (per-country, shared cache, deletions) -> Task 4 + Task 6 Steps 3 to 5.
- §6 edge cases: out-of-scope -> existing `outOfScopeTerminals`, untouched; root check dropped -> Task 6 Step 1; subgenus / nameless -> Task 2 fallback + Task 5 item 6; compound "except" -> Task 5 Step 6 (documented, not special-cased); occurrenceStatus -> Global Constraints + Task 5 Step 1 item 4; country spelling -> Task 5 Step 1 item 4 note (follow-up, not blocking); homonym guard -> Task 5 item 11; unknown vs out-of-area -> Task 3 + Task 6 + Task 7; key switch / restored selection -> Task 5 item 10 + Task 6 Steps 6, 7.
- §7 region-only conservative -> Global Constraints (no expansion); nothing reintroduces it.
- §7a one file for hard-coded sets -> Task 1.
- §9 testing -> Tasks 1 to 4 unit tests; Tasks 5 to 7 manual procedures.
- §10 decisions: has-data eager on first selection -> Task 5 Step 1 item 7; picker count dropped -> Task 7 Step 4.

**Placeholder scan:** Task 4 Step 1 leaves the two new test bodies to be filled
against the file's existing geoScope scaffold (the scaffold is not reproduced
here because it is long and already in the repo); every other code step has
literal content.

**Type consistency:** `probeParams` return (`{ params, sig } | { fallback: 'inventory' }`)
is consistent across Tasks 2, 5, 6. `territoryStatus(set, eff, hasDataAnywhere)`
and `leadGeoStatus(..., hasDataByOtu)` signatures match across Tasks 3, 6, 7.
`geoScope.hasDataByTaxonId: Set` consistent across Tasks 4 and 6. `geo.probeTaxa`
return (`{ territoriesByTaxonId: Map, hasDataByTaxonId: Set }`) matches between
Task 5 and Task 6 Step 3.

## Execution Handoff

See the closing prompt after this file is saved.
