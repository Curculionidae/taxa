export function removeDuplicateShapes(data) {
  const featureMap = new Map()
  const shapeTypes = []

  data.forEach((feature) => {
    const shapeId = feature.properties.shape.id
    const shapeType = feature.properties.shape.type
    const key = `${shapeId}:${shapeType}`

    if (!shapeTypes.includes(feature.properties.base.type)) {
      shapeTypes.push(feature.properties.base.type)
    }

    if (featureMap.has(key)) {
      const existing = featureMap.get(key)
      existing.properties.base.push(feature.properties.base)
      existing.properties.target.push(feature.properties.target)
    } else {
      featureMap.set(key, {
        ...feature,
        properties: {
          ...feature.properties,
          base: [feature.properties.base],
          target: [feature.properties.target]
        }
      })
    }
  })

  shapeTypes.sort()

  return {
    shapeTypes,
    features: [...featureMap.values()]
  }
}
