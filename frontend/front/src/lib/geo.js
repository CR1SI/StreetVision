// Small geometry helpers so we don't need turf.js for a handful of operations.

export const midpoint = ([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/** Stable key for an overlap. Live (radius > 25 mi) results have no overlap_id, so key them by the pair,
 *  never by rank: rank changes whenever the filters do. */
export const overlapKey = (o) => {
  const a = o.project_a ?? o.a
  const b = o.project_b ?? o.b
  return o.overlap_id ?? `live:${a.utility_id}|${a.project_id}~${b.utility_id}|${b.project_id}`
}

/** Walk any GeoJSON geometry and yield [lon, lat] pairs. */
function* coords(geom) {
  if (!geom) return
  const t = geom.type
  const c = geom.coordinates
  if (t === 'Point') yield c
  else if (t === 'MultiPoint' || t === 'LineString') yield* c
  else if (t === 'MultiLineString' || t === 'Polygon') for (const l of c) yield* l
  else if (t === 'MultiPolygon') for (const p of c) for (const l of p) yield* l
  else if (t === 'GeometryCollection') for (const g of geom.geometries) yield* coords(g)
}

/** Bounds [[w, s], [e, n]] of a list of [lon, lat] points and/or GeoJSON features/geometries. */
export function bounds(items) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const add = ([x, y]) => {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
  }
  for (const it of items) {
    if (!it) continue
    if (Array.isArray(it) && typeof it[0] === 'number') add(it)
    else for (const c of coords(it.geometry ?? it)) add(c)
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null
}

/** A circle polygon of radius (miles) around [lon, lat], for the "search radius" ring. */
export function circle([lon, lat], radiusMi, steps = 72) {
  const R = 3958.8 // earth radius in miles
  const d = radiusMi / R
  const la = (lat * Math.PI) / 180
  const lo = (lon * Math.PI) / 180
  const ring = []
  for (let i = 0; i <= steps; i++) {
    const brg = (2 * Math.PI * i) / steps
    const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(brg))
    const lon2 = lo + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2))
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** Hexagon footprint (meters) around a point: the base of a 3D "kV column". */
export function hexagon([lon, lat], radiusM) {
  const dLat = radiusM / 111320
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180))
  const ring = []
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return ring
}

/** Overlap list -> GeoJSON connectors (one line between the two project centers per pair). */
export function connectorsToGeoJSON(list) {
  return {
    type: 'FeatureCollection',
    features: list.map((o, i) => ({
      type: 'Feature',
      id: i,
      properties: {
        key: overlapKey(o),
        overlap_id: o.overlap_id ?? null,
        rank: o.rank,
        tier: o.proximity_tier ?? 'live',
        score: o.score,
      },
      geometry: { type: 'LineString', coordinates: o.connector },
    })),
  }
}
