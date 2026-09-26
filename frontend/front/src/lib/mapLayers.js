import { PALETTE, TIERS } from './colors'
import { hexagon } from './geo'
import { hasGlyphs, setSource } from '../hooks/useMapLibre'

// Every project/overlap layer on every map is built here, so the home map, the overlap
// inset, the dataset page and the address check draw data identically.

export const projectKey = (p) => `${p.utility_id}|${p.project_id}`

const utilityExpr = (colors) => {
  const pairs = Object.entries(colors).flat()
  return pairs.length ? ['match', ['get', 'utility_id'], ...pairs, PALETTE.dim] : PALETTE.dim
}
const confidenceOpacity = ['match', ['get', 'location_confidence'], 'high', 1, 'medium', 0.9, 'low', 0.6, 0.35]
const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const isPoint = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
const selected = ['boolean', ['feature-state', 'selected'], false]
const hover = ['boolean', ['feature-state', 'hover'], false]

/** Give every feature a stable string key (used for feature-state selection). */
export function keyed(fc) {
  return { ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, _key: projectKey(f.properties) } })) }
}

/** Projects: lines colored by utility, point projects as circles, optional 3D kV columns. */
export function drawProjects(map, fc, colors, { columns = false, labels = true, before } = {}) {
  // Connectors must sit on top of projects whichever loads first, so clicks on them win.
  before = before ?? (map.getLayer('connectors-halo') ? 'connectors-halo' : undefined)
  const data = keyed(fc)
  setSource(map, 'projects', data, { promoteId: '_key' })

  // 3D "kV columns": a hexagon extruded at each project center, height scaled by voltage.
  setSource(map, 'project-columns', {
    type: 'FeatureCollection',
    features: data.features.map((f) => ({
      type: 'Feature',
      properties: { ...f.properties, height: (f.properties.kv || 115) * 110 },
      geometry: { type: 'Polygon', coordinates: [hexagon(f.properties.center, 2600)] },
    })),
  })

  if (!map.getLayer('project-lines-glow')) {
    map.addLayer(
      {
        id: 'project-lines-glow',
        type: 'line',
        source: 'projects',
        filter: isLine,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': utilityExpr(colors),
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', selected, 12, 6], 12, ['case', selected, 22, 14]],
          'line-opacity': ['case', selected, 0.55, hover, 0.3, 0.12],
          'line-blur': 4,
        },
      },
      before,
    )
    map.addLayer(
      {
        id: 'project-lines',
        type: 'line',
        source: 'projects',
        filter: isLine,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': utilityExpr(colors),
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', selected, 4, 2.2], 12, ['case', selected, 7, 4]],
          'line-opacity': confidenceOpacity,
        },
      },
      before,
    )
    // Hand-placed ("override") locations get a dashed white overlay (dasharray can't vary per feature).
    map.addLayer(
      {
        id: 'project-lines-override',
        type: 'line',
        source: 'projects',
        filter: ['all', isLine, ['boolean', ['get', 'is_override'], false]],
        paint: { 'line-color': '#FFFFFF', 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] },
      },
      before,
    )
    map.addLayer(
      {
        id: 'project-points',
        type: 'circle',
        source: 'projects',
        filter: isPoint,
        paint: {
          'circle-color': utilityExpr(colors),
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, ['case', selected, 7, 4], 12, ['case', selected, 11, 8]],
          'circle-opacity': confidenceOpacity,
          'circle-stroke-width': ['case', selected, 3, ['boolean', ['get', 'is_override'], false], 2, 1],
          'circle-stroke-color': ['case', selected, '#FFFFFF', ['boolean', ['get', 'is_override'], false], '#FFFFFF', PALETTE.bg],
        },
      },
      before,
    )
    map.addLayer(
      {
        id: 'project-columns',
        type: 'fill-extrusion',
        source: 'project-columns',
        layout: { visibility: columns ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': utilityExpr(colors),
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.82,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      before,
    )
    if (labels && hasGlyphs(map)) {
      map.addLayer({
        id: 'project-labels',
        type: 'symbol',
        source: 'projects',
        minzoom: 9.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-font': ['Open Sans Semibold', 'Noto Sans Regular'],
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 14,
          'symbol-placement': 'point',
        },
        paint: { 'text-color': '#D5DAE6', 'text-halo-color': PALETTE.map, 'text-halo-width': 1.5 },
      })
    }
  } else {
    for (const id of ['project-lines-glow', 'project-points', 'project-columns']) {
      const prop = id === 'project-columns' ? 'fill-extrusion-color' : id === 'project-points' ? 'circle-color' : 'line-color'
      map.setPaintProperty(id, prop, utilityExpr(colors))
    }
    map.setPaintProperty('project-lines', 'line-color', utilityExpr(colors))
  }
}

export function setColumns(map, on) {
  if (map.getLayer('project-columns')) map.setLayoutProperty('project-columns', 'visibility', on ? 'visible' : 'none')
}

const tierExpr = ['match', ['get', 'tier'], ...TIERS.flatMap((t) => [t.key, t.color]), '#C4B5FD']

/** Overlap connectors: dashed line between the two project centers, colored by tier,
 *  thicker for higher ranks. */
export function drawConnectors(map, fc) {
  setSource(map, 'connectors', fc, { promoteId: 'key' })
  if (map.getLayer('connectors')) return
  map.addLayer({
    id: 'connectors-halo',
    type: 'line',
    source: 'connectors',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': tierExpr,
      'line-width': ['case', selected, 16, 0],
      'line-opacity': 0.25,
      'line-blur': 6,
    },
  })
  map.addLayer({
    id: 'connectors',
    type: 'line',
    source: 'connectors',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': tierExpr,
      'line-width': [
        'case',
        selected,
        5,
        hover,
        4,
        ['interpolate', ['linear'], ['get', 'rank'], 1, 3.5, 10, 2.2, 40, 1.2],
      ],
      'line-opacity': ['case', selected, 1, hover, 1, 0.7],
      'line-dasharray': [2, 1.4],
    },
  })
  // Wide invisible line on top so thin connectors are easy to click.
  map.addLayer({
    id: 'connectors-hit',
    type: 'line',
    source: 'connectors',
    paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 },
  })
}

/** Toggle a boolean feature-state on one feature, clearing the previous one. Returns the new key. */
export function selectFeature(map, source, prevKey, nextKey, state = 'selected') {
  if (!map.getSource(source)) return nextKey
  if (prevKey !== null && prevKey !== undefined) map.setFeatureState({ source, id: prevKey }, { [state]: false })
  if (nextKey !== null && nextKey !== undefined) map.setFeatureState({ source, id: nextKey }, { [state]: true })
  return nextKey
}
