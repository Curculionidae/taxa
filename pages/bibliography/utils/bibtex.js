// Fields in the order they are written. The names are both the TaxonWorks
// source attribute and the BibTeX field.
const FIELDS = [
  'author',
  'editor',
  'title',
  'booktitle',
  'journal',
  'series',
  'volume',
  'number',
  'pages',
  'chapter',
  'edition',
  'publisher',
  'address',
  'institution',
  'organization',
  'school',
  'howpublished',
  'year',
  'month',
  'doi',
  'isbn',
  'issn',
  'url',
  'note'
]

// Written as they are: escaping would break the link or identifier.
const RAW_FIELDS = ['doi', 'url', 'isbn', 'issn']

const NAME_FIELDS = ['author', 'editor']

// BibTeX wants names joined by " and ", each "Surname, Given" or
// "Surname, Jr, Given". Some sources list people with commas instead, or
// have a doubled "and". Such
// a field cannot be parsed and BibTeX drops the whole entry, so it is
// written in double braces, which keeps the text as one literal name.
function isNameList(value) {
  return String(value)
    .split(/\s+and\s+/i)
    .every(
      (name) =>
        name.trim() &&
        !/^and\s/i.test(name) &&
        name.split(',').length <= 3 &&
        !/,\s*$/.test(name)
    )
}

// BibTeX month macros, written without braces.
const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec'
]

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}

const SPECIAL = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  '#': '\\#',
  $: '\\$',
  _: '\\_'
}

function escapeText(text) {
  return text.replace(/[\\{}&%#$_]/g, (char) => SPECIAL[char])
}

// TaxonWorks stores italics as HTML, mostly taxon names in titles.
function toLatex(value) {
  return String(value)
    .split(/(<\/?(?:i|em)>)/i)
    .map((part) => {
      if (/^<(i|em)>$/i.test(part)) return '\\textit{'
      if (/^<\/(i|em)>$/i.test(part)) return '}'

      return escapeText(
        part
          .replace(/<[^>]+>/g, '')
          .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity] ?? entity)
      )
    })
    .join('')
}

function makeKey(source) {
  // A stored key is kept only when it is usable as one.
  if (/^[A-Za-z0-9:._-]+$/.test(source.key || '')) return source.key

  const surname = (source.author || '')
    .split(/\s+and\s+|,/)[0]
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
  const suffix = String(source.year_suffix || '').replace(/[^A-Za-z0-9]/g, '')

  return surname && source.year
    ? `${surname}${source.year}${suffix}`
    : `source${source.id}`
}

function makeEntry(source, key) {
  const values = { ...source }

  if (!source.bibtex_type && source.verbatim) values.note = source.verbatim

  const lines = FIELDS.filter(
    (field) => ![null, undefined, ''].includes(values[field])
  ).map((field) => {
    const value = values[field]

    if (field === 'month' && MONTHS.includes(value)) return `  month = ${value}`
    if (NAME_FIELDS.includes(field) && !isNameList(value)) {
      return `  ${field} = {{${toLatex(value)}}}`
    }
    if (RAW_FIELDS.includes(field)) return `  ${field} = {${value}}`

    return `  ${field} = {${toLatex(value)}}`
  })

  return `@${source.bibtex_type || 'misc'}{${key},\n${lines.join(',\n')}\n}\n`
}

/**
 * TaxonWorks sources as a BibTeX file. Text is UTF-8, so the file wants
 * biber or a UTF-8 aware BibTeX.
 *
 * @param {object[]} sources records from the `/sources` endpoint
 * @returns {string}
 */
export function toBibtex(sources) {
  const used = new Map()

  return sources
    .map((source) => {
      // BibTeX compares keys without regard to case.
      const base = makeKey(source)
      const count = (used.get(base.toLowerCase()) || 0) + 1

      used.set(base.toLowerCase(), count)

      return makeEntry(source, count > 1 ? `${base}_${count}` : base)
    })
    .join('\n')
}
