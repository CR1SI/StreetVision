import { PALETTE, TIERS } from './colors'
import { ensureIcons } from './mapIcons'
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

/** Substations at the two ends of every line project (deduplicated), for the substation icons. */
export function substationsOf(fc) {
  const seen = new Map()
  const add = (coord, name, p) => {
    if (!coord) return
    const k = `${p.utility_id}|${coord[0].toFixed(4)}|${coord[1].toFixed(4)}`
    const s = seen.get(k)
    if (s) {
      s.properties.projects += 1
      if (!s.properties.name && name) s.properties.name = name
      return
    }
    seen.set(k, {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coord },
      properties: { name: name || '', utility_id: p.utility_id, projects: 1, location_confidence: p.location_confidence },
    })
  }
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
    parts.forEach((line, i) => {
      // Names are known for the first segment's ends; later segments of a multi-part project stay unnamed.
      add(line[0], i === 0 ? f.properties.endpoint_a : '', f.properties)
      add(line[line.length - 1], i === 0 ? f.properties.endpoint_b : '', f.properties)
    })
  }
  return { type: 'FeatureCollection', features: [...seen.values()] }
}

// Icon ids are built from the feature's type and its utility color; mapIcons draws them on demand.
const typeIcon = (colors) => ['concat', 'sv:', ['coalesce', ['get', 'project_type'], 'other'], ':', utilityExpr(colors)]
const subIcon = (colors) => ['concat', 'sv:sub:', utilityExpr(colors)]
const iconSize = (small, large) => ['interpolate', ['linear'], ['zoom'], 6, small, 12, large]

/** Projects: lines colored by utility, substations at the line ends, and a badge per project
 *  showing what kind of work it is (line rebuild, new line, substation work, area package). */
export function drawProjects(map, fc, colors, { labels = true, before } = {}) {
  // Connectors must sit on top of projects whichever loads first, so clicks on them win.
  before = before ?? (map.getLayer('connectors-halo') ? 'connectors-halo' : undefined)
  ensureIcons(map)
  const data = keyed(fc)
  setSource(map, 'projects', data, { promoteId: '_key' })
  setSource(map, 'substations', substationsOf(data))

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
    // Selection / hover ring under point-project badges (lines show selection with their glow).
    map.addLayer(
      {
        id: 'project-points',
        type: 'circle',
        source: 'projects',
        filter: isPoint,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 12, 12, 17],
          'circle-color': utilityExpr(colors),
          'circle-opacity': ['case', selected, 0.35, hover, 0.2, 0],
          'circle-stroke-width': ['case', selected, 2.5, ['boolean', ['get', 'is_override'], false], 1.5, 0],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-opacity': ['case', selected, 1, 0.8],
        },
      },
      before,
    )
    // Substations: where lines start and end.
    map.addLayer(
      {
        id: 'substations',
        type: 'symbol',
        source: 'substations',
        layout: {
          'icon-image': subIcon(colors),
          'icon-size': iconSize(0.7, 1),
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          ...(labels && hasGlyphs(map)
            ? {
                'text-field': ['get', 'name'],
                'text-size': 10.5,
                'text-font': ['Open Sans Semibold', 'Noto Sans Regular'],
                'text-offset': [0, 1.1],
                'text-anchor': 'top',
                'text-optional': true,
              }
            : {}),
        },
        paint: {
          'icon-opacity': confidenceOpacity,
          'text-color': '#AEB6C8',
          'text-halo-color': PALETTE.map,
          'text-halo-width': 1.4,
          'text-opacity': ['step', ['zoom'], 0, 9, 1],
        },
      },
      before,
    )
    // One badge per project: at the middle of a line, or on a point project.
    const badgeLayout = {
      'icon-image': typeIcon(colors),
      'icon-size': iconSize(0.72, 1),
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport',
    }
    const badgePaint = { 'icon-opacity': ['case', selected, 1, hover, 1, confidenceOpacity] }
    map.addLayer(
      { id: 'project-icons-line', type: 'symbol', source: 'projects', filter: isLine,
        layout: { ...badgeLayout, 'symbol-placement': 'line-center' }, paint: badgePaint },
      before,
    )
    map.addLayer(
      { id: 'project-icons-point', type: 'symbol', source: 'projects', filter: isPoint, layout: badgeLayout, paint: badgePaint },
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
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-max-width': 14,
          'symbol-placement': 'point',
        },
        paint: { 'text-color': '#D5DAE6', 'text-halo-color': PALETTE.map, 'text-halo-width': 1.5 },
      })
    }
  } else {
    map.setPaintProperty('project-lines-glow', 'line-color', utilityExpr(colors))
    map.setPaintProperty('project-lines', 'line-color', utilityExpr(colors))
    map.setPaintProperty('project-points', 'circle-color', utilityExpr(colors))
    map.setLayoutProperty('substations', 'icon-image', subIcon(colors))
    map.setLayoutProperty('project-icons-line', 'icon-image', typeIcon(colors))
    map.setLayoutProperty('project-icons-point', 'icon-image', typeIcon(colors))
  }
}

/** 3D mode: badges float above the models, and substation squares give way to substation yards. */
export function setModelMode(map, on) {
  if (map.getLayer('substations')) map.setLayoutProperty('substations', 'visibility', on ? 'none' : 'visible')
  const offset = on
    ? ['interpolate', ['linear'], ['zoom'], 6, ['literal', [0, -44]], 9, ['literal', [0, -57]], 12, ['literal', [0, -84]], 15, ['literal', [0, -135]]]
    : ['literal', [0, 0]]
  for (const id of ['project-icons-line', 'project-icons-point']) if (map.getLayer(id)) map.setLayoutProperty(id, 'icon-offset', offset)
}

/** Layers a click or hover can hit, top first. */
export const PROJECT_HIT_LAYERS = ['project-icons-point', 'project-icons-line', 'substations', 'project-lines', 'project-points']

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
