import maplibregl from 'maplibre-gl'
import { PALETTE } from './colors'
import { substationsOf } from './mapLayers'

// 3D models of each project, drawn with three.js inside the MapLibre map (a "custom layer" that
// shares the map's WebGL canvas, camera and depth buffer):
//   line rebuild / new line  -> lattice towers along the route, wires between them
//   substation (line end)    -> substation yard: fenced pad, transformers, steel gantry, control house
//   substation work          -> a large power transformer (tank, cooling fins, bushings)
//   area package             -> a larger substation complex
// Real towers are ~40 m tall, invisible at regional zoom, so models are drawn at a constant
// on-screen size (like icons) while standing at their real positions.
// three.js is loaded only when 3D is switched on, so the flat map stays light.

export const MODELS_LAYER = 'models-3d'
const LAYER = MODELS_LAYER

// Model height on screen, in pixels, by zoom level.
const SIZE_STOPS = [[6, 16], [9, 32], [12, 64], [15, 110]]
export function modelPixels(zoom) {
  const s = SIZE_STOPS
  if (zoom <= s[0][0]) return s[0][1]
  for (let i = 1; i < s.length; i++) {
    if (zoom <= s[i][0]) {
      const [z0, p0] = s[i - 1]
      const [z1, p1] = s[i]
      return p0 + ((zoom - z0) / (z1 - z0)) * (p1 - p0)
    }
  }
  return s[s.length - 1][1]
}

const STEEL = '#AEB6C8'
const TANK = '#8C96AD'
const PORCELAIN = '#EEF1F6'

/** Build the models layer. Call once; later calls to update() replace the data. */
export async function createModelsLayer(map) {
  const THREE = await import('three')

  const origin = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter().toArray(), 0)
  const unit = origin.meterInMercatorCoordinateUnits() // mercator units per meter at the origin
  const toLocal = ([lon, lat]) => {
    const m = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0)
    return new THREE.Vector3((m.x - origin.x) / unit, 0, (m.y - origin.y) / unit) // x east, z south, y up (meters)
  }

  // ---------------------------------------------------------------- shared geometry & materials
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
  const geo = {
    armLong: box(0.56, 0.025, 0.03),
    armShort: box(0.42, 0.022, 0.028),
    insulator: new THREE.CylinderGeometry(0.011, 0.011, 0.075, 6),
    band: box(0.34, 0.035, 0.34),
    beacon: new THREE.SphereGeometry(0.035, 12, 8),
    body: new THREE.CylinderGeometry(0.03, 0.15, 1, 4, 1, true),
    pad: box(1, 0.02, 1),
    trafo: box(0.26, 0.2, 0.18),
    fin: box(0.018, 0.15, 0.16),
    bushing: new THREE.CylinderGeometry(0.012, 0.018, 0.12, 8),
    post: box(0.03, 0.36, 0.03),
    beam: box(0.76, 0.03, 0.03),
    house: box(0.2, 0.12, 0.14),
    bigTank: box(0.5, 0.36, 0.34),
    bigFin: box(0.02, 0.3, 0.3),
    bigBushing: new THREE.CylinderGeometry(0.02, 0.03, 0.28, 10),
    shed: new THREE.CylinderGeometry(0.038, 0.038, 0.012, 10),
    conservator: new THREE.CylinderGeometry(0.06, 0.06, 0.34, 14),
    plinth: box(0.62, 0.05, 0.46),
    ring: new THREE.RingGeometry(0.42, 0.5, 40),
  }
  geo.body.rotateY(Math.PI / 4).translate(0, 0.5, 0)
  geo.ring.rotateX(-Math.PI / 2)
  geo.conservator.rotateZ(Math.PI / 2)
  geo.fence = new THREE.EdgesGeometry(box(1, 0.12, 1)).translate(0, 0.06, 0)
  geo.lattice = latticeGeometry(THREE)

  const cache = new Map()
  const mat = (kind, color, extra = {}) => {
    const key = `${kind}|${color}|${JSON.stringify(extra)}`
    if (!cache.has(key)) {
      const M = kind === 'line' ? THREE.LineBasicMaterial : kind === 'basic' ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial
      cache.set(key, new M({ color, ...extra }))
    }
    return cache.get(key)
  }
  const mesh = (g, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m)
    o.position.set(x, y, z)
    return o
  }

  // ---------------------------------------------------------------- models (unit height ~1)
  function tower(color, type) {
    const g = new THREE.Group()
    g.add(new THREE.LineSegments(geo.lattice, mat('line', color)))
    g.add(mesh(geo.body, mat('lambert', color, { transparent: true, opacity: 0.28, side: THREE.DoubleSide })))
    g.add(mesh(geo.armLong, mat('lambert', STEEL), 0, 0.82, 0))
    g.add(mesh(geo.armShort, mat('lambert', STEEL), 0, 0.66, 0))
    for (const [x, y] of [[-0.26, 0.78], [0.26, 0.78], [-0.19, 0.62], [0.19, 0.62]]) {
      g.add(mesh(geo.insulator, mat('lambert', PORCELAIN), x, y, 0))
    }
    if (type === 'line_rebuild') g.add(mesh(geo.band, mat('lambert', PALETTE.orange), 0, 0.3, 0)) // work in progress
    if (type === 'new_line') g.add(mesh(geo.beacon, mat('basic', PALETTE.pink), 0, 1.03, 0)) // brand-new line
    return g
  }

  function smallTransformer(g, x, z) {
    g.add(mesh(geo.trafo, mat('lambert', TANK), x, 0.12, z))
    g.add(mesh(geo.fin, mat('lambert', TANK), x - 0.15, 0.1, z))
    g.add(mesh(geo.fin, mat('lambert', TANK), x + 0.15, 0.1, z))
    for (const dx of [-0.08, 0, 0.08]) g.add(mesh(geo.bushing, mat('lambert', PORCELAIN), x + dx, 0.28, z))
  }

  function yard(color, transformers = 2) {
    const g = new THREE.Group()
    g.add(mesh(geo.pad, mat('lambert', '#2A3350')))
    g.add(new THREE.LineSegments(geo.fence, mat('line', color)))
    const xs = transformers === 3 ? [-0.28, 0, 0.28] : [-0.2, 0.2]
    for (const x of xs) smallTransformer(g, x, 0.12)
    for (const x of [-0.35, 0.35]) g.add(mesh(geo.post, mat('lambert', color), x, 0.18, -0.3))
    g.add(mesh(geo.beam, mat('lambert', color), 0, 0.35, -0.3))
    g.add(mesh(geo.house, mat('lambert', '#C9CFDC'), transformers === 3 ? -0.3 : 0.3, 0.06, -0.08))
    return g
  }

  function bigTransformer(color) {
    const g = new THREE.Group()
    g.add(mesh(geo.ring, mat('basic', color, { transparent: true, opacity: 0.55, side: THREE.DoubleSide }), 0, 0.005, 0))
    g.add(mesh(geo.plinth, mat('lambert', color), 0, 0.025, 0))
    g.add(mesh(geo.bigTank, mat('lambert', TANK), 0, 0.23, 0))
    for (const s of [-1, 1]) {
      for (const dz of [-0.1, 0, 0.1]) g.add(mesh(geo.bigFin, mat('lambert', TANK), s * 0.27, 0.22, dz))
    }
    g.add(mesh(geo.conservator, mat('lambert', TANK), 0, 0.5, 0.12))
    for (const dx of [-0.15, 0, 0.15]) {
      g.add(mesh(geo.bigBushing, mat('lambert', PORCELAIN), dx, 0.55, -0.06))
      for (const dy of [0.48, 0.54, 0.6]) g.add(mesh(geo.shed, mat('lambert', PORCELAIN), dx, dy, -0.06))
    }
    return g
  }

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.8)
  sun.position.set(0.6, 1, 0.4)
  scene.add(sun)
  const content = new THREE.Group()
  scene.add(content)
  const camera = new THREE.Camera()

  let items = [] // { obj, pos: Vector3, factor }
  let wires = [] // { line, points: [{ pos, height, perp }] }
  let lastSize = 0

  function clear() {
    for (const w of wires) w.line.geometry.dispose()
    content.clear()
    items = []
    wires = []
    lastSize = 0
  }

  function place(obj, pos, factor, rotation = 0) {
    obj.position.copy(pos)
    obj.rotation.y = rotation
    content.add(obj)
    items.push({ obj, pos, factor })
  }

  function update(fc, colors) {
    clear()
    const colorOf = (u) => colors?.[u] ?? PALETTE.dim
    const yardAt = new Map()

    // Substation yards at every line end.
    for (const s of substationsOf(fc).features) {
      const pos = toLocal(s.geometry.coordinates)
      place(yard(colorOf(s.properties.utility_id)), pos, 0.75)
      yardAt.set(s.geometry.coordinates.map((c) => c.toFixed(4)).join(','), pos)
    }

    for (const f of fc.features) {
      const p = f.properties
      const g = f.geometry
      if (!g) continue
      const color = colorOf(p.utility_id)
      const type = p.project_type ?? 'other'
      const center = Array.isArray(p.center) ? p.center : JSON.parse(p.center)

      if (type === 'substation') {
        place(bigTransformer(color), toLocal(center), 1.0)
        continue
      }
      if (type === 'area_package') {
        place(yard(color, 3), toLocal(center), 1.3)
        continue
      }
      const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
      for (const line of parts) {
        const a = toLocal(line[0])
        const b = toLocal(line[line.length - 1])
        const dir = b.clone().sub(a)
        const len = dir.length()
        if (len < 1) continue
        dir.normalize()
        const perp = new THREE.Vector3(-dir.z, 0, dir.x) // horizontal, at right angles to the line
        const rotation = Math.atan2(-perp.z, perp.x)
        const fractions = len < 6000 ? [0.5] : len < 20000 ? [0.33, 0.67] : [0.25, 0.5, 0.75]
        const route = [{ pos: a, height: 0.3 * 0.75 }]
        for (const t of fractions) {
          const pos = a.clone().addScaledVector(dir, len * t)
          place(tower(color, type), pos, 1, rotation)
          route.push({ pos, height: 0.8 })
        }
        route.push({ pos: b, height: 0.3 * 0.75 })
        // Two conductors, one per crossarm tip, strung between yard gantries and towers.
        const geom = new THREE.BufferGeometry()
        geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array((route.length - 1) * 2 * 2 * 3), 3))
        const wire = new THREE.LineSegments(geom, mat('line', color, { transparent: true, opacity: 0.85 }))
        wire.frustumCulled = false
        content.add(wire)
        wires.push({ line: wire, points: route, perp })
      }
      if (!parts.length) place(yard(color), toLocal(center), 0.9) // point project of another type
    }
  }

  function resize(size) {
    if (Math.abs(size - lastSize) < 0.01 * size) return
    lastSize = size
    for (const it of items) it.obj.scale.setScalar(size * it.factor)
    for (const w of wires) {
      const arr = w.line.geometry.attributes.position.array
      let i = 0
      for (let k = 0; k < w.points.length - 1; k++) {
        const p0 = w.points[k]
        const p1 = w.points[k + 1]
        for (const side of [-1, 1]) {
          for (const [pt, tip] of [[p0, k === 0 ? 0.25 : 0.26], [p1, k === w.points.length - 2 ? 0.25 : 0.26]]) {
            arr[i++] = pt.pos.x + w.perp.x * side * tip * size
            arr[i++] = pt.height * size
            arr[i++] = pt.pos.z + w.perp.z * side * tip * size
          }
        }
      }
      w.line.geometry.attributes.position.needsUpdate = true
    }
  }

  let renderer
  const layer = {
    id: LAYER,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
    },
    render(gl, args) {
      // MapLibre 4 passes the matrix itself; MapLibre 5 passes an options object.
      const matrix = args?.defaultProjectionData?.mainMatrix ?? args
      const lat = map.getCenter().lat
      const metersPerPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
      resize(modelPixels(map.getZoom()) * metersPerPixel)
      const toMap = new THREE.Matrix4()
        .makeTranslation(origin.x, origin.y, origin.z)
        .scale(new THREE.Vector3(unit, unit, unit))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeScale(1, 1, -1))
      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(toMap)
      renderer.resetState()
      renderer.render(scene, camera)
    },
    onRemove() {
      clear()
      for (const g of Object.values(geo)) g.dispose()
      for (const m of cache.values()) m.dispose()
      cache.clear()
    },
  }

  return { layer, update }
}

/** Lattice tower frame: 4 legs tapering to the top, horizontal rings, X-bracing on each face. */
function latticeGeometry(THREE) {
  const levels = [0, 0.22, 0.42, 0.6, 0.74, 0.88, 1]
  const half = (y) => 0.15 - (0.15 - 0.03) * y // leg spread at height y
  const corners = (y) => {
    const h = half(y)
    return [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]]
  }
  const pts = []
  const seg = (p, q) => pts.push(...p, ...q)
  for (let i = 0; i < levels.length; i++) {
    const c = corners(levels[i])
    for (let k = 0; k < 4; k++) seg(c[k], c[(k + 1) % 4]) // ring
    if (i === 0) continue
    const d = corners(levels[i - 1])
    for (let k = 0; k < 4; k++) {
      seg(d[k], c[k]) // leg
      seg(d[k], c[(k + 1) % 4]) // brace
      seg(d[(k + 1) % 4], c[k]) // brace
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}
