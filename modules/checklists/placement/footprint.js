// A point inside a specimen's georeference shape (DwC footprintWKT).
//
// Purpose: a georeference drawn as a shape in TaxonWorks (shape tool) gives
// the DwC record a footprintWKT but no decimalLatitude/decimalLongitude, so
// the engine saw no coordinates (CO 2707818 "Sanju"). The engine tests this
// point against the outlines exactly like coordinates, after a step saying it
// comes from the shape.
//
// Input:  footprintWKT text: POLYGON or MULTIPOLYGON, with or without Z.
// Output: { lat, lng } rounded to 4 decimals (about 11 m), inside the shape's
//         largest polygon: its centre when that lies inside, else the middle
//         of the widest stretch of a horizontal cut through that centre; null
//         for anything else (a POINT, broken text, a shape across the 180th
//         meridian).
// Purity: no network, no file system; used by the build and the curator page.
import { contains, prepared, polygonsOf } from './geometry.js'

/**
 * WKT POLYGON / MULTIPOLYGON (Z ignored) as a GeoJSON geometry, else null.
 * @param {string|null|undefined} wkt
 * @returns {{ type: 'Polygon'|'MultiPolygon', coordinates: any[] }|null}
 */
export function parseWkt(wkt) {
  const match = /^\s*(MULTIPOLYGON|POLYGON)\s*(?:Z|M|ZM)?\s*(\(.*\))\s*$/is.exec(String(wkt ?? ''))
  if (!match) return null
  try {
    // "((x y z, x y z), (…))" to nested arrays of [x, y].
    const json = match[2]
      .replace(/(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)(?:\s+-?[\d.eE+-]+)*/g, '[$1,$2]')
      .replace(/\(/g, '[').replace(/\)/g, ']')
    const coordinates = JSON.parse(json)
    return { type: match[1].toUpperCase() === 'POLYGON' ? 'Polygon' : 'MultiPolygon', coordinates }
  } catch {
    return null
  }
}

/**
 * A point inside the footprint's largest polygon (see the header).
 * @param {string|null|undefined} wkt
 * @returns {{ lat: number, lng: number }|null}
 */
export function footprintPoint(wkt) {
  const geometry = parseWkt(wkt)
  const polygons = geometry ? polygonsOf(geometry) : []
  const largest = polygons
    .filter((polygon) => polygon[0]?.length >= 3)
    .sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0])))[0]
  if (!largest) return null
  // A ring crossing the 180th meridian would give a point on the far side of
  // the globe: no point then.
  const longitudes = largest[0].map(([lng]) => lng)
  if (Math.max(...longitudes) - Math.min(...longitudes) > 180) return null
  const shape = prepared([largest])
  const centre = centroid(largest[0])
  const inside = contains(shape, centre) ? centre : cutMiddle(largest, centre[1])
  if (!inside) return null
  const round = (n) => Math.round(n * 1e4) / 1e4
  const point = { lat: round(inside[1]), lng: round(inside[0]) }
  return contains(shape, [point.lng, point.lat]) ? point : { lat: inside[1], lng: inside[0] }
}

// Signed area of a ring (shoelace), in square degrees.
function ringArea(ring) {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return sum / 2
}

// Area centroid of a ring; its first vertex for a ring without area.
function centroid(ring) {
  const area = ringArea(ring)
  if (!area) return ring[0]
  let x = 0, y = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    x += (ring[i][0] + ring[i + 1][0]) * cross
    y += (ring[i][1] + ring[i + 1][1]) * cross
  }
  return [x / (6 * area), y / (6 * area)]
}

// The middle of the widest stretch inside the polygon on the line lat = y.
function cutMiddle(polygon, y) {
  const xs = []
  for (const ring of polygon) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[i + 1]
      if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
    }
  }
  xs.sort((a, b) => a - b)
  let best = null
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]]
  }
  return best ? [(best[0] + best[1]) / 2, y] : null
}
