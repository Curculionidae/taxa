// Pure grouping/collapsing logic for the merged specimen/field-occurrence
// list. No network calls, no Vue — testable with a plain Node script.
// See docs/superpowers/specs/2026-08-26-merge-specimen-occurrence-panels-design.md

const EVENT_FIELDS = [
  'country',
  'stateProvince',
  'county',
  'verbatimLocality',
  'eventDate',
  'recordedBy'
]

// Grouping key also splits by institutionCode (fix #5: same-event specimens
// held at different institutions must not collapse into one row) and by
// year/month/day (the display layer's getDate() falls back to these when
// eventDate is blank — common for older, partially-dated museum lots — so
// two records with blank eventDate but different year/month/day must not
// collapse into a group whose date label can only show one of them). All
// kept separate from EVENT_FIELDS because hasNoEventFields() below must
// only look at genuine collecting-event data, not institution.
const KEY_FIELDS = [...EVENT_FIELDS, 'institutionCode', 'year', 'month', 'day']

export function buildGroupKey(record) {
  return JSON.stringify(
    [record.dwc_occurrence_object_type, record.typeStatus || ''].concat(
      KEY_FIELDS.map((f) => record[f] || '')
    )
  )
}

// A record with no collecting-event data at all (old, unlocalized museum
// specimens) gets its own singleton group rather than key-matching other
// blank records. Must check only EVENT_FIELDS, not institutionCode: an
// unlocalized specimen almost always has institutionCode populated, so
// including it here would collapse unrelated unlocalized specimens at the
// same institution into one row.
function hasNoEventFields(record) {
  return EVENT_FIELDS.every((f) => !record[f])
}

function hasMedia(records) {
  return records.some((r) => r.associatedMedia && r.associatedMedia.length)
}

function sortGroups(groups) {
  return [...groups].sort((a, b) => {
    const aMedia = hasMedia(a.records)
    const bMedia = hasMedia(b.records)
    if (aMedia && !bMedia) return -1
    if (!aMedia && bMedia) return 1
    return 0
  })
}

// individualCount summed per sex ('female', 'male', ...), lowercased so it
// reads as prose ("2 female, 1 male") rather than shouting DWC vocabulary
// ("2 Female, 1 Male"). Records with no sex recorded are not represented
// here — groupCountLabel() folds their count into a trailing plain-noun
// term instead, since "1 unsexed" isn't a term TaxonWorks or DWC uses.
function sexCounts(records) {
  const counts = new Map()
  for (const r of records) {
    if (!r.sex) continue
    const key = r.sex.toLowerCase()
    const n = Number(r.individualCount) || 1
    counts.set(key, (counts.get(key) || 0) + n)
  }
  return counts
}

function groupBucket(records) {
  const singles = []
  const byKey = new Map()

  records.forEach((record) => {
    if (hasNoEventFields(record)) {
      singles.push([record])
      return
    }
    const key = buildGroupKey(record)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(record)
  })

  return sortGroups(
    [...Array.from(byKey.values()), ...singles].map((records) => ({ records }))
  )
}

// Splits records into a type bucket (CollectionObject with a typeStatus) and
// everything else, groups each bucket by buildGroupKey, and returns the
// final render order: all type groups first, then all other groups, each
// bucket sorted media-present-first.
export function groupRecords(records) {
  const typeRecords = records.filter(
    (r) => r.dwc_occurrence_object_type === 'CollectionObject' && r.typeStatus
  )
  const otherRecords = records.filter(
    (r) => !(r.dwc_occurrence_object_type === 'CollectionObject' && r.typeStatus)
  )

  return [...groupBucket(typeRecords), ...groupBucket(otherRecords)].map(
    (group) => ({
      records: group.records,
      isGroup: group.records.length > 1,
      totalCount: group.records.reduce((sum, r) => sum + (Number(r.individualCount) || 1), 0),
      sexCounts: sexCounts(group.records)
    })
  )
}

// Aggregated "count + sex/noun" text for a collapsed group row, replacing
// the single-record getCountAndSex() output. Breaks down by sex when any
// member has one recorded — "2 female, 1 male", or "3 female" when every
// sexed member agrees — falling back to a plain noun only for members with
// no sex at all ("2 female, 1 specimen" for a group that's part sexed, part
// not; plain "3 specimens" when none are). typeStatus is not folded in here
// — it's a full citation sentence in real data (e.g. "syntype of Pnigodes
// setosus LeConte, 1876"), not clean DWC vocabulary, and ListRecords.vue
// already renders it verbatim above the label. Only meaningful for isGroup
// groups (records.length > 1).
export function groupCountLabel(group) {
  const first = group.records[0]
  const nounBase = first.dwc_occurrence_object_type === 'FieldOccurrence' ? 'occurrence' : 'specimen'
  const unsexedCount = group.totalCount - [...group.sexCounts.values()].reduce((a, b) => a + b, 0)

  const parts = [...group.sexCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([sex, count]) => `${count} ${sex}`)

  if (unsexedCount > 0) {
    parts.push(`${unsexedCount} ${nounBase}${unsexedCount > 1 ? 's' : ''}`)
  }

  return parts.join(', ') || `${group.totalCount} ${nounBase}s`
}
