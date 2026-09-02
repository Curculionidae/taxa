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
    background: 'bg-map-asserted',
    // hatched swatch, mirrors the polygon rendering
    style:
      'background-image: repeating-linear-gradient(45deg, var(--tp-map-asserted) 0 1.5px, transparent 1.5px 4px);'
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
