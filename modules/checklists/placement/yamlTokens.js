// A small YAML tokenizer for showing the rules file with colours on the
// curator page's Rules tab (components/RulesView.vue).
//
// Purpose: colour placement.yml line by line without a highlighting library
// in the browser bundle (none is a dependency of the site or of TaxonPages).
// It only colours; it never decides anything, and an odd line just comes out
// with fewer colours.
//
// Input:  one line of YAML text.
// Output: tokens [{ text, kind }] whose texts joined give the line back
//         unchanged. Kinds: 'comment' (# to the end of the line), 'key' (a
//         mapping key, also inside { }), 'colon', 'string' (quoted), 'number',
//         'boolean' (true, false, null), 'dash' (a list item's -), 'bracket'
//         ([ ] { } and the commas between flow items), 'space', 'text' (any
//         other value).
// Rules: a # starts a comment at the line start or after a space, never
//         inside quotes. Inside [ ] or { } the characters , ] } end a value;
//         outside they are part of it ("why: a, b" is one value). The flow
//         depth is counted per line; the rules file keeps flow lists on one line.
// Pure: no imports, no network; runs in Node (yamlTokens.test.js) and the browser.

const SCALAR_NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/
const SCALAR_BOOLEAN = /^(true|false|null|~)$/i

/**
 * @typedef {{ text: string, kind: 'comment'|'key'|'colon'|'string'|'number'|'boolean'|'dash'|'bracket'|'space'|'text' }} YamlToken
 */

/**
 * The tokens of one line (see the header).
 * @param {string} line
 * @returns {YamlToken[]}
 * @example
 *   tokenizeYamlLine('  - match: { tdwg: 12FRA }   # a comment')
 *   // space, dash, space, key 'match', colon, space, bracket '{', space, key 'tdwg',
 *   // colon, space, text '12FRA', space, bracket '}', space, comment '# a comment'
 */
export function tokenizeYamlLine(line) {
  const text = String(line ?? '')
  const tokens = []
  const push = (value, kind) => { if (value) tokens.push({ text: value, kind }) }
  let depth = 0
  let i = 0
  let lineStart = true // only spaces (and dashes) so far: a dash here is a list item
  while (i < text.length) {
    const char = text[i]
    const previous = i > 0 ? text[i - 1] : ' '
    if (char === ' ' || char === '\t') {
      let end = i
      while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++
      push(text.slice(i, end), 'space')
      i = end
      continue
    }
    if (char === '#' && (previous === ' ' || previous === '\t' || i === 0)) {
      push(text.slice(i), 'comment')
      break
    }
    if (lineStart && char === '-' && (i + 1 === text.length || text[i + 1] === ' ')) {
      push('-', 'dash')
      i += 1
      continue
    }
    lineStart = false
    if (char === '[' || char === '{') { depth += 1; push(char, 'bracket'); i += 1; continue }
    if ((char === ']' || char === '}') && depth > 0) { depth -= 1; push(char, 'bracket'); i += 1; continue }
    if (char === ',' && depth > 0) { push(char, 'bracket'); i += 1; continue }
    if (char === '"' || char === "'") {
      let end = i + 1
      while (end < text.length) {
        if (char === '"' && text[end] === '\\') { end += 2; continue }
        if (text[end] === char) {
          if (char === "'" && text[end + 1] === "'") { end += 2; continue }
          end += 1
          break
        }
        end += 1
      }
      const quoted = text.slice(i, Math.min(end, text.length))
      i += quoted.length
      // A quoted key ("Hawai'i": ...) is still a key.
      if (text[i] === ':' && (i + 1 === text.length || /[\s,\]}]/.test(text[i + 1]))) push(quoted, 'key')
      else push(quoted, 'string')
      continue
    }
    // A plain scalar: up to ': ', ' #', and in flow context , ] }.
    let end = i
    while (end < text.length) {
      const c = text[end]
      if (c === ':' && (end + 1 === text.length || /[\s,\]}]/.test(text[end + 1]))) break
      if (c === '#' && (text[end - 1] === ' ' || text[end - 1] === '\t')) break
      if (depth > 0 && (c === ',' || c === ']' || c === '}')) break
      end += 1
    }
    // Trailing spaces before a comment stay spaces.
    let valueEnd = end
    while (valueEnd > i && (text[valueEnd - 1] === ' ' || text[valueEnd - 1] === '\t')) valueEnd -= 1
    const value = text.slice(i, valueEnd)
    if (text[end] === ':' && valueEnd === end) {
      push(value, 'key')
      push(':', 'colon')
      i = end + 1
      continue
    }
    if (value) push(value, SCALAR_NUMBER.test(value) ? 'number' : SCALAR_BOOLEAN.test(value) ? 'boolean' : 'text')
    i = valueEnd > i ? valueEnd : end + 1 // end + 1: never stand still
  }
  return tokens
}

/**
 * The tokens of every line of a YAML text.
 * @param {string} text
 * @returns {YamlToken[][]}  one array per line (a final newline gives no extra line)
 */
export function tokenizeYaml(text) {
  return String(text ?? '').replace(/\n$/, '').split('\n').map(tokenizeYamlLine)
}
