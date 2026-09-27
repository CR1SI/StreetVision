import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { WifiOff } from 'lucide-react'
import { useMapLibre } from '../hooks/useMapLibre'
import { connectorsToGeoJSON } from '../lib/geo'
import { drawConnectors, drawProjects, PROJECT_HIT_LAYERS, projectKey } from '../lib/mapLayers'
import { projectPopup, substationPopup } from '../lib/popups'
import { Spinner } from './ui'

/**
 * A self-contained map for the secondary pages (overlap inset, dataset, address check).
 * - projects: GeoJSON FeatureCollection from /api/projects
 * - overlaps: optional list with `connector`s to draw
 * - highlight: project keys ("UTIL|ID") to mark as selected
 * - fit: bounds [[w,s],[e,n]] to frame when data changes
 * - onReady(map, controls): escape hatch for page-specific layers (radius ring, marker, ...)
 */
export function MapView({ projects, overlaps, colors, highlight = [], fit, fitOptions, onReady, onMapClick, popups = true, className = '', children }) {
  const container = useRef(null)
  const controls = useMapLibre(container)
  const { mapRef, isLoaded, online, fitBounds } = controls
  const readyRef = useRef(false)

  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map || !projects || !colors) return
    drawProjects(map, projects, colors)
    drawConnectors(map, connectorsToGeoJSON(overlaps ?? []))
    const prev = map.__svHighlight ?? []
    for (const k of prev) map.setFeatureState({ source: 'projects', id: k }, { selected: false })
    for (const k of highlight) map.setFeatureState({ source: 'projects', id: k }, { selected: true })
    map.__svHighlight = highlight
  }, [isLoaded, projects, overlaps, colors, highlight.join(';')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLoaded && fit) fitBounds(fit, { duration: readyRef.current ? 1200 : 0, ...fitOptions })
  }, [isLoaded, fit && fit.flat().join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map || readyRef.current) return
    readyRef.current = true
    onReady?.(map, controls)
  }, [isLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Click a project for its popup; click elsewhere -> onMapClick (if given).
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const clickRef = useRef(onMapClick)
  clickRef.current = onMapClick
  const overlapsRef = useRef(overlaps)
  overlapsRef.current = overlaps
  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map) return
    const popup = new maplibregl.Popup({ maxWidth: '300px', offset: 10 })
    const layers = () => PROJECT_HIT_LAYERS.filter((l) => map.getLayer(l))
    const move = (e) => {
      map.getCanvas().style.cursor = popups && map.queryRenderedFeatures(e.point, { layers: layers() }).length ? 'pointer' : clickRef.current ? 'crosshair' : ''
    }
    const click = (e) => {
      const f = popups && map.queryRenderedFeatures(e.point, { layers: layers() })[0]
      if (f?.layer.id === 'substations') {
        popup.setLngLat(f.geometry.coordinates).setHTML(substationPopup(f.properties, colorsRef.current ?? {})).addTo(map)
        return
      }
      if (f) {
        const raw = f.properties.center
        const p = { ...f.properties, center: typeof raw === 'string' ? JSON.parse(raw) : raw }
        const involved = (overlapsRef.current ?? []).filter(
          (o) => o.overlap_id !== undefined && [projectKey(o.project_a ?? o.a), projectKey(o.project_b ?? o.b)].includes(projectKey(p)),
        )
        popup.setLngLat(e.lngLat).setHTML(projectPopup(p, colorsRef.current ?? {}, involved)).addTo(map)
      } else clickRef.current?.(e.lngLat, map)
    }
    map.on('mousemove', move)
    map.on('click', click)
    return () => {
      map.off('mousemove', move)
      map.off('click', click)
      popup.remove()
    }
  }, [isLoaded, mapRef, popups])

  return (
    <div className={`relative overflow-hidden bg-map ${className}`}>
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" />
      </div>
      {!isLoaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner label="Loading map…" />
        </div>
      )}
      {!online && isLoaded && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 rounded-md bg-ink-800/90 px-2 py-1 text-[10.5px] text-fg-faint">
          <WifiOff className="h-3 w-3" aria-hidden="true" /> Basemap offline
        </div>
      )}
      {typeof children === 'function' ? children(controls) : children}
    </div>
  )
}
