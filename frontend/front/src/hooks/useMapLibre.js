import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PALETTE } from '../lib/colors'

// Adapted from the grid-model branch's useMapLibre hook: same dark CARTO basemap, fly-to and
// orbit camera. Additions: the land is repainted to the StreetVision map color (#171717),
// and if the basemap can't be fetched (offline demo, blocked network) the map still works on a
// plain dark canvas instead of staying blank.
const STYLE_URL = import.meta.env.VITE_BASEMAP_STYLE ?? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export const REGION = { center: [-81.35, 32.75], zoom: 6.9 } // Savannah -> Augusta border corridor

const FALLBACK_STYLE = {
  version: 8,
  name: 'StreetVision offline',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': PALETTE.map } }],
}

let stylePromise = null
function loadStyle() {
  if (!stylePromise) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    stylePromise = fetch(STYLE_URL, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`basemap ${r.status}`))))
      .then((style) => ({ style: recolor(style), online: true }))
      .catch(() => ({ style: FALLBACK_STYLE, online: false }))
      .finally(() => clearTimeout(timer))
  }
  return stylePromise
}

// Repaint the basemap to the StreetVision dark: land #171717, water a touch deeper and bluer
// so the Savannah River and coast still read, roads and labels left as the basemap draws them.
function recolor(style) {
  const s = structuredClone(style)
  for (const l of s.layers) {
    const id = l.id.toLowerCase()
    if (l.type === 'background') l.paint = { ...l.paint, 'background-color': PALETTE.map }
    else if (l.type === 'fill' && /water/.test(id)) l.paint = { ...l.paint, 'fill-color': '#0D1117' }
    else if (l.type === 'fill' && /landcover|landuse|park|wood|grass|nature/.test(id))
      l.paint = { ...l.paint, 'fill-color': '#1B1B1B' }
  }
  return s
}

export function useMapLibre(containerRef, options = {}) {
  const mapRef = useRef(null)
  const orbitRef = useRef(null)
  const orbitToken = useRef(0) // bumps on every start/stop so stale 'moveend' handlers do nothing
  const [isLoaded, setIsLoaded] = useState(false)
  const [online, setOnline] = useState(true)
  const [orbiting, setOrbiting] = useState(false)
  const optsRef = useRef(options)

  useEffect(() => {
    let cancelled = false
    let map
    loadStyle().then(({ style, online }) => {
      if (cancelled || !containerRef.current) return
      const o = optsRef.current
      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: o.center ?? REGION.center,
        zoom: o.zoom ?? REGION.zoom,
        pitch: o.pitch ?? 0,
        bearing: o.bearing ?? 0,
        maxPitch: 70,
        attributionControl: false,
        interactive: o.interactive ?? true,
      })
      if (o.controls !== false) {
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'imperial' }), 'bottom-right')
      }
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
      map.on('load', () => {
        if (!cancelled) {
          setOnline(online)
          setIsLoaded(true)
        }
      })
      mapRef.current = map
    })
    return () => {
      cancelled = true
      if (orbitRef.current) cancelAnimationFrame(orbitRef.current)
      if (map) map.remove()
      mapRef.current = null
    }
  }, [containerRef])

  const stopOrbit = useCallback(() => {
    orbitToken.current += 1
    if (orbitRef.current) cancelAnimationFrame(orbitRef.current)
    orbitRef.current = null
    const map = mapRef.current
    if (map?.scrollZoom) map.scrollZoom._aroundCenter = false
    setOrbiting(false)
  }, [])

  const flyTo = useCallback(
    (center, zoom = 11, pitch = 0) => {
      const map = mapRef.current
      if (!map) return
      stopOrbit()
      map.flyTo({ center, zoom, pitch, bearing: 0, speed: 1.2, curve: 1.4, essential: true })
    },
    [stopOrbit],
  )

  const fitBounds = useCallback(
    (b, opts = {}) => {
      const map = mapRef.current
      if (!map || !b) return
      stopOrbit()
      map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 1200, ...opts })
    },
    [stopOrbit],
  )

  // Fly to a point, tilt the camera, then rotate slowly around it. The user can zoom in/out while orbiting.
  const startOrbit = useCallback(
    (center, zoom = 11.5) => {
      const map = mapRef.current
      if (!map) return
      stopOrbit()
      const token = orbitToken.current
      if (map.scrollZoom) map.scrollZoom._aroundCenter = true
      map.flyTo({ center, zoom, pitch: 55, speed: 1.3, curve: 1.3, essential: true })
      const begin = () => {
        if (token !== orbitToken.current) return // superseded or stopped before the flight ended
        let bearing = map.getBearing()
        const step = () => {
          if (!mapRef.current) return
          if (!map.isZooming()) {
            bearing = (bearing + 0.12) % 360
            map.setBearing(bearing)
          }
          orbitRef.current = requestAnimationFrame(step)
        }
        orbitRef.current = requestAnimationFrame(step)
        setOrbiting(true)
      }
      map.once('moveend', begin)
      const halt = () => token === orbitToken.current && stopOrbit()
      map.once('dragstart', halt)
    },
    [stopOrbit],
  )

  return { mapRef, isLoaded, online, orbiting, flyTo, fitBounds, startOrbit, stopOrbit }
}

/** Add a GeoJSON source, or replace its data if it already exists. */
export function setSource(map, id, data, extra = {}) {
  const src = map.getSource(id)
  if (src) src.setData(data)
  else map.addSource(id, { type: 'geojson', data, ...extra })
}

export const hasGlyphs = (map) => Boolean(map.getStyle()?.glyphs)
