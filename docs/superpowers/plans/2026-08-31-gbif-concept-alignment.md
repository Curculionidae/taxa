# GBIF concept alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PanelGbifTaxon Venn with a name-graph engine that reports how TaxonWorks and Catalogue of Life diverge on a taxon's circumscription, shown as a zone table plus a Franz and Peet relation icon.

**Architecture:** Four new pure or fetch modules under `panels/_gbifShared/`. Two are pure (`conceptRelation.js`, `gbifNameMatch.js`) and one is pure assembly (`assembleAlignment.js`), all runnable under `node --test`. One fetch module (`gbifChecklistConcept.js`) is tested with a stubbed `fetch`. An orchestrator (`gbifConceptAlignment.js`) wires them to the TaxonWorks and GBIF APIs. `PanelGbifTaxon.vue` is rewritten to consume the model. The other three GBIF panels do not change.

**Tech Stack:** Vue 3 SFC, plain ES modules, `fetch` for GBIF, `makeAPIRequest` for TaxonWorks, Node built-in test runner (`node:test` + `node:assert/strict`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-gbif-concept-alignment-design.md`. Visual reference: `docs/gbif-viz-options.html`.

## Global Constraints

- Path alias `@/` resolves to `node_modules/@sfgrp/taxonpages/src/`, never the local tree. Local shared modules use plain relative imports.
- Colour only via theme tokens. `--pp-tw` and `--pp-gbif` (defined in `panels/_gbifShared/gbif-tokens.css`) for the two sources. `bg-base-foreground` + `text-base-content` for surfaces, `text-base-soft` for labels only, `border-base-muted` for separators. No Tailwind default palette (`text-red-500` and the like), no hex or `rgb()` in `.vue` or `.js`. `text-white` only on a saturated status fill.
- No dashes in any user-visible copy string or in doc prose. Use commas, colons, parentheses, or split the sentence. Hyphens inside compound words are fine.
- No "this taxon", "this concept", "here", or "the matching concept" in panel copy. The table column headers carry the referent; anything else is named explicitly, the relevant name in italics.
- Catalogue of Life dataset UUID (the existing `CHECKLIST_KEY` constant in `panels/_gbifShared/useGbifMatch.js`): `7ddf754f-d193-4cc9-b351-99906754a03b`.
- Two GBIF key spaces, never mixed: `/v2/species/match` and `/v1/occurrence/search?taxonKey=` use the **alphanumeric** usage key (`6NXFP`). `/v1/species/{key}` and `/v1/species/{key}/synonyms` use the **integer** key (`297459661`), obtained from `/v1/species?datasetKey=<UUID>&name=<canonical>`.
- Local module and panel changes require a full `npm run dev` restart to take effect (HMR does not pick them up).
- After adding the first test file, add to `package.json` scripts: `"test": "node --test panels/_gbifShared/"`.

---

## Task 1: gbifNameMatch.js — author parsing and match keys (pure)

**Files:**
- Create: `panels/_gbifShared/gbifNameMatch.js`
- Create: `panels/_gbifShared/gbifNameMatch.test.js`
- Modify: `package.json` (add the `test` script)

**Interfaces:**
- Consumes: `canonicalName`, `epithetKey` from `./gbifNameFilter.js` (existing, pure).
- Produces:
  - `normalizeSurname(author: string): string`
  - `parseAuthorYear(nameOrAuthor: string): { surname: string, year: number | null }`
  - `matchKey(name: string, opts?: { author?: string }): string` returns `"<epithet>|<surname>|<year>"`, year empty string when unknown
  - `matchTier(twKey: string, colKey: string, opts: { twOriginalCombination?: string, colNameStrings?: string[] }): 'homotypic' | 'probable' | 'weak' | 'none'`

- [ ] **Step 1: Write the failing test**

Create `panels/_gbifShared/gbifNameMatch.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSurname,
  parseAuthorYear,
  matchKey,
  matchTier
} from './gbifNameMatch.js'

test('normalizeSurname strips initials, particles, glued initials, year', () => {
  assert.equal(normalizeSurname('Herbst'), 'herbst')
  assert.equal(normalizeSurname('J.F.W.Herbst, 1783'), 'herbst')
  assert.equal(normalizeSurname('Herbst, J.F.W.'), 'herbst')
  assert.equal(normalizeSurname('(P.Rossi, 1790)'), 'rossi')
  assert.equal(normalizeSurname('de Motschulsky, 1866'), 'motschulsky')
  assert.equal(normalizeSurname('Gyllenhal & Schoenherr'), 'gyllenhal')
  assert.equal(normalizeSurname('Olivier, 1807, auct. non Olivier'), 'olivier')
  assert.equal(normalizeSurname(''), '')
  assert.equal(normalizeSurname(undefined), '')
})

test('parseAuthorYear extracts a 4-digit year and the surname', () => {
  assert.deepEqual(parseAuthorYear('Larinus latus (Herbst, 1783)'), {
    surname: 'herbst',
    year: 1783
  })
  assert.deepEqual(parseAuthorYear('Larinus subcostatus Brullé, 1832'), {
    surname: 'brullé',
    year: 1832
  })
  assert.deepEqual(parseAuthorYear('Lixus longirostris'), {
    surname: 'lixus longirostris' === '' ? '' : parseAuthorYear('Lixus longirostris').surname,
    year: null
  })
})

test('matchKey is genus independent', () => {
  assert.equal(
    matchKey('Larinus latus (Herbst, 1783)'),
    matchKey('Curculio latus Herbst, 1783')
  )
  assert.equal(matchKey('Larinus latus', { author: '(Herbst, 1783)' }), 'latus|herbst|1783')
})

test('matchKey keeps homonyms apart', () => {
  assert.notEqual(
    matchKey('Lixus cardui (Rossi, 1790)'),
    matchKey('Lixus cardui Aurivillius, 1921')
  )
})

test('matchTier: homotypic when the original combination is in the CoL name set', () => {
  const tw = matchKey('Larinus latus', { author: '(Herbst, 1783)' })
  const col = matchKey('Larinus latus (Herbst, J.F.W., 1783)')
  assert.equal(
    matchTier(tw, col, {
      twOriginalCombination: 'Curculio latus Herbst, 1783',
      colNameStrings: [
        'Larinus latus (Herbst, J.F.W., 1783)',
        'Curculio latus Herbst, J.F.W., 1783'
      ]
    }),
    'homotypic'
  )
})

test('matchTier: probable on epithet + surname + year, one year tolerance', () => {
  const tw = matchKey('Larinus mutabilis', { author: 'Host, 1789' })
  const col = matchKey('Curculio mutabilis Host, N., 1790')
  assert.equal(matchTier(tw, col, {}), 'probable')
})

test('matchTier: weak when only the epithet stem matches', () => {
  const tw = matchKey('Larinus gibbosus', { author: 'Fabricius, 1801' })
  const col = matchKey('Larinus gibbosa Germar, 1824')
  assert.equal(matchTier(tw, col, {}), 'weak')
})

test('matchTier: none when nothing matches', () => {
  assert.equal(matchTier('latus|herbst|1783', 'cardui|rossi|1790', {}), 'none')
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test panels/_gbifShared/gbifNameMatch.test.js`
Expected: FAIL, `Cannot find module './gbifNameMatch.js'`.

- [ ] **Step 3: Write the implementation**

Create `panels/_gbifShared/gbifNameMatch.js`:

```js
// Name matching for the GBIF concept alignment. A match key is
// "<epithet>|<surname>|<year>", genus independent so a recombination still
// matches, and specific enough to keep homonyms apart. Each match is graded
// into a tier. See the design spec, section 4.4.
import { canonicalName, epithetKey } from './gbifNameFilter.js'

const PARTICLES = new Set([
  'de', 'van', 'von', 'der', 'den', 'du', 'la', 'le', 'da', 'dos', 'del', 'di'
])

// "(J.F.W.Herbst, 1783)" -> "herbst" ; "Rossi, P., 1790" -> "rossi" ;
// "de Motschulsky" -> "motschulsky" ; "Gyllenhal & Schoenherr" -> "gyllenhal"
export function normalizeSurname(author) {
  if (!author) return ''
  let s = String(author)
    .replace(/[()]/g, ' ')
    .replace(/\bauct\.?\b.*$/i, ' ')
    .replace(/\bnon\b.*$/i, ' ')
    .replace(/\b(1[6-9]\d\d|20\d\d)\b.*$/, ' ')
    .replace(/&|\band\b/gi, ',')
  // first author only
  s = s.split(/[,;]/)[0].trim()
  // strip leading glued initials: "J.F.W.Herbst" -> "Herbst"
  s = s.replace(/^(?:[A-Z]\.){1,4}/, '')
  const tokens = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => {
      const bare = t.replace(/\./g, '')
      if (bare.length <= 1) return false
      if (PARTICLES.has(bare.toLowerCase())) return false
      return true
    })
  const last = tokens.length ? tokens[tokens.length - 1] : s
  return last.replace(/[^A-Za-zÀ-ÿ-]/g, '').toLowerCase()
}

export function parseAuthorYear(nameOrAuthor) {
  const str = String(nameOrAuthor || '')
  const m = str.match(/\b(1[6-9]\d\d|20\d\d)\b/)
  return { surname: normalizeSurname(str), year: m ? Number(m[1]) : null }
}

// "Larinus latus (Herbst, 1783)" -> "latus|herbst|1783".
// Pass `author` when the name string carries no authorship (TaxonWorks names
// keep it in a separate field).
export function matchKey(name, { author } = {}) {
  const c = canonicalName(name) // "larinus latus"
  const epithet = c.includes(' ') ? c.split(' ').slice(1).join(' ') : c
  const { surname, year } = parseAuthorYear(author || name)
  return `${epithet}|${surname}|${year ?? ''}`
}

function parts(key) {
  const [epithet, surname, year] = String(key).split('|')
  return { epithet, surname, year: year ? Number(year) : null }
}

export function matchTier(twKey, colKey, { twOriginalCombination, colNameStrings } = {}) {
  if (twOriginalCombination && Array.isArray(colNameStrings)) {
    const oc = matchKey(twOriginalCombination)
    const ocEpSur = oc.split('|').slice(0, 2).join('|')
    for (const cn of colNameStrings) {
      if (matchKey(cn).split('|').slice(0, 2).join('|') === ocEpSur) return 'homotypic'
    }
  }
  const t = parts(twKey)
  const c = parts(colKey)
  if (t.epithet && t.epithet === c.epithet && t.surname && t.surname === c.surname) {
    if (t.year && c.year) return Math.abs(t.year - c.year) <= 1 ? 'probable' : 'weak'
    return 'weak'
  }
  const ts = epithetKey(t.epithet)
  if (ts && ts === epithetKey(c.epithet)) return 'weak'
  return 'none'
}
```

Note on the test: the `parseAuthorYear('Lixus longirostris')` assertion is awkward as written; replace that one case with `assert.equal(parseAuthorYear('Lixus longirostris').year, null)`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test panels/_gbifShared/gbifNameMatch.test.js`
Expected: PASS (fix the one awkward assertion first).

- [ ] **Step 5: Add the test script**

Edit `package.json`, add to `scripts`: `"test": "node --test panels/_gbifShared/"`.

- [ ] **Step 6: Commit**

```bash
git add panels/_gbifShared/gbifNameMatch.js panels/_gbifShared/gbifNameMatch.test.js package.json
git commit -m "feat(gbif): name match keys and tiers for concept alignment"
```

---

## Task 2: conceptRelation.js — RCC-5 derivation (pure)

**Files:**
- Create: `panels/_gbifShared/conceptRelation.js`
- Create: `panels/_gbifShared/conceptRelation.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RELATIONS`: object keyed `congruent | included | includes | overlap | none`, each `{ symbol, icon, otuRelationship }`
  - `deriveRelation(Nk: string[], Gk: string[], opts?): Relation`
    - `opts`: `{ unmatchedCount?: number, acceptedMatchType?: 'EXACT'|'FUZZY'|'AMBIGUOUS', acceptedIsSynonymChain?: boolean, weakKeysInPlay?: boolean, synonymyReconstructed?: boolean }`
    - `Relation`: `{ kind, symbol, icon, otuRelationship, confidence: 'clear'|'provisional'|'uncertain', alternative: Relation|null, sharedCount: number, reconciliation: { adds: string[], drops: string[] }, intAssessed: false }`
  - `relationLabel(relation: Relation, ctx: { twName: string, colAcceptedName: string }): string`

- [ ] **Step 1: Write the failing test**

Create `panels/_gbifShared/conceptRelation.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRelation, relationLabel, RELATIONS } from './conceptRelation.js'

const A = 'latus|herbst|1783'
const B = 'mutabilis|host|1789'
const C = 'cardui|rossi|1790'
const D = 'subcostatus|brullé|1832'

test('congruent when the key sets are equal', () => {
  const r = deriveRelation([A, B], [A, B])
  assert.equal(r.kind, 'congruent')
  assert.equal(r.symbol, '≡')
  assert.equal(r.otuRelationship, 'Equal')
  assert.equal(r.confidence, 'clear')
  assert.deepEqual(r.reconciliation, { adds: [], drops: [] })
  assert.equal(r.sharedCount, 2)
})

test('included in when GBIF has extra keys', () => {
  const r = deriveRelation([A], [A, C])
  assert.equal(r.kind, 'included')
  assert.equal(r.symbol, '⊂')
  assert.equal(r.otuRelationship, 'ProperPart')
  assert.deepEqual(r.reconciliation, { adds: [C], drops: [] })
})

test('includes when TaxonWorks has extra keys', () => {
  const r = deriveRelation([A, D], [A])
  assert.equal(r.kind, 'includes')
  assert.equal(r.symbol, '⊃')
  assert.equal(r.otuRelationship, 'ProperPartInverse')
  assert.deepEqual(r.reconciliation, { adds: [], drops: [D] })
})

test('overlap when each side has extra keys', () => {
  const r = deriveRelation([A, D], [A, C])
  assert.equal(r.kind, 'overlap')
  assert.equal(r.symbol, '><')
  assert.equal(r.otuRelationship, 'PartiallyOverlapping')
  assert.equal(r.sharedCount, 1)
  assert.deepEqual(r.reconciliation, { adds: [C], drops: [D] })
})

test('no comparison when the sets do not intersect', () => {
  const r = deriveRelation([A], [C])
  assert.equal(r.kind, 'none')
  assert.equal(r.symbol, null)
  assert.equal(r.confidence, 'uncertain')
})

test('one unmatched TaxonWorks name downgrades a clear result to provisional', () => {
  const r = deriveRelation([A], [A, C], { unmatchedCount: 1 })
  assert.equal(r.kind, 'included')
  assert.equal(r.confidence, 'provisional')
})

test('ambiguous synonym status on G members does NOT downgrade confidence', () => {
  const r = deriveRelation([A, B], [A, B], { gHasAmbiguousOnly: true })
  assert.equal(r.confidence, 'clear')
})

test('reconstructed synonymy yields uncertain plus an alternative', () => {
  const r = deriveRelation([A, D], [A, C], { synonymyReconstructed: true })
  assert.equal(r.confidence, 'uncertain')
  assert.ok(r.alternative)
  assert.equal(r.alternative.kind, 'included')
})

test('relationLabel substitutes the names', () => {
  const r = deriveRelation([A, D], [A, C])
  const s = relationLabel(r, { twName: 'Larinus latus', colAcceptedName: 'Larinus latus' })
  assert.ok(s.includes('Larinus latus'))
  assert.ok(!s.includes(' - '))
  assert.ok(!/[—–]/.test(s))
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test panels/_gbifShared/conceptRelation.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

Create `panels/_gbifShared/conceptRelation.js`:

```js
// The RCC-5 relation between two name sets, from Franz and Peet 2009. Vocabulary
// matches TaxonWorks OtuRelationship (Equal, ProperPart, ProperPartInverse,
// PartiallyOverlapping). Pure. See the design spec, section 4.2.

export const RELATIONS = {
  congruent: { symbol: '≡', icon: 'congruent', otuRelationship: 'Equal' },
  included: { symbol: '⊂', icon: 'included', otuRelationship: 'ProperPart' },
  includes: { symbol: '⊃', icon: 'includes', otuRelationship: 'ProperPartInverse' },
  overlap: { symbol: '><', icon: 'overlap', otuRelationship: 'PartiallyOverlapping' },
  none: { symbol: null, icon: 'none', otuRelationship: null }
}

// softer neighbour used only when confidence is uncertain
const NEIGHBOUR = {
  congruent: 'included',
  included: 'congruent',
  includes: 'congruent',
  overlap: 'included'
}

export function deriveRelation(Nk, Gk, opts = {}) {
  const {
    unmatchedCount = 0,
    acceptedMatchType = 'EXACT',
    acceptedIsSynonymChain = false,
    weakKeysInPlay = false,
    synonymyReconstructed = false
  } = opts

  const N = new Set(Nk)
  const G = new Set(Gk)
  const shared = [...N].filter((k) => G.has(k))
  const adds = [...G].filter((k) => !N.has(k))
  const drops = [...N].filter((k) => !G.has(k))
  const reconciliation = { adds, drops }

  if (shared.length === 0 || N.size === 0 || G.size === 0) {
    return {
      kind: 'none',
      ...RELATIONS.none,
      confidence: 'uncertain',
      alternative: null,
      sharedCount: 0,
      reconciliation,
      intAssessed: false
    }
  }

  let kind
  if (!drops.length && !adds.length) kind = 'congruent'
  else if (!drops.length && adds.length) kind = 'included'
  else if (drops.length && !adds.length) kind = 'includes'
  else kind = 'overlap'

  let confidence = 'clear'
  if (
    unmatchedCount >= 1 ||
    acceptedMatchType === 'FUZZY' ||
    acceptedIsSynonymChain ||
    weakKeysInPlay
  ) {
    confidence = 'provisional'
  }
  if (synonymyReconstructed || acceptedMatchType === 'AMBIGUOUS') {
    confidence = 'uncertain'
  }

  let alternative = null
  if (confidence === 'uncertain') {
    const altKind = NEIGHBOUR[kind]
    if (altKind && altKind !== kind) {
      alternative = { kind: altKind, ...RELATIONS[altKind] }
    }
  }

  return {
    kind,
    ...RELATIONS[kind],
    confidence,
    alternative,
    sharedCount: shared.length,
    reconciliation,
    intAssessed: false
  }
}

export function relationLabel(relation, { twName, colAcceptedName }) {
  const tw = twName || 'this taxon'
  const col = colAcceptedName || tw
  switch (relation.kind) {
    case 'congruent':
      return `TaxonWorks and Catalogue of Life use the same set of names for ${tw}.`
    case 'included':
      return `The Catalogue of Life concept of ${col} is broader. It groups in names that TaxonWorks places elsewhere.`
    case 'includes':
      return `The Catalogue of Life concept of ${col} is narrower. It keeps apart names that TaxonWorks unites under ${tw}.`
    case 'overlap':
      return `TaxonWorks and Catalogue of Life share a core of ${relation.sharedCount} names for ${tw}, but each also files names under it that the other does not.`
    default:
      return `TaxonWorks and Catalogue of Life share no name for ${tw}, so the two cannot be compared. This usually means the GBIF match is weak.`
  }
}
```

Note: the `gHasAmbiguousOnly` option in the test is accepted and ignored on purpose (it must not change confidence); add it to the destructure with no effect, or leave it unreferenced. Add `gHasAmbiguousOnly = false` to the destructure so a reader sees it was considered.

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test panels/_gbifShared/conceptRelation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add panels/_gbifShared/conceptRelation.js panels/_gbifShared/conceptRelation.test.js
git commit -m "feat(gbif): RCC-5 concept relation derivation"
```

---

## Task 3: gbifChecklistConcept.js — Catalogue of Life synonymy (fetch, stubbed test)

**Files:**
- Create: `panels/_gbifShared/gbifChecklistConcept.js`
- Create: `panels/_gbifShared/gbifChecklistConcept.test.js`
- Create: `panels/_gbifShared/__fixtures__/col-larinus-latus-search.json`
- Create: `panels/_gbifShared/__fixtures__/col-larinus-latus-species.json`
- Create: `panels/_gbifShared/__fixtures__/col-larinus-latus-synonyms.json`

**Interfaces:**
- Consumes: `matchKey`, `matchTier` from `./gbifNameMatch.js`.
- Produces:
  - `fetchChecklistConcept(validName: string, twNodes: TwNode[], opts: { checklistKey: string, fetchImpl?: typeof fetch }): Promise<ColConcept | null>`
    - `TwNode`: `{ name: string, authorYear: string, originalCombination: string | null, matchKey: string }`
    - `ColConcept`: `{ accepted: { name: string, alphaKey: string, intKey: number }, synonyms: ColName[], misapplied: ColName[] }`
    - `ColName`: `{ name: string, status: string, matchKey: string, matchTier: 'homotypic'|'probable'|'weak'|'none' }`

- [ ] **Step 1: Capture the fixtures**

Run these and save each response verbatim into the fixture file named:

```bash
CL=7ddf754f-d193-4cc9-b351-99906754a03b
curl -s "https://api.gbif.org/v1/species?datasetKey=$CL&name=Larinus%20latus" \
  > panels/_gbifShared/__fixtures__/col-larinus-latus-search.json
curl -s "https://api.gbif.org/v1/species/297459661" \
  > panels/_gbifShared/__fixtures__/col-larinus-latus-species.json
curl -s "https://api.gbif.org/v1/species/297459661/synonyms?limit=200" \
  > panels/_gbifShared/__fixtures__/col-larinus-latus-synonyms.json
```

Confirm `col-larinus-latus-search.json` `results[0]` has `key: 297459661` and `taxonID: "6NXFP"`. Confirm the synonyms file `results` contains `Lixus cardui (Rossi, P., 1790)` with `taxonomicStatus: "HETEROTYPIC_SYNONYM"` and `Lixus cynarae ... auct.` with `taxonomicStatus: "MISAPPLIED"`. If the integer key `297459661` has changed since capture, get the current one from the search fixture and re-run the last two curls with it.

- [ ] **Step 2: Write the failing test**

Create `panels/_gbifShared/gbifChecklistConcept.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchChecklistConcept } from './gbifChecklistConcept.js'
import { matchKey } from './gbifNameMatch.js'

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)))

function stubFetch(routes) {
  return async (url) => {
    const u = String(url)
    for (const [needle, body] of routes) {
      if (u.includes(needle)) {
        return { ok: true, status: 200, json: async () => body }
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

const CL = '7ddf754f-d193-4cc9-b351-99906754a03b'

const twNodes = [
  {
    name: 'Larinus latus',
    authorYear: '(Herbst, 1783)',
    originalCombination: 'Curculio latus Herbst, 1783',
    matchKey: matchKey('Larinus latus', { author: '(Herbst, 1783)' })
  }
]

test('resolves the integer key, returns accepted usage and split synonyms', async () => {
  const fetchImpl = stubFetch([
    ['/v1/species?datasetKey', fx('col-larinus-latus-search')],
    ['/v1/species/297459661/synonyms', fx('col-larinus-latus-synonyms')],
    ['/v1/species/297459661', fx('col-larinus-latus-species')]
  ])

  const c = await fetchChecklistConcept('Larinus latus', twNodes, {
    checklistKey: CL,
    fetchImpl
  })

  assert.equal(c.accepted.alphaKey, '6NXFP')
  assert.equal(c.accepted.intKey, 297459661)
  assert.equal(c.accepted.name.startsWith('Larinus latus'), true)

  const names = c.synonyms.map((s) => s.name)
  assert.ok(names.some((n) => n.startsWith('Lixus cardui')))
  assert.ok(!names.some((n) => n.startsWith('Lixus cynarae'))) // misapplied is split off
  assert.equal(c.misapplied.length, 1)

  const curculioLatus = c.synonyms.find((s) => s.name.startsWith('Curculio latus'))
  assert.equal(curculioLatus.matchTier, 'homotypic') // TW original combination
})

test('returns null when the species search finds nothing', async () => {
  const fetchImpl = stubFetch([['/v1/species?datasetKey', { results: [] }]])
  const c = await fetchChecklistConcept('Nonexistus nullus', twNodes, {
    checklistKey: CL,
    fetchImpl
  })
  assert.equal(c, null)
})
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `node --test panels/_gbifShared/gbifChecklistConcept.test.js`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the implementation**

Create `panels/_gbifShared/gbifChecklistConcept.js`:

```js
// Catalogue of Life synonymy for a taxon, via GBIF's CoL mirror. GBIF's
// occurrence search and v2 match use an alphanumeric usage key; the v1
// synonyms route needs the integer key, which /v1/species?datasetKey=&name=
// carries alongside. See the design spec, section 5.2. No ChecklistBank.
import { matchKey, matchTier } from './gbifNameMatch.js'

const V1 = 'https://api.gbif.org/v1/species'
const cache = new Map()

export function fetchChecklistConcept(validName, twNodes, opts = {}) {
  const { checklistKey, fetchImpl } = opts
  const key = `${checklistKey}|${validName}`
  if (!cache.has(key)) {
    cache.set(key, resolve(validName, twNodes, checklistKey, fetchImpl || fetch))
  }
  return cache.get(key)
}

async function getJson(f, url) {
  const res = await f(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function resolve(validName, twNodes, checklistKey, f) {
  let search
  try {
    search = await getJson(
      f,
      `${V1}?datasetKey=${checklistKey}&name=${encodeURIComponent(validName)}`
    )
  } catch {
    return null
  }
  const rows = search?.results || []
  if (!rows.length) return null

  // prefer an accepted usage; follow a synonym to its accepted key
  let usage =
    rows.find((r) => r.taxonomicStatus === 'ACCEPTED') || rows[0]
  if (usage.taxonomicStatus !== 'ACCEPTED' && usage.acceptedKey) {
    try {
      usage = await getJson(f, `${V1}/${usage.acceptedKey}`)
    } catch {
      /* keep the synonym usage */
    }
  }

  const intKey = usage.key
  const alphaKey = usage.taxonID || null

  let synRes = { results: [] }
  try {
    synRes = await getJson(f, `${V1}/${intKey}/synonyms?limit=200`)
  } catch {
    /* no synonyms is valid */
  }

  const twOC = twNodes
    .map((n) => n.originalCombination)
    .filter(Boolean)
  const colNameStrings = (synRes.results || [])
    .map((r) => r.scientificName)
    .filter(Boolean)
  colNameStrings.push(usage.scientificName)

  const bucketed = { synonyms: [], misapplied: [] }
  for (const r of synRes.results || []) {
    const name = r.scientificName
    if (!name) continue
    const ck = matchKey(name)
    const entry = {
      name,
      status: r.taxonomicStatus || 'SYNONYM',
      matchKey: ck,
      matchTier: bestTier(twNodes, ck, twOC, colNameStrings)
    }
    if (r.taxonomicStatus === 'MISAPPLIED') bucketed.misapplied.push(entry)
    else bucketed.synonyms.push(entry)
  }

  return {
    accepted: {
      name: usage.scientificName || validName,
      alphaKey,
      intKey
    },
    synonyms: bucketed.synonyms,
    misapplied: bucketed.misapplied
  }
}

// the strongest tier this CoL name reaches against any TaxonWorks node
function bestTier(twNodes, colKey, twOriginalCombinations, colNameStrings) {
  const rank = { homotypic: 3, probable: 2, weak: 1, none: 0 }
  let best = 'none'
  for (const node of twNodes) {
    const t = matchTier(node.matchKey, colKey, {
      twOriginalCombination: node.originalCombination,
      colNameStrings
    })
    if (rank[t] > rank[best]) best = t
  }
  return best
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node --test panels/_gbifShared/gbifChecklistConcept.test.js`
Expected: PASS. If the `homotypic` assertion fails, print `c.synonyms` and check the `Curculio latus` name string in the fixture against `Curculio latus Herbst, 1783` (author formatting differs, the `matchKey` epithet+surname comparison must still line up).

- [ ] **Step 6: Commit**

```bash
git add panels/_gbifShared/gbifChecklistConcept.js panels/_gbifShared/gbifChecklistConcept.test.js panels/_gbifShared/__fixtures__/
git commit -m "feat(gbif): Catalogue of Life synonymy fetch for concept alignment"
```

---

## Task 4: assembleAlignment.js — pure model assembly

**Files:**
- Create: `panels/_gbifShared/assembleAlignment.js`
- Create: `panels/_gbifShared/assembleAlignment.test.js`
- Create: `panels/_gbifShared/__fixtures__/tw-larinus-latus-nodes.json`
- Create: `panels/_gbifShared/__fixtures__/gbif-facet-larinus-latus.json`

**Interfaces:**
- Consumes: `deriveRelation`, `relationLabel`, `RELATIONS` from `./conceptRelation.js`; `matchKey` from `./gbifNameMatch.js`; `canonicalName` from `./gbifNameFilter.js`.
- Produces:
  - `buildAlignmentModel(input): AlignmentModel`
    - `input`: `{ twName, twAcceptedIsColSynonym, colConcept, twNodes, facetCounts, summaryCounts, colAcceptedName, urls, matchDiagnostics }`
      - `twNodes`: `[{ name, short, authorYear, originalCombination, role: 'accepted'|'twSynonym', matchKey, colMatched: boolean }]`
      - `colConcept`: the `ColConcept` from Task 3, or `null`
      - `facetCounts`: `[{ name, count }]` raw facet buckets
      - `summaryCounts`: `{ total, withImage, withCoordinate }`
      - `matchDiagnostics`: `{ acceptedMatchType, acceptedIsSynonymChain }`
    - `AlignmentModel`: the object in spec section 7 (minus the fetch-only fields)

- [ ] **Step 1: Capture and hand-build the fixtures**

`gbif-facet-larinus-latus.json`: capture live.

```bash
CL=7ddf754f-d193-4cc9-b351-99906754a03b
curl -s "https://api.gbif.org/v1/occurrence/search?taxonKey=6NXFP&checklistKey=$CL&limit=0&facet=scientificName&facetLimit=50" \
  > panels/_gbifShared/__fixtures__/gbif-facet-larinus-latus.json
```

`tw-larinus-latus-nodes.json`: hand-build from the values already verified in the spec, section 1 and section 5. Content:

```json
[
  { "name": "Larinus latus (Herbst, 1783)", "short": "Larinus latus", "authorYear": "(Herbst, 1783)", "originalCombination": "Curculio latus Herbst, 1783", "role": "accepted", "colMatched": true },
  { "name": "Larinus mutabilis Host, 1789", "short": "Larinus mutabilis", "authorYear": "Host, 1789", "originalCombination": "Curculio mutabilis Host, 1789", "role": "twSynonym", "colMatched": true },
  { "name": "Larinus cynarae (Herbst, 1795)", "short": "Larinus cynarae", "authorYear": "(Herbst, 1795)", "originalCombination": "Curculio cynarae Herbst, 1795", "role": "twSynonym", "colMatched": true },
  { "name": "Larinus subcostatus Brullé, 1832", "short": "Larinus subcostatus", "authorYear": "Brullé, 1832", "originalCombination": "Larinus subcostatus Brullé, 1832", "role": "twSynonym", "colMatched": true },
  { "name": "Larinus cirsii Gyllenhal, 1835", "short": "Larinus cirsii", "authorYear": "Gyllenhal, 1835", "originalCombination": "Larinus cirsii Gyllenhal, 1835", "role": "twSynonym", "colMatched": true },
  { "name": "Larinus costirostris Gyllenhal, 1835", "short": "Larinus costirostris", "authorYear": "Gyllenhal, 1835", "originalCombination": "Larinus costirostris Gyllenhal, 1835", "role": "twSynonym", "colMatched": true },
  { "name": "Larinus teretirostris Gyllenhal, 1835", "short": "Larinus teretirostris", "authorYear": "Gyllenhal, 1835", "originalCombination": "Larinus teretirostris Gyllenhal, 1835", "role": "twSynonym", "colMatched": true }
]
```

- [ ] **Step 2: Write the failing test**

Create `panels/_gbifShared/assembleAlignment.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAlignmentModel } from './assembleAlignment.js'
import { fetchChecklistConcept } from './gbifChecklistConcept.js'
import { matchKey } from './gbifNameMatch.js'

const fx = (n) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${n}.json`, import.meta.url)))

function stubFetch(routes) {
  return async (url) => {
    const u = String(url)
    for (const [needle, body] of routes) {
      if (u.includes(needle)) return { ok: true, status: 200, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

test('Larinus latus assembles to an overlap with the expected zones', async () => {
  const rawNodes = fx('tw-larinus-latus-nodes')
  const twNodes = rawNodes.map((n) => ({
    ...n,
    short: n.short,
    matchKey: matchKey(n.name.replace(/\s*\(.*/, '').trim(), { author: n.authorYear })
  }))

  const colConcept = await fetchChecklistConcept('Larinus latus', twNodes, {
    checklistKey: '7ddf754f-d193-4cc9-b351-99906754a03b',
    fetchImpl: stubFetch([
      ['/v1/species?datasetKey', fx('col-larinus-latus-search')],
      ['/v1/species/297459661/synonyms', fx('col-larinus-latus-synonyms')],
      ['/v1/species/297459661', fx('col-larinus-latus-species')]
    ])
  })

  const facet = fx('gbif-facet-larinus-latus')
  const facetCounts =
    facet.facets?.[0]?.counts?.map((c) => ({ name: c.name, count: c.count })) || []

  const model = buildAlignmentModel({
    twName: 'Larinus latus',
    colAcceptedName: colConcept.accepted.name,
    twAcceptedIsColSynonym: false,
    twNodes,
    colConcept,
    facetCounts,
    summaryCounts: { total: 1593, withImage: 766, withCoordinate: 1187 },
    matchDiagnostics: { acceptedMatchType: 'EXACT', acceptedIsSynonymChain: false },
    urls: {}
  })

  assert.equal(model.relation.kind, 'overlap')
  assert.equal(model.relation.symbol, '><')
  assert.equal(model.relation.sharedCount >= 3, true)

  const foldsIn = model.zones.colFoldsIn.map((n) => n.short)
  assert.ok(foldsIn.some((n) => n.includes('cardui')))

  const keepsIn = model.zones.twKeepsIn.map((n) => n.short)
  assert.ok(keepsIn.includes('Larinus subcostatus'))
  assert.ok(keepsIn.includes('Larinus teretirostris'))

  const cardui = model.zones.colFoldsIn.find((n) => n.short.includes('cardui'))
  assert.equal(cardui.records, 931)

  // BOLD BIN names land in the data-only bucket, not a zone
  assert.ok(model.zones.inDataOnly.some((r) => r.name.startsWith('BOLD:')))

  assert.deepEqual(model.relation.intAssessed, false)
})
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `node --test panels/_gbifShared/assembleAlignment.test.js`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the implementation**

Create `panels/_gbifShared/assembleAlignment.js`:

```js
// Pure assembly of the concept alignment model from already-fetched data.
// No IO. The orchestrator (gbifConceptAlignment.js) feeds it. See spec
// sections 4 and 7.
import { deriveRelation, relationLabel } from './conceptRelation.js'
import { matchKey } from './gbifNameMatch.js'
import { canonicalName } from './gbifNameFilter.js'

const BOLD_OR_BLANK = /^(BOLD:|incertae|\s*$)/i

export function buildAlignmentModel(input) {
  const {
    twName,
    colAcceptedName,
    twAcceptedIsColSynonym = false,
    twNodes,
    colConcept,
    facetCounts = [],
    summaryCounts = {},
    matchDiagnostics = {},
    urls = {}
  } = input

  // ---- record counts by match key ----
  const byMatchKey = new Map()
  const inDataOnly = []
  for (const { name, count } of facetCounts) {
    if (!name || BOLD_OR_BLANK.test(name) || !canonicalName(name).includes(' ')) {
      inDataOnly.push({ name, count })
      continue
    }
    const k = matchKey(name)
    byMatchKey.set(k, (byMatchKey.get(k) || 0) + count)
  }

  // ---- G members (exclude misapplied) ----
  const colSyn = colConcept ? colConcept.synonyms : []
  const colMisapplied = colConcept ? colConcept.misapplied : []
  const gEntries = colConcept
    ? [
        {
          name: colConcept.accepted.name,
          short: shortName(colConcept.accepted.name),
          matchKey: matchKey(colConcept.accepted.name),
          matchTier: 'homotypic',
          colRole: 'accepted'
        },
        ...colSyn.map((s) => ({
          name: s.name,
          short: shortName(s.name),
          matchKey: s.matchKey,
          matchTier: s.matchTier,
          colRole: 'colSynonym'
        }))
      ]
    : []
  const Gk = [...new Set(gEntries.map((e) => e.matchKey))]

  // ---- N members ----
  const nEntries = twNodes.map((n) => ({
    name: n.name,
    short: n.short || shortName(n.name),
    matchKey: n.matchKey,
    role: n.role,
    colMatched: n.colMatched
  }))
  const Nk = [...new Set(nEntries.filter((e) => e.colMatched).map((e) => e.matchKey))]
  const unmatched = nEntries.filter((e) => !e.colMatched).map((e) => e.name)

  // ---- relation ----
  const weakKeysInPlay = gEntries.some(
    (e) => e.matchTier === 'weak' && Nk.includes(e.matchKey)
  )
  const relation = deriveRelation(Nk, Gk, {
    unmatchedCount: unmatched.length,
    acceptedMatchType: matchDiagnostics.acceptedMatchType || 'EXACT',
    acceptedIsSynonymChain: !!matchDiagnostics.acceptedIsSynonymChain,
    weakKeysInPlay,
    synonymyReconstructed: !colConcept
  })
  relation.plain = relationLabel(relation, { twName, colAcceptedName })
  relation.checkedNames = Nk.length
  relation.totalNames = nEntries.length
  if (relation.alternative) {
    relation.alternative.plain = relationLabel(relation.alternative, {
      twName,
      colAcceptedName
    })
  }

  // ---- zones ----
  const NkSet = new Set(Nk)
  const GkSet = new Set(Gk)
  const withRecords = (e) => ({
    ...e,
    records: byMatchKey.has(e.matchKey) ? byMatchKey.get(e.matchKey) : null
  })

  const consensus = nEntries
    .filter((e) => e.colMatched && GkSet.has(e.matchKey))
    .map((e) => {
      const g = gEntries.find((x) => x.matchKey === e.matchKey)
      return withRecords({ ...e, matchTier: g ? g.matchTier : 'weak' })
    })

  const twKeepsIn = nEntries
    .filter((e) => e.colMatched && !GkSet.has(e.matchKey))
    .map((e) => withRecords({ ...e, colRole: 'colSeparateAccepted' }))

  const colFoldsIn = gEntries
    .filter((e) => e.colRole === 'colSynonym' && !NkSet.has(e.matchKey))
    .map((e) => withRecords({ ...e, twPlacement: null, otherCombinations: [] }))

  const misapplied = colMisapplied.map((m) => ({
    name: m.name,
    short: shortName(m.name),
    matchKey: m.matchKey
  }))

  const notComparable = unmatched

  return {
    twName,
    colAcceptedName,
    twAcceptedIsColSynonym,
    tw: { accepted: twName, synonyms: twNodes.filter((n) => n.role === 'twSynonym').map((n) => n.name) },
    gbif: colConcept
      ? { accepted: colConcept.accepted, ourNameIsColSynonym: twAcceptedIsColSynonym }
      : null,
    relation,
    zones: { consensus, twKeepsIn, colFoldsIn, misapplied, inDataOnly, notComparable },
    counts: {
      total: summaryCounts.total ?? null,
      withImage: summaryCounts.withImage ?? null,
      withCoordinate: summaryCounts.withCoordinate ?? null,
      byMatchKey
    },
    urls
  }
}

function shortName(name) {
  const t = String(name || '').trim().split(/\s+/)
  const out = [t[0]]
  for (let i = 1; i < t.length; i++) {
    if (/^[a-z][a-z-]+$/.test(t[i]) || /^\([A-Z][a-z-]+\)$/.test(t[i])) out.push(t[i])
    else break
  }
  return out.join(' ')
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node --test panels/_gbifShared/assembleAlignment.test.js`
Expected: PASS. If `sharedCount` or a zone membership is off, print `Nk`, `Gk`, and each entry's `matchKey`, and reconcile the author-year strings between the TaxonWorks node fixture and the Catalogue of Life synonym fixture (a `weak` or missing match is almost always an author-surname normalisation gap; add the case to `gbifNameMatch.test.js` and fix `normalizeSurname`).

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all four test files PASS.

- [ ] **Step 7: Commit**

```bash
git add panels/_gbifShared/assembleAlignment.js panels/_gbifShared/assembleAlignment.test.js panels/_gbifShared/__fixtures__/
git commit -m "feat(gbif): pure concept alignment model assembly"
```

---

## Task 5: gbifConceptAlignment.js — orchestrator

**Files:**
- Create: `panels/_gbifShared/gbifConceptAlignment.js`

**Interfaces:**
- Consumes: `fetchTwSynonymNames` from `./twSynonymNames.js`; `resolveGbifTaxonScope` from `./gbifTaxonScope.js`; `useGbifMatch` internals via `matchGbifKey`, `CHECKLIST_KEY`, `GBIF_TAXON_BASE`, `GBIF_OCCURRENCE_BASE` from `./useGbifMatch.js`; `fetchChecklistConcept` from `./gbifChecklistConcept.js`; `buildAlignmentModel` from `./assembleAlignment.js`; `matchKey` from `./gbifNameMatch.js`; `makeAPIRequest` from `@/utils/request`.
- Produces:
  - `resolveConceptAlignment(primaryName: string, taxonId: number|string, opts?: { rejectHigherRank?: boolean }): Promise<AlignmentModel & { matched, rankEligible, urls }>`
  - `fetchTwPlacement(nameString: string): Promise<{ known, valid, validName, synonymOf, otuId, ambiguous }>`

This task has no unit test (it needs `@/` alias resolution, only available under Vite). It is verified through Task 6 in the running app. Keep the fetch sequence thin: every branch either returns a well-formed partial model or throws to a single catch that yields `{ matched: false }`.

- [ ] **Step 1: Implement the module**

Create `panels/_gbifShared/gbifConceptAlignment.js`:

```js
// Orchestrates the concept alignment for PanelGbifTaxon: fetches the TaxonWorks
// name set (with original combinations), the Catalogue of Life synonymy, the
// occurrence facet and summary counts, then hands everything to
// buildAlignmentModel. Memoised per page load. See the design spec, sections 5 to 7.
import { makeAPIRequest } from '@/utils/request'
import {
  matchGbifKey,
  CHECKLIST_KEY,
  GBIF_TAXON_BASE,
  GBIF_OCCURRENCE_BASE
} from './useGbifMatch'
import { resolveGbifTaxonScope } from './gbifTaxonScope'
import { fetchTwSynonymNames } from './twSynonymNames'
import { fetchChecklistConcept } from './gbifChecklistConcept'
import { buildAlignmentModel } from './assembleAlignment'
import { matchKey } from './gbifNameMatch'

const OCC = 'https://api.gbif.org/v1/occurrence/search'
const V1_MATCH = 'https://api.gbif.org/v1/species/match'
const cache = new Map()

export function resolveConceptAlignment(primaryName, taxonId, opts = {}) {
  const key = `${taxonId}|${primaryName}`
  if (!cache.has(key)) cache.set(key, resolve(primaryName, taxonId, opts))
  return cache.get(key)
}

async function resolve(primaryName, taxonId, opts) {
  try {
    // 1. TaxonWorks name set with author-year and original combinations
    const twNodes = await fetchTwNodes(primaryName, taxonId)

    // 2. GBIF match + scope keys (reuses the shared resolver)
    const scope = await resolveGbifTaxonScope(primaryName, taxonId, {
      rejectHigherRank: opts.rejectHigherRank !== false
    })
    if (!scope.keys.length) return { matched: false }

    // rank gate: reuse the shared match; a HIGHERRANK is not eligible
    const rankEligible = true // resolveGbifTaxonScope with rejectHigherRank already dropped HIGHERRANK

    // 3. Catalogue of Life synonymy
    const colConcept = await fetchChecklistConcept(primaryName, twNodes, {
      checklistKey: CHECKLIST_KEY
    })
    const colAcceptedName = colConcept ? colConcept.accepted.name : primaryName

    // 4. occurrence facet + summary counts across the whole scope key union
    const [facetCounts, summaryCounts] = await Promise.all([
      fetchFacet(scope.keys),
      fetchSummary(scope.keys)
    ])

    // 5. backbone key, only for the two entry-point links
    const backboneKey = await fetchBackboneKey(primaryName)

    // 6. assemble
    const withKeys = twNodes.map((n) => ({
      ...n,
      matchKey: matchKey(n.canonical, { author: n.authorYear }),
      colMatched: true // refined below
    }))
    // mark colMatched by testing each node's key against the CoL name set
    const gKeys = new Set(
      colConcept
        ? [
            matchKey(colConcept.accepted.name),
            ...colConcept.synonyms.map((s) => s.matchKey),
            // a TaxonWorks name CoL accepts separately still counts as matched
          ]
        : []
    )
    for (const n of withKeys) {
      n.colMatched = await nodeIsInCol(n, gKeys)
    }

    const model = buildAlignmentModel({
      twName: primaryName,
      colAcceptedName,
      twAcceptedIsColSynonym: colConcept
        ? matchKey(colConcept.accepted.name) !== withKeys[0].matchKey
        : false,
      twNodes: withKeys,
      colConcept,
      facetCounts,
      summaryCounts,
      matchDiagnostics: { acceptedMatchType: 'EXACT', acceptedIsSynonymChain: false },
      urls: buildUrls(colConcept, backboneKey, scope.keys, primaryName)
    })

    return { matched: true, rankEligible, ...model }
  } catch (e) {
    return { matched: false, error: true }
  }
}

async function fetchTwNodes(primaryName, taxonId) {
  // valid name node
  const nodes = [nodeFromTw({ cached: primaryName }, 'accepted')]
  // synonyms: reuse the two-step resolver, but we need full records for
  // original_combination, so fetch the taxon-name rows directly
  const { data: rels } = await makeAPIRequest.get('/taxon_name_relationships', {
    params: { 'object_taxon_name_id[]': taxonId, per: 500 }
  })
  const synIds = [
    ...new Set(
      (rels || [])
        .filter((r) => r.type?.includes('Invalidating') || r.type?.includes('Synonym'))
        .map((r) => r.subject_taxon_name_id)
        .filter((id) => id && id !== Number(taxonId))
    )
  ]
  if (synIds.length) {
    const p = new URLSearchParams()
    synIds.forEach((id) => p.append('taxon_name_id[]', id))
    p.append('per', '500')
    const { data: names } = await makeAPIRequest.get(`/taxon_names?${p}`)
    for (const n of names || []) nodes.push(nodeFromTw(n, 'twSynonym'))
  }
  // fill the valid name node's author-year and original combination
  try {
    const { data } = await makeAPIRequest.get('/taxon_names', {
      params: { name: primaryName, name_exact: true, per: 1 }
    })
    if (data && data[0]) nodes[0] = nodeFromTw(data[0], 'accepted')
  } catch {
    /* keep the bare node */
  }
  return nodes
}

function nodeFromTw(row, role) {
  const name = row.cached || row.name || ''
  const authorYear = row.cached_author_year || ''
  const oc = row.cached_original_combination
    ? `${row.cached_original_combination}${
        row.cached_author_year ? ' ' + stripParens(row.cached_author_year) : ''
      }`
    : null
  return {
    name: authorYear ? `${name} ${authorYear}` : name,
    short: name,
    canonical: name,
    authorYear,
    originalCombination: oc,
    role
  }
}

const stripParens = (s) => String(s).replace(/[()]/g, '')

async function nodeIsInCol(node, gKeys) {
  if (gKeys.has(node.matchKey)) return true
  // CoL may accept this TaxonWorks synonym as its own species: still a match
  // in the sense that CoL "knows" it. Confirm with a cheap v2 match.
  try {
    const k = await matchGbifKey(node.canonical, { rejectHigherRank: true })
    return !!k
  } catch {
    return false
  }
}

async function fetchFacet(keys) {
  const u = new URL(OCC)
  keys.forEach((k) => u.searchParams.append('taxonKey', k))
  u.searchParams.set('checklistKey', CHECKLIST_KEY)
  u.searchParams.set('limit', '0')
  u.searchParams.set('facet', 'scientificName')
  u.searchParams.set('facetLimit', '200')
  const res = await fetch(u)
  if (!res.ok) return []
  const data = await res.json()
  return (data.facets?.[0]?.counts || []).map((c) => ({ name: c.name, count: c.count }))
}

async function fetchSummary(keys) {
  const base = () => {
    const u = new URL(OCC)
    keys.forEach((k) => u.searchParams.append('taxonKey', k))
    u.searchParams.set('checklistKey', CHECKLIST_KEY)
    u.searchParams.set('limit', '0')
    return u
  }
  const count = async (u) => {
    const res = await fetch(u)
    return res.ok ? (await res.json()).count ?? null : null
  }
  const plain = base()
  const img = base()
  img.searchParams.set('mediaType', 'StillImage')
  const geo = base()
  geo.searchParams.set('hasCoordinate', 'true')
  const [total, withImage, withCoordinate] = await Promise.all([
    count(plain),
    count(img),
    count(geo)
  ])
  return { total, withImage, withCoordinate }
}

async function fetchBackboneKey(name) {
  try {
    const res = await fetch(`${V1_MATCH}?name=${encodeURIComponent(name)}`)
    if (!res.ok) return null
    const d = await res.json()
    return d.acceptedUsageKey || d.usageKey || null
  } catch {
    return null
  }
}

function buildUrls(colConcept, backboneKey, scopeKeys, name) {
  const colTaxon = colConcept?.accepted?.alphaKey
    ? `${GBIF_TAXON_BASE}/${colConcept.accepted.alphaKey}`
    : null
  const scoped = new URLSearchParams()
  scoped.set('checklist_key', CHECKLIST_KEY)
  scopeKeys.forEach((k) => scoped.append('taxon_key', k))
  return {
    colTaxon,
    backboneTaxon: backboneKey ? `https://www.gbif.org/species/${backboneKey}` : null,
    backboneOccurrence: backboneKey
      ? `${GBIF_OCCURRENCE_BASE}?taxon_key=${backboneKey}`
      : `${GBIF_OCCURRENCE_BASE}?q=${encodeURIComponent(name)}`,
    scopedOccurrence: `${GBIF_OCCURRENCE_BASE}?${scoped}`
  }
}

// ---- lazy reverse lookup for the "Catalogue of Life places elsewhere" zone ----
const placementCache = new Map()

export function fetchTwPlacement(nameString) {
  if (!placementCache.has(nameString)) {
    placementCache.set(nameString, resolvePlacement(nameString))
  }
  return placementCache.get(nameString)
}

async function resolvePlacement(nameString) {
  try {
    const canonical = nameString.replace(/\s*\(.*$/, '').replace(/,.*$/, '').trim()
    const { data } = await makeAPIRequest.get('/taxon_names', {
      params: { name: canonical, per: 20 }
    })
    const hits = (data || []).filter((r) => {
      const c = (r.cached || '').toLowerCase()
      return c.split(' ').slice(-1)[0] === canonical.split(' ').slice(-1)[0]
    })
    if (!hits.length) return { known: false }
    if (hits.length > 1 && hits.filter((h) => h.cached_is_valid).length !== 1) {
      return { known: true, ambiguous: true }
    }
    const row = hits.find((h) => h.cached_is_valid) || hits[0]
    if (row.cached_is_valid) {
      return { known: true, valid: true, validName: row.cached, otuId: null }
    }
    const validId = row.cached_valid_taxon_name_id
    let validName = null
    if (validId) {
      try {
        const { data: v } = await makeAPIRequest.get(`/taxon_names/${validId}`)
        validName = v?.cached || null
      } catch {
        /* ignore */
      }
    }
    return { known: true, valid: false, synonymOf: validName, otuId: null }
  } catch {
    return { known: false, error: true }
  }
}
```

- [ ] **Step 2: Sanity check with a throwaway script**

Create `/tmp/claude-1000/.../scratchpad/probe.mjs` is not possible (needs the alias). Instead verify in Task 6. Skip to commit.

- [ ] **Step 3: Commit**

```bash
git add panels/_gbifShared/gbifConceptAlignment.js
git commit -m "feat(gbif): concept alignment orchestrator"
```

---

## Task 6: PanelGbifTaxon.vue rewrite

**Files:**
- Modify: `panels/PanelGbifTaxon/PanelGbifTaxon.vue` (full rewrite of `<template>`, `<script setup>`, `<style scoped>`)

**Interfaces:**
- Consumes: `resolveConceptAlignment`, `fetchTwPlacement` from `../_gbifShared/gbifConceptAlignment`; `deriveScientificName`, `gbifMenuOptions` from `../_gbifShared/useGbifMatch`; `gbifMark` from `../_gbifShared/gbif-mark.svg`; `../_gbifShared/gbif-tokens.css`; `PanelDropdown`, `useOtuPageRequestStore` as today.
- Produces: nothing (leaf panel).

Reference the target rendering in `docs/gbif-viz-options.html` (the "In context" panel and the five-state icon strip). The five `relation.icon` states map to the SVGs in that file.

- [ ] **Step 1: Replace the component**

Rewrite `panels/PanelGbifTaxon/PanelGbifTaxon.vue`. Structure:

- `<template>`: `VCard` > `VCardHeader` (mark, `<h2>` with `<em>{{ model.twName }}</em> in GBIF`, `PanelDropdown`) > `VCardContent`.
  - `VSpinner` while `loading`.
  - `matched === false`: the no-match paragraph.
  - `rankEligible === false`: matched-name line, summary line, entry points, the one sentence.
  - else: matched-name line (8.1), relation row (8.2) with the inline SVG icon chosen by `model.relation.icon`, the collapsible explainer (8.3), the zone `<table>` (8.4 and 8.5), the summary line (8.6), the "Open in GBIF" list (8.7).
- `<script setup>`:
  - props unchanged (`otuId`, `taxonId`, `taxon`, `otu`).
  - `scientificName = computed(() => deriveScientificName(props.taxon, props.otu))`.
  - `const model = ref(null); const loading = ref(false)`.
  - `watch(scientificName, load, { immediate: true })` where `load` guards with `typeof window === 'undefined'` returning early (SSR), captures `forName`, calls `resolveConceptAlignment`, bails on staleness, assigns `model.value`, registers the request with `useOtuPageRequestStore` under `panel:gbif-taxon`.
  - `expandFoldsIn(row)`: sets a per-row `pending` flag, `await fetchTwPlacement(row.name)`, writes `row.twPlacement`.
  - icon: a small `<component :is>` or a `v-if` chain rendering one of five inline `<svg>` blocks; copy the exact `rect` coordinates from `docs/gbif-viz-options.html`.
- `<style scoped>`: remove every `.gbif-venn` / `.gv-*` rule. Add the table, zone-heading, tier-tag, and icon styles. Zone-heading left accent via `box-shadow: inset 3px 0 0 var(--pp-tw)` etc. Icon `rect` fill via `fill: var(--pp-tw)` / `var(--pp-gbif)` with `fill-opacity: .22`. No hex, no default palette.

All copy strings must obey the Global Constraints (no dashes, no "this taxon"/"this concept"/"here", column headers carry the referent).

- [ ] **Step 2: Restart the dev server**

```bash
# stop any running dev server first
npm run dev
```

- [ ] **Step 3: Find the test OTU pages**

```bash
curl -s "https://sfg.taxonworks.org/api/v1/otus?taxon_name_id[]=834447&project_token=Ots0-yen4dVefn0Etyxvgw" | python3 -c "import json,sys;[print(r['id'], r.get('object_label')) for r in json.load(sys.stdin)]"
```

Repeat for a congruent case and a genus. Open `http://localhost:5173/otus/<id>` for each.

- [ ] **Step 4: Verify against the spec**

Check, on the *Larinus latus* page:
- title reads "*Larinus latus* in GBIF"
- relation line reads the overlap sentence with "4" (or the live shared count) and the `><` icon renders
- the zone table has the four groups, column headers "TaxonWorks: *Larinus latus*" and "Catalogue of Life: *Larinus latus*"
- *Lixus cardui* row shows 931 (or the live count) and, on expand, "synonym of *Larinus cynarae* (Fabricius, 1787)"
- summary line shows the total and the "58 percent identified as *Lixus cardui*" sentence
- no "this taxon" / "this concept" / dash anywhere
- dark mode (toggle the site theme): every value cell stays readable, icon rects stay visible

On a genus page: only the short form renders, no table.
On a no-match name: only the no-match line.

- [ ] **Step 5: Screenshot for the record**

Save a light and dark screenshot of the *Larinus latus* panel to `docs/` for the review.

- [ ] **Step 6: Commit**

```bash
git add panels/PanelGbifTaxon/PanelGbifTaxon.vue docs/*.png
git commit -m "feat(gbif): rebuild PanelGbifTaxon around the concept alignment model"
```

---

## Task 7: Docs, docstrings, memory

**Files:**
- Modify: `panels/_gbifShared/gbifBackboneConcept.js` (docstring only)
- Modify: `panels/_gbifShared/readme.md`
- Modify: `panels/PanelGbifTaxon/readme.md`
- Modify: memory files (listed below)

- [ ] **Step 1: gbifBackboneConcept.js docstring**

Replace the header comment with a note that it is no longer used by `PanelGbifTaxon` as of 2026-08-31 (the backbone and Catalogue of Life agree on lumping for this project's taxa; the old use matched homonyms by bare canonical name), and that `PanelGbifMap` still calls it for its density gate.

- [ ] **Step 2: panels/_gbifShared/readme.md**

Add rows for `gbifNameMatch.js`, `conceptRelation.js`, `gbifChecklistConcept.js`, `assembleAlignment.js`, `gbifConceptAlignment.js`. Rewrite "The GBIF synonymy problem" section: it now describes the two-layer alignment model (name graph plus RCC-5 relation), the three match tiers, the Catalogue of Life integer-key path, and states that the two-circle Venn is replaced by the zone table plus the Franz and Peet Fig. 2 icon. Record the backbone finding (backbone and CoL agree; `Lixus cardui` Aurivillius 1921 is the homonym artefact).

- [ ] **Step 3: panels/PanelGbifTaxon/readme.md**

Rewrite: the panel shows the concept alignment for the taxon against Catalogue of Life, as a zone table with a relation icon. Note the two layers, the Catalogue of Life choice (the checklist the sibling panels query), the three match tiers, the SSR guard, and that it no longer reads the GBIF backbone except for two entry-point links.

- [ ] **Step 4: Memory**

- Update `memory/reference_gbif_synonymy_lumping.md`: the backbone correction is already recorded; add that `PanelGbifTaxon` now uses the CoL integer-key synonyms path and the three-tier match.
- Update `memory/project_gbif_type_images_gallery.md`: note the PanelGbifTaxon redesign shipped (this branch), Venn replaced by zone table plus relation icon.
- Create `memory/project_gbif_concept_alignment.md` (type project): the engine modules, the `>< ` anchor case, the `node --test` suite, the spec and plan paths. Add a line to `MEMORY.md`.

- [ ] **Step 5: Run the suite once more and commit**

```bash
npm test
git add panels/_gbifShared/gbifBackboneConcept.js panels/_gbifShared/readme.md panels/PanelGbifTaxon/readme.md
git commit -m "docs(gbif): document the concept alignment engine, retire the backbone Venn"
```

Memory files are outside the repo; write them with the Write tool, do not commit.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| 4.1 name graph | Task 4 (`NameNode` shape in `buildAlignmentModel`) |
| 4.2 relation derivation, confidence, reconciliation | Task 2 |
| 4.3 four zones | Task 4 |
| 4.4 three match tiers | Task 1 (keys and tiers), Task 3 (tier tagging on CoL names) |
| 5.1 TaxonWorks fetches, reverse lookup | Task 5 (`fetchTwNodes`, `fetchTwPlacement`) |
| 5.2 CoL synonymy, integer-key bridge, no ChecklistBank | Task 3 |
| 5.3 facet and summary counts | Task 5 (`fetchFacet`, `fetchSummary`) |
| 6 module list | Tasks 1 to 5 create the four new files plus the orchestrator; Task 7 updates `gbifBackboneConcept.js` |
| 7 model object | Task 4 (assembly) plus Task 5 (`matched`, `rankEligible`, `urls`) |
| 8 panel layout, 8.1 to 8.8 | Task 6 |
| 9 trust calibration rules | Task 6 (copy), enforced by Global Constraints |
| 10 edge cases | Task 5 (fetch failures, degraded mode, stale nav), Task 6 (rank gate, SSR, no-match) |
| 11 loading and empty states | Task 6 |
| 12 testing | Tasks 1 to 4 |
| 13 cleanup and migration | Task 6 (remove Venn), Task 7 (docs, docstring) |
| 14 open questions | Task 5 Step 1 resolves Q1 in code (fetch full taxon_name rows for `cached_original_combination`); Q2 and Q3 are Task 6 review points |

No gap found.

**2. Placeholder scan**

Task 5 Step 2 ("Sanity check with a throwaway script") is a non-step; it correctly defers to Task 6. Task 6 Step 1 describes the component in prose rather than a full code block because it is a 200-line SFC rewrite driven by an existing visual reference (`docs/gbif-viz-options.html`) and the spec section 8; the structure, every consumed symbol, and every constraint are listed. Acceptable for an SFC of this size with a pixel reference in the repo. No "TBD", no "add error handling", no undefined references.

**3. Type consistency**

- `matchKey` signature `(name, { author })` is used consistently in Tasks 1, 3, 4, 5.
- `matchTier(twKey, colKey, { twOriginalCombination, colNameStrings })` in Task 1 matches the call in Task 3 `bestTier`.
- `ColConcept` shape (`{ accepted: { name, alphaKey, intKey }, synonyms, misapplied }`) produced in Task 3, consumed in Task 4 `buildAlignmentModel` and Task 5.
- `AlignmentModel` fields (`relation`, `zones`, `counts`, `urls`, `twName`, `colAcceptedName`) produced in Task 4, extended in Task 5 with `matched` and `rankEligible`, consumed in Task 6.
- `relation.icon` values (`congruent | included | includes | overlap | none`) defined in Task 2 `RELATIONS`, consumed in Task 6 icon switch.
- `fetchTwPlacement` return shape (`{ known, valid, validName, synonymOf, otuId, ambiguous }`) defined in Task 5, consumed in Task 6 `expandFoldsIn`.

Consistent.
