/**
 * evidenceRules.js
 *
 * Which colour a record earns in the Field Assistant. EDIT THIS FILE to change
 * the grading -- nothing else needs to change: the dots, the per-row counts and
 * the ⓘ legend in the Records heading are all built from the table below.
 *
 * One line per case:   [stage, relationship, colour]
 *
 *   stage         the anatomical part of the Subject (the beetle side):
 *                 'egg', 'larva', 'pupa', 'nidus', 'adult' -- or '*' for any.
 *   relationship  the BiologicalRelationship exactly as TaxonWorks names it
 *                 (upper/lower case does not matter) -- or '*' for any.
 *   colour        'green', 'orange' or 'red'.
 *
 * The most specific line wins, wherever it stands in the table:
 *
 *   stage + relationship  >  stage + '*'  >  '*' + relationship  >  '*' + '*'
 *
 * so `['pupa', '*', 'red']` covers every pupa record and
 * `['pupa', 'reared from galls on', 'green']` overrides it for that one case.
 * The same stage and relationship twice is a mistake; the console says so.
 */
export const EVIDENCE_RULES = [
  // stage    relationship                                  colour
  ['egg',     '*',                                          'green'],
  ['nidus',   '*',                                          'green'],

  ['larva',   'reared from',                                'green'],
  ['larva',   'reared from galls on',                       'green'],
  ['larva',   'feeding observed in the wild on',            'green'],
  ['larva',   'feeding observed in experimental setup on',  'orange'],
  ['larva',   'collected from',                             'orange'],
  ['larva',   'undefined relationship with',                'orange'],

  ['pupa',    '*',                                          'red'],
  ['pupa',    'reared from galls on',                       'green'],

  ['adult',   'reared from',                                'green'],
  ['adult',   'reared from galls on',                       'green'],
  ['adult',   'feeding observed in the wild on',            'green'],
  ['adult',   'feeding observed in experimental setup on',  'orange'],
  ['adult',   'collected from',                             'red'],
  ['adult',   'undefined relationship with',                'red'],

  ['*',       '[legacy] oviposited on',                     'green'],
  ['*',       '[legacy] feeds on',                          'orange'],
  ['*',       '[legacy] is visitor of',                     'red'],

  // Everything no line above covers.
  ['*',       '*',                                          'red']
]

/**
 * Spellings of one stage in TaxonWorks that the table treats as the same.
 * Left: the term as recorded. Right: the stage used in the table above.
 */
export const STAGE_ALIASES = {
  larvae: 'larva'
}

/**
 * The stage a record counts as when its Subject carries no anatomical part
 * at all -- most OTU and specimen records and every [legacy] one. Set to '*'
 * to let only the '*' lines of the table decide those records.
 */
export const NO_STAGE_COUNTS_AS = 'adult'

/**
 * What each colour says, in the per-row breakdown and as the heading of each
 * colour in the legend. The legend lists the exact cases underneath on its
 * own, so these stay general and do not need touching when the table changes.
 */
export const EVIDENCE_LABELS = {
  green: 'strong evidence',
  orange: 'moderate evidence',
  red: 'weak or vague evidence'
}
