export const LEGEND = {
  Aggregate: {
    label: 'Aggregate (Asserted distribution & Georeference)',
    background: 'bg-map-aggregate'
  },
  AssertedAbsent: {
    label: 'Asserted absent',
    background: 'bg-map-asserted-absent'
  },
  AssertedDistribution: {
    label: 'Asserted distribution',
    background: 'bg-map-asserted'
  },
  Adventive: {
    label: 'Adventive (introduced)',
    background: '',
    // purple hatch, same direction as the polygon SVG pattern (rotate(45))
    style:
      'background: repeating-linear-gradient(-45deg, var(--pp-map-adventive) 0 2px, color-mix(in srgb, var(--pp-map-adventive) 20%, transparent) 2px 5px);'
  },
  Georeference: {
    label: 'Georeference',
    background: 'bg-map-georeference'
  },
  CollectionObject: {
    label: 'Collection object',
    background: 'bg-map-collection-object'
  },
  TypeMaterial: {
    label: 'Primary type',
    background: 'bg-map-type-material'
  },
  FieldOccurrence: {
    label: 'Field occurrence',
    background: 'bg-map-field-occurrence'
  }
}
