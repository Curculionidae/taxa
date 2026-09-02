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
    synonymyReconstructed = false,
    gHasAmbiguousOnly = false
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
