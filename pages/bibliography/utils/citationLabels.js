/**
 * What a citation pill says: its label and its hover text.
 *
 * A pill stands for the citations of one source on one kind of record of a
 * taxon. `type` is the TaxonWorks class of that record. `kind` narrows it
 * down where the class alone says too little: which relationship, which
 * status, or what an origin citation of a name amounts to.
 */
const words = (text) =>
  text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

const sentenceCase = (text) => {
  const lower = words(text).toLowerCase()

  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

const lastPart = (type) => sentenceCase(type.split('::').pop())

// First match wins.
const RELATIONSHIP_KINDS = [
  [/Typification::Genus/, 'Type species'],
  [/Typification::Family/, 'Type genus'],
  [/Typification/, 'Type designation'],
  [/OriginalCombination/, 'Original combination'],
  [/Combination/, 'Combination'],
  [/SourceClassifiedAs/, 'Classified as'],
  [/Invalidating::Homonym/, 'Homonymy'],
  [/Synonym/, 'Synonymy']
]

const STATUS_KINDS = [
  [/NomenNudum/, () => 'Nomen nudum'],
  [/Suppressed/, () => 'Suppressed'],
  [/Latinized::Gender::/, (type) => `Gender: ${lastPart(type).toLowerCase()}`],
  [
    /Latinized::PartOfSpeech::/,
    (type) => `Part of speech: ${lastPart(type).toLowerCase()}`
  ]
]

// "TaxonNameRelationship::Iczn::Invalidating::Synonym::Subjective" is a
// synonymy. A type not listed is named by its last part.
export function getRelationshipKind(type) {
  if (!type) return undefined

  const known = RELATIONSHIP_KINDS.find(([pattern]) => pattern.test(type))

  return known ? known[1] : lastPart(type)
}

export function getStatusKind(type) {
  if (!type) return undefined

  const known = STATUS_KINDS.find(([pattern]) => pattern.test(type))

  return known ? known[1](type) : lastPart(type)
}

const TYPES = {
  TaxonName: {
    label: 'Nomenclature',
    help: 'This source is cited on the name itself.'
  },
  Otu: { label: 'OTU', help: 'This source is cited on the taxon itself.' },
  AssertedDistribution: {
    label: 'Distribution',
    help: 'An asserted distribution of this taxon was entered from this source.'
  },
  BiologicalAssociation: {
    label: 'Biological association',
    help: 'A biological association of this taxon, such as a host plant, was entered from this source.'
  },
  Content: {
    label: 'Content',
    help: 'A text about this taxon was taken from this source.'
  },
  CollectionObject: {
    label: 'Specimen',
    help: 'A specimen of this taxon is cited from this source.'
  },
  Image: {
    label: 'Image',
    help: 'An image of this taxon is cited from this source.'
  },
  TaxonNameRelationship: {
    label: 'Name relationship',
    help: 'This source is cited for how this name relates to another name.'
  },
  TaxonNameClassification: {
    label: 'Name status',
    help: 'This source is cited for a status of this name.'
  },
  TypeMaterial: {
    label: 'Type material',
    help: 'This source is cited for type material of this name.'
  },
  Lead: {
    label: 'Key',
    help: 'This source is cited in an identification key.'
  }
}

// What the origin citation of a name amounts to.
const NAME_KINDS = {
  original: {
    label: 'Original description',
    help: 'This source is the original description of the name.'
  },
  misspelling: {
    label: 'Misspelling',
    help: 'This source is where this misspelling of the name comes from.'
  },
  combination: {
    label: 'New combination',
    help: 'This source is the first to use this combination.'
  }
}

function describeType({ type, kind }) {
  if (type === 'TaxonName' && NAME_KINDS[kind]) return NAME_KINDS[kind]

  if (type === 'TaxonNameRelationship' && kind) {
    return {
      label: kind,
      help: `This source is cited for how this name relates to another name: ${kind.toLowerCase()}.`
    }
  }

  if (type === 'TaxonNameClassification' && kind) {
    return {
      label: kind,
      help: /^(Gender|Part of speech):/.test(kind)
        ? `This source is cited for the grammar of this name (${kind.toLowerCase()}).`
        : `This source is cited for the status of this name: ${kind.toLowerCase()}.`
    }
  }

  if (TYPES[type]) return TYPES[type]

  // A type without a label, e.g. one TaxonWorks adds later, falls back to
  // its class name split into words: "FieldOccurrence", "Field occurrence".
  const label = sentenceCase(type)

  return {
    label,
    help: `This source is cited on a record of the kind "${label}".`
  }
}

/**
 * @param {{ type: string, kind?: string, topics?: object[] }} item
 * @returns {{ label: string, help: string }}
 */
export function describeCitedOn(item) {
  const { label, help } = describeType(item)
  const topics = (item.topics || []).map(({ name, definition }) =>
    definition ? `${name} (${definition})` : name
  )

  return {
    label,
    help: topics.length
      ? `${help} Topics tagged on this citation, saying what the source covers: ${topics.join(', ')}.`
      : help
  }
}
