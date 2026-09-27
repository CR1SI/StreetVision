import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import {
  ArrowLeft, Box, CalendarCheck2, ChevronDown, ChevronUp, ExternalLink, Hand, Info, Loader2, Maximize2, Orbit, Plus, RotateCcw, SlidersHorizontal, Square, Users, WifiOff, X, Zap,
} from 'lucide-react'
import { Layout } from '../components/Layout'
import { OverlapCard } from '../components/OverlapCard'
import { ConfidenceBadge, ErrorState, Pill, Skeleton, Spinner, TierLabel, UtilityTag } from '../components/ui'
import { param, useAsync, writeParams } from '../hooks/useAsync'
import { useMapLibre } from '../hooks/useMapLibre'
import { useUtilities } from '../hooks/useUtilities'
import { api } from '../lib/api'
import { PALETTE, TIERS } from '../lib/colors'
import { fmtDate, fmtDistance, fmtNum, fmtUsd, tidyName } from '../lib/format'
import { bounds, connectorsToGeoJSON, midpoint, overlapKey } from '../lib/geo'
import { drawConnectors, drawProjects, PROJECT_HIT_LAYERS, projectKey, selectFeature, setModelMode } from '../lib/mapLayers'
import { createModelsLayer, MODELS_LAYER } from '../lib/models3d'
import { PROJECT_TYPES } from '../lib/projectTypes'
import { esc, nearPopup, projectPopup, substationPopup } from '../lib/popups'

const CONF_OPTIONS = [
  { v: 'none', l: 'Any confidence' },
  { v: 'low', l: 'Low and up' },
  { v: 'medium', l: 'Medium and up' },
  { v: 'high', l: 'High only' },
]
const SOURCE_OPTIONS = [
  { v: 'all', l: 'All sources' },
  { v: 'official', l: 'Official filings' },
  { v: 'user', l: 'Community data' },
]
const NEAR_RADIUS = 10
// Keep fitted data clear of the filter panel (top) and legend (bottom-left).
const FIT_PADDING = () =>
  window.innerWidth < 640
    ? { top: 150, bottom: 30, left: 30, right: 50 }
    : { top: 200, bottom: 50, left: 250, right: window.innerWidth >= 1024 ? 500 : 70 } // clear of the floating list panel

function initialFilters() {
  return {
    utilities: (param('utilities') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    source: param('source') || 'all',
    minConf: param('min_confidence') || 'none',
    hideInService: param('hide_in_service') === 'true',
    tier: param('tier') || '',
    radius: Math.min(100, Math.max(1, Number(param('radius')) || 25)),
  }
}

const orbitZoom = (mi) => Math.max(8.2, Math.min(12.8, 12.6 - Math.log2(Math.max(mi, 0.5) / 1.5)))

export default function Home() {
  const container = useRef(null)
  const { mapRef, isLoaded, online, orbiting, fitBounds, startOrbit, stopOrbit } = useMapLibre(container)
  const [threeD, setThreeD] = useState(false)
  const [modelState, setModelState] = useState('idle') // idle | loading | ready | error
  const modelsRef = useRef(null)
  const utils = useUtilities()
  const [filters, setFilters] = useState(initialFilters)
  const [radiusDraft, setRadiusDraft] = useState(filters.radius)
  const [selectedKey, setSelectedKey] = useState(() => (param('overlap') ? Number(param('overlap')) : null))
  const [listMin, setListMin] = useState(false) // ranked list collapsed to its title bar
  const [filtersOpen, setFiltersOpen] = useState(() => window.innerWidth >= 640)
  const live = filters.radius > 25

  const utilParam = filters.utilities.length ? filters.utilities.join(',') : undefined

  const projects = useAsync(
    (signal) =>
      api.projects(
        { utilities: utilParam, source: filters.source, min_confidence: filters.minConf, hide_in_service: filters.hideInService || undefined },
        { signal },
      ),
    [utilParam, filters.source, filters.minConf, filters.hideInService],
  )

  const overlaps = useAsync(
    (signal) =>
      live
        ? api.overlapsLive(
            { max_distance_mi: filters.radius, utilities: utilParam, source: filters.source, hide_in_service: filters.hideInService || undefined, limit: 500 },
            { signal },
          )
        : api.overlaps(
            {
              max_distance_mi: filters.radius,
              utilities: utilParam,
              source: filters.source,
              min_confidence: filters.minConf,
              hide_in_service: filters.hideInService || undefined,
              tier: filters.tier || undefined,
              limit: 500,
            },
            { signal },
          ),
    [live, filters.radius, utilParam, filters.source, filters.minConf, filters.hideInService, filters.tier],
  )

  const list = useMemo(() => overlaps.data ?? [], [overlaps.data])
  const keyOf = overlapKey
  const selected = useMemo(() => list.find((o) => keyOf(o) === selectedKey) ?? null, [list, selectedKey])

  // Keep the URL shareable: filters + selected overlap.
  useEffect(() => {
    writeParams({
      utilities: filters.utilities,
      source: filters.source !== 'all' ? filters.source : null,
      min_confidence: filters.minConf !== 'none' ? filters.minConf : null,
      hide_in_service: filters.hideInService,
      tier: filters.tier,
      radius: filters.radius !== 25 ? filters.radius : null,
      overlap: typeof selectedKey === 'number' ? selectedKey : null,
    })
  }, [filters, selectedKey])

  const update = (patch) => setFilters((f) => ({ ...f, ...patch }))

  // Commit the radius slider after it settles (works for mouse, keyboard and screen readers alike).
  useEffect(() => {
    if (radiusDraft === filters.radius) return
    const t = setTimeout(() => update({ radius: radiusDraft }), 350)
    return () => clearTimeout(t)
  }, [radiusDraft]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleUtility = (id) => {
    const all = utils.list.map((u) => u.utility_id)
    let next
    if (!filters.utilities.length) {
      next = [id]
    } else {
      next = filters.utilities.includes(id)
        ? filters.utilities.filter((x) => x !== id)
        : [...filters.utilities, id]
    }
    if (next.length === all.length) next = []
    update({ utilities: next })
  }
  const isOn = (id) => !filters.utilities.length || filters.utilities.includes(id)
  const resetFilters = () => {
    setFilters({ utilities: [], source: 'all', minConf: 'none', hideInService: false, tier: '', radius: 25 })
    setRadiusDraft(25)
  }

  // ---------------------------------------------------------------- map data
  const fittedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map || !projects.data) return
    drawProjects(map, projects.data, utils.colors)
    if (!fittedRef.current && projects.data.features.length && !param('overlap')) {
      fittedRef.current = true
      fitBounds(bounds(projects.data.features), { duration: 0, padding: FIT_PADDING() })
    }
  }, [isLoaded, projects.data, utils.colors]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map) return
    drawConnectors(map, connectorsToGeoJSON(list))
  }, [isLoaded, list, mapRef])

  // 3D models (three.js, loaded the first time 3D is switched on).
  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map) return
    let cancelled = false
    if (threeD) {
      setModelState((s) => (s === 'ready' ? s : 'loading'))
      ;(async () => {
        if (!modelsRef.current) modelsRef.current = await createModelsLayer(map)
        if (cancelled) return
        if (projects.data) modelsRef.current.update(projects.data, utils.colors)
        if (!map.getLayer(MODELS_LAYER)) map.addLayer(modelsRef.current.layer, map.getLayer('project-icons-line') ? 'project-icons-line' : undefined)
        else map.setLayoutProperty(MODELS_LAYER, 'visibility', 'visible')
        setModelMode(map, true)
        setModelState('ready')
      })().catch((err) => {
        console.error('3D models failed to load', err)
        if (!cancelled) {
          setModelState('error')
          setThreeD(false)
        }
      })
    } else if (map.getLayer(MODELS_LAYER)) {
      map.setLayoutProperty(MODELS_LAYER, 'visibility', 'none')
      setModelMode(map, false)
    }
    if (!orbiting) map.easeTo({ pitch: threeD ? 55 : 0, duration: 800 })
    return () => {
      cancelled = true
    }
  }, [threeD, isLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the models in step with the filters and colors.
  useEffect(() => {
    const map = mapRef.current
    if (!threeD || modelState !== 'ready' || !modelsRef.current || !projects.data || !map) return
    modelsRef.current.update(projects.data, utils.colors)
    map.triggerRepaint()
  }, [projects.data, utils.colors, threeD, modelState, mapRef])

  // Highlight the selected connector and both of its projects.
  const selRef = useRef({ conn: null, projects: [] })
  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map || !map.getSource('connectors') || !map.getSource('projects')) return
    const conn = selected ? keyOf(selected) : null
    selRef.current.conn = selectFeature(map, 'connectors', selRef.current.conn, conn)
    for (const k of selRef.current.projects) map.setFeatureState({ source: 'projects', id: k }, { selected: false })
    const pk = selected ? [projectKey(selected.a), projectKey(selected.b)] : []
    for (const k of pk) map.setFeatureState({ source: 'projects', id: k }, { selected: true })
    selRef.current.projects = pk
  }, [selected, isLoaded, list, projects.data, mapRef])

  // Arriving with ?overlap=ID: fly there once the list has loaded.
  const arrivedRef = useRef(false)
  useEffect(() => {
    if (arrivedRef.current || !isLoaded || !selected) return
    arrivedRef.current = true
    startOrbit(midpoint(selected.connector), orbitZoom(selected.center_distance_mi))
  }, [isLoaded, selected, startOrbit])

  const select = useCallback(
    (o, { orbit = true } = {}) => {
      if (!o) {
        setSelectedKey(null)
        return
      }
      arrivedRef.current = true // a user choice supersedes the ?overlap= deep link
      setSelectedKey(keyOf(o))
      if (orbit) startOrbit(midpoint(o.connector), orbitZoom(o.center_distance_mi))
    },
    [startOrbit],
  )

  // ---------------------------------------------------------------- map interaction
  const listRef = useRef(list)
  listRef.current = list
  const colorsRef = useRef(utils.colors)
  colorsRef.current = utils.colors
  const cardRefs = useRef({})

  useEffect(() => {
    const map = mapRef.current
    if (!isLoaded || !map) return
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 10 })
    let hovered = null
    let clickSeq = 0 // ignore 'what's near here' responses for an earlier click
    const layers = () => ['connectors-hit', ...PROJECT_HIT_LAYERS].filter((l) => map.getLayer(l))

    const onMove = (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: layers() })[0]
      map.getCanvas().style.cursor = f ? 'pointer' : ''
      const next = f ? { source: f.source === 'substations' ? null : f.source, id: f.id } : null
      if (hovered && (!next || hovered.id !== next.id)) map.setFeatureState(hovered, { hover: false })
      if (next?.source && next.id !== undefined) {
        map.setFeatureState(next, { hover: true })
        hovered = next
      } else hovered = null
    }

    const onClick = async (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: layers() })[0]
      if (f?.layer.id === 'connectors-hit') {
        clickSeq += 1
        popup.remove()
        const o = listRef.current.find((x) => String(keyOf(x)) === String(f.properties.key))
        if (o) {
          select(o, { orbit: false })
          cardRefs.current[keyOf(o)]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
        return
      }
      if (f?.layer.id === 'substations') {
        clickSeq += 1
        popup.setLngLat(f.geometry.coordinates).setHTML(substationPopup(f.properties, colorsRef.current)).addTo(map)
        return
      }
      if (f) {
        clickSeq += 1
        const raw = f.properties.center
        const p = { ...f.properties, center: typeof raw === 'string' ? JSON.parse(raw) : raw }
        const involved = listRef.current.filter(
          (o) => o.overlap_id !== undefined && [projectKey(o.a), projectKey(o.b)].includes(projectKey(p)),
        )
        popup.setLngLat(e.lngLat).setHTML(projectPopup(p, colorsRef.current, involved)).addTo(map)
        return
      }
      // Empty map: what's near here? (PostGIS ST_DWithin lookup)
      const seq = ++clickSeq
      popup.setLngLat(e.lngLat).setHTML('<div style="color:#9198A3">Looking for nearby projects…</div>').addTo(map)
      try {
        const res = await api.near({ lat: e.lngLat.lat, lon: e.lngLat.lng, radius_mi: NEAR_RADIUS })
        if (seq === clickSeq && popup.isOpen()) popup.setHTML(nearPopup(e.lngLat, res, NEAR_RADIUS))
      } catch (err) {
        if (seq === clickSeq && popup.isOpen()) popup.setHTML(`<div style="color:#DC5B5B">${esc(err.message)}</div>`)
      }
    }

    map.on('mousemove', onMove)
    map.on('click', onClick)
    return () => {
      map.off('mousemove', onMove)
      map.off('click', onClick)
      popup.remove()
    }
  }, [isLoaded, mapRef, select])

  const fitAll = () => projects.data && fitBounds(bounds(projects.data.features), { padding: FIT_PADDING() })

  const projectCount = projects.data?.features.length
  const activeFilterCount =
    (filters.utilities.length ? 1 : 0) + (filters.source !== 'all') + (filters.minConf !== 'none') + filters.hideInService + !!filters.tier + (filters.radius !== 25)

  return (
    <Layout active="home" fill>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* ------------------------------------------------ MAP */}
        <section className={`relative min-h-[360px] lg:h-auto lg:flex-1 ${listMin && !selected ? 'flex-1' : 'h-[58vh] flex-none'}`} aria-label="Map of planned projects">
          <div className="absolute inset-0">
            <div ref={container} className="h-full w-full" />
          </div>

          {(!isLoaded || projects.loading) && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <Spinner className="bg-ink-800 px-4 py-2" label={isLoaded ? 'Loading projects…' : 'Loading map…'} />
            </div>
          )}

          {/* Filter panel */}
          <div className="absolute left-3 top-3 z-20 max-w-[calc(100%-5.5rem)] sm:left-4 sm:top-4 lg:max-w-[calc(100%-420px-8rem)]">
            <div className="glass flex flex-col gap-2.5 p-2.5 sm:p-3">
              <div className="flex flex-wrap items-center gap-2">
                {utils.list.map((u) => {
                  const on = isOn(u.utility_id)
                  const c = utils.colors[u.utility_id]
                  return (
                    <button
                      key={u.utility_id}
                      type="button"
                      onClick={() => toggleUtility(u.utility_id)}
                      aria-pressed={on}
                      title={`${u.name ?? u.utility_id}: ${u.projects} projects${u.has_official_data ? '' : ' (community data)'}`}
                      className="chip border"
                      style={on ? { background: `${c}26`, borderColor: c, color: PALETTE.text } : { borderColor: PALETTE.border, color: PALETTE.faint }}
                    >
                      <span className="h-2 w-2" style={{ background: on ? c : PALETTE.faint }} />
                      {u.utility_id}
                    </button>
                  )
                })}
                {utils.loading && <Skeleton className="h-7 w-28" />}
                <a href="/contribute/" className="chip border border-dashed border-ink-500 text-fg-faint hover:text-fg-dim" title="Add another utility's planned projects">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add utility
                </a>
                <button
                  type="button"
                  className="chip ml-auto border-ink-500 text-fg-dim hover:text-fg"
                  onClick={() => setFiltersOpen((o) => !o)}
                  aria-expanded={filtersOpen}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
                </button>
              </div>

              {filtersOpen && (
                <div className="grid grid-cols-2 items-center gap-2 border-t border-ink-500 pt-2.5 sm:flex sm:flex-wrap">
                  <Select label="Source" value={filters.source} onChange={(v) => update({ source: v })} options={SOURCE_OPTIONS} />
                  <Select
                    label="Location confidence"
                    value={filters.minConf}
                    onChange={(v) => update({ minConf: v })}
                    options={CONF_OPTIONS}
                    disabled={live}
                  />
                  <Select
                    label="Proximity tier"
                    value={filters.tier}
                    onChange={(v) => update({ tier: v })}
                    options={[{ v: '', l: 'All tiers' }, ...TIERS.map((t) => ({ v: t.key, l: t.label }))]}
                    disabled={live}
                  />
                  <label className="flex cursor-pointer items-center gap-2 border border-ink-500 bg-ink-700 px-3 py-1.5 text-xs text-fg-dim">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={filters.hideInService}
                      onChange={(e) => update({ hideInService: e.target.checked })}
                    />
                    Hide in-service
                    <span className="relative h-4 w-7 bg-ink-500 transition-colors peer-checked:bg-brand-accent peer-focus-visible:ring-2 peer-focus-visible:ring-brand-accent">
                      <span className={`absolute top-0.5 h-3 w-3 bg-fg transition-all ${filters.hideInService ? 'left-3.5' : 'left-0.5'}`} />
                    </span>
                  </label>
                  <div className="flex items-center gap-2 border border-ink-500 bg-ink-700 px-3 py-1.5">
                    <label htmlFor="radius" className="whitespace-nowrap text-xs text-fg-dim">
                      Radius <b className="text-fg">{radiusDraft} mi</b>
                    </label>
                    <input
                      id="radius"
                      type="range"
                      min="1"
                      max="100"
                      value={radiusDraft}
                      onChange={(e) => setRadiusDraft(Number(e.target.value))}
                      className="w-24 accent-brand-accent"
                      aria-describedby="radius-hint"
                    />
                  </div>
                  {activeFilterCount > 0 && (
                    <button type="button" onClick={resetFilters} className="chip border-ink-500 text-fg-faint hover:text-fg">
                      <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reset
                    </button>
                  )}
                  <p id="radius-hint" className="col-span-2 w-full text-[11px] text-fg-faint">
                    {live
                      ? 'Over 25 mi: overlaps are recomputed live by PostGIS. Tier and confidence filters apply to the stored 25-mile list only.'
                      : '25 mi is the challenge’s overlap threshold. Drag past it to run the live PostGIS engine at a wider radius.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right-side map tools (under the zoom control) */}
          <div className="absolute right-[10px] top-[118px] z-20 flex flex-col overflow-hidden border border-ink-500 bg-ink-800">
            <MapTool
              label={threeD ? 'Switch to flat map' : modelState === 'error' ? '3D models could not load' : 'Show 3D models'}
              onClick={() => setThreeD((v) => !v)}
              active={threeD}
            >
              {modelState === "loading" && threeD ? <Loader2 className="h-4 w-4 animate-spin" /> : threeD ? <Square className="h-4 w-4" /> : <Box className="h-4 w-4" />}
            </MapTool>
            <MapTool label="Fit all projects" onClick={fitAll}>
              <Maximize2 className="h-4 w-4" />
            </MapTool>
          </div>

          {/* Legend */}
          <Legend colors={utils.colors} list={utils.list} threeD={threeD} />

          {!online && isLoaded && (
            <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 border border-ink-500 bg-ink-800 px-3 py-2 text-[11px] text-fg-dim sm:bottom-10">
              <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Street basemap unavailable: showing projects on a plain canvas</span>
              <span className="sm:hidden">Basemap offline</span>
            </div>
          )}
          {orbiting && (
            <button
              type="button"
              onClick={stopOrbit}
              className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 border border-brand-accent/60 bg-ink-800 px-4 py-2 text-xs font-bold text-fg"
            >
              <span className="mr-2 inline-block h-2 w-2 animate-pulse bg-brand-accent" />
              Orbiting · click to stop
            </button>
          )}
        </section>

        {/* ------------------------------------------------ SIDEBAR */}
        <aside
          className={`glass m-3 flex min-h-0 flex-col overflow-hidden lg:absolute lg:right-14 lg:top-4 lg:z-30 lg:m-0 lg:w-[420px] ${
            listMin && !selected ? 'flex-none' : 'flex-1 lg:bottom-14'
          }`}
          aria-label="Ranked coordination opportunities"
        >
          {selected ? (
            <OverlapPanel o={selected} colors={utils.colors} orbiting={orbiting} onBack={() => select(null)} onOrbit={() => select(selected)} onStop={stopOrbit} />
          ) : listMin ? (
            <button
              type="button"
              onClick={() => setListMin(false)}
              aria-expanded="false"
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-ink-700"
            >
              <span className="flex items-center gap-2.5">
                <span className="text-[15px] font-bold">Ranked opportunities</span>
                <span className="border border-ink-500 bg-ink-700 px-2.5 py-0.5 text-[12px] font-semibold text-fg">{overlaps.loading ? '…' : list.length}</span>
              </span>
              <span className="flex h-7 w-7 items-center justify-center text-fg-dim" title="Expand">
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Expand ranked opportunities</span>
              </span>
            </button>
          ) : (
            <>
              <div className="border-b border-ink-500 px-5 pb-4 pt-5">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h1 className="text-lg font-bold">Ranked opportunities</h1>
                  <div className="flex items-center gap-1.5">
                    <span className="border border-ink-500 bg-ink-700 px-2.5 py-0.5 text-[12px] font-semibold text-fg">{overlaps.loading ? '…' : list.length}</span>
                    <button
                      type="button"
                      onClick={() => setListMin(true)}
                      aria-expanded="true"
                      title="Minimize"
                      className="flex h-7 w-7 items-center justify-center border border-ink-500 text-fg-dim hover:bg-ink-700 hover:text-fg"
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Minimize ranked opportunities</span>
                    </button>
                  </div>
                </div>
                <p className="text-xs text-fg-dim">
                  {filters.utilities.length ? filters.utilities.join(' × ') : 'All utilities'} · within {filters.radius} mi
                  {projectCount !== undefined && ` · ${projectCount} projects mapped`}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <div className="border border-ink-500 bg-ink-700 px-3.5 py-3">
                    <div className="text-[11px] font-semibold text-fg-faint">Touching or crossing</div>
                    <div className="text-xl font-bold">{overlaps.loading && !overlaps.data ? '…' : list.filter((o) => o.proximity_tier === 'touching/crossing').length}</div>
                  </div>
                  <div className="border border-ink-500 bg-ink-700 px-3.5 py-3">
                    <div className="text-[11px] font-semibold text-fg-faint">Built at the same time</div>
                    <div className="text-xl font-bold">{overlaps.loading && !overlaps.data ? '…' : list.filter((o) => o.build_windows_overlap).length}</div>
                  </div>
                </div>
                <p className="mt-3 flex items-center gap-1 text-[11px] text-fg-faint">
                  <Info className="h-3 w-3" aria-hidden="true" /> Ranked by closeness (70%) and timing (30%). Click a row to fly there.
                </p>
              </div>
              <div className="scroll-thin flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
                {overlaps.error && <ErrorState error={overlaps.error} onRetry={overlaps.reload} />}
                {overlaps.loading && !overlaps.data && [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[118px]" />)}
                {!overlaps.loading && !overlaps.error && list.length === 0 && (
                  <div className="card p-5 text-center">
                    <p className="mb-1 text-[13px] font-semibold">No overlaps match these filters</p>
                    <p className="mb-4 text-xs text-fg-dim">Most project pairs don’t overlap, and that’s expected. Try loosening a filter.</p>
                    <button type="button" className="btn-ghost" onClick={resetFilters}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reset filters
                    </button>
                  </div>
                )}
                <div className={overlaps.loading && overlaps.data ? 'space-y-2.5 opacity-50 transition-opacity' : 'space-y-2.5'}>
                  {list.map((o) => (
                    <OverlapCard
                      key={keyOf(o)}
                      ref={(el) => (cardRefs.current[keyOf(o)] = el)}
                      o={o}
                      colors={utils.colors}
                      selected={keyOf(o) === selectedKey}
                      onSelect={() => select(o)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </Layout>
  )
}

function Select({ label, value, onChange, options, disabled }) {
  return (
    <label className={`relative block sm:inline-block ${disabled ? 'opacity-40' : ''}`}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none border border-ink-500 bg-ink-700 py-2 pl-3 pr-7 text-xs text-fg-dim hover:text-fg focus:border-brand-accent focus:outline-none sm:w-auto sm:py-1.5"
        title={label}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  )
}

function MapTool({ label, onClick, active, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`flex h-[34px] w-[34px] items-center justify-center border-b border-ink-500 last:border-b-0 hover:bg-ink-600 ${active ? 'text-brand-accent' : 'text-fg-dim'}`}
    >
      {children}
    </button>
  )
}

function Legend({ colors, list, threeD }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="absolute bottom-3 left-3 z-20 hidden w-[220px] sm:bottom-4 sm:left-4 sm:block">
      <div className="card bg-ink-800 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="eyebrow flex w-full items-center justify-between text-fg-dim">
          Legend <span className="text-fg-faint">{open ? '–' : '+'}</span>
        </button>
        {open && (
          <div className="mt-2.5 space-y-3 text-[11.5px] text-fg-dim">
            <div className="space-y-1.5">
              {list.map((u) => (
                <div key={u.utility_id} className="flex items-center gap-2">
                  <span className="h-[3px] w-4" style={{ background: colors[u.utility_id] }} />
                  <span className="truncate">{u.name ?? u.utility_id}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 border-t border-ink-500 pt-2.5">
              <div className="eyebrow text-fg-faint">Project type (badge)</div>
              {PROJECT_TYPES.filter((t) => t.key !== 'other').map((t) => (
                <div key={t.key} className="flex items-center gap-2" title={t.hint}>
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center bg-fg-dim text-ink-900">
                    <t.Icon className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
                  </span>
                  {t.label}
                </div>
              ))}
              <div className="flex items-center gap-2" title="Where a planned line starts or ends">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center border-2 border-fg-dim">
                  <Zap className="h-2 w-2 text-fg-dim" strokeWidth={3} aria-hidden="true" />
                </span>
                Substation (line end)
              </div>
            </div>
            {threeD && (
              <div className="space-y-1 border-t border-ink-500 pt-2.5">
                <div className="eyebrow text-fg-faint">3D models</div>
                <div>Towers = line work along the route</div>
                <div className="pl-2 text-fg-faint">amber band = rebuild · accent tip = new line</div>
                <div>Large transformer = substation work</div>
                <div>Fenced yard = substation (line end)</div>
                <div>Bigger yard = area package</div>
                <div className="text-fg-faint">Models are enlarged to stay visible</div>
              </div>
            )}
            <div className="space-y-1.5 border-t border-ink-500 pt-2.5">
              <div className="eyebrow text-fg-faint">Overlap tier (dashed)</div>
              {TIERS.map((t) => (
                <div key={t.key} className="flex items-center gap-2">
                  <span className="w-4 border-t-[3px] border-dashed" style={{ borderColor: t.color }} />
                  {t.label}
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t border-ink-500 pt-2.5 text-[11px] text-fg-faint">
              <div>Faded = low location confidence</div>
              <div>White ring / dashes = hand-placed location</div>
              <div>Badge color = utility</div>
              <div>Click empty map: what’s near here</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Construction starts and in-service dates for both projects, in date order, with "Today" placed among them. */
function timelineEvents(o) {
  const ev = []
  for (const p of [o.a, o.b]) {
    const start = Number(String(p.build_window ?? '').split('-')[0]) || null
    if (start) ev.push({ t: new Date(start, 0, 1), when: String(start), what: 'Construction starts', p, kind: 'build' })
    if (p.in_service_date) ev.push({ t: new Date(p.in_service_date), when: fmtDate(p.in_service_date), what: 'In service', p, kind: 'done' })
  }
  ev.push({ t: new Date(), when: 'Today', what: '', kind: 'today' })
  return ev.sort((x, y) => x.t - y.t)
}

function OverlapPanel({ o, colors, orbiting, onBack, onOrbit, onStop }) {
  const live = o.overlap_id === undefined
  const events = timelineEvents(o)
  const gapMonths = o.in_service_gap_days === null || o.in_service_gap_days === undefined ? null : Math.round(o.in_service_gap_days / 30.4)
  return (
    <div className="animate-in flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-5 pt-4">
        <button type="button" onClick={onBack} className="btn-ghost px-3 py-1.5 text-[12px]">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All overlaps
        </button>
        <button type="button" onClick={onBack} aria-label="Close detail" className="p-2 text-fg-faint hover:bg-ink-600 hover:text-fg">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {/* Header card */}
        <div className="tile p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="inline-flex h-7 min-w-7 items-center justify-center border border-brand-accent bg-brand-accent-dim px-1.5 text-[12px] font-bold text-brand-accent">{o.rank}</span>
              {live ? <Pill tone="purple">Live result</Pill> : <TierLabel tier={o.proximity_tier} />}
            </span>
            {!live && (
              <a href={`/overlap/?id=${o.overlap_id}`} className="btn-primary px-3 py-1.5 text-[12px]">
                Details <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <h2 className="text-[16px] font-bold leading-snug">
            {tidyName(o.a.name)} <span className="font-normal text-fg-faint">×</span> {tidyName(o.b.name)}
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-ink-500 pt-3 text-[11px]">
            {[o.a, o.b].map((p) => (
              <div key={p.utility_id + p.project_id} className="min-w-0">
                <div className="text-fg-faint">
                  <UtilityTag id={p.utility_id} colors={colors} /> project
                </div>
                <div className="truncate text-[13px] font-semibold text-fg" title={p.project_id}>{p.project_id}</div>
              </div>
            ))}
            <div>
              <div className="text-fg-faint">Location</div>
              {live ? <div className="text-[13px] font-semibold">—</div> : <ConfidenceBadge level={o.location_confidence} suffix={false} className="mt-0.5" />}
            </div>
          </div>
        </div>

        {!live && (
          <div className="tile flex items-start gap-3 p-4">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-ink-500 bg-ink-600">
              <Users className="h-3.5 w-3.5 text-fg" aria-hidden="true" />
            </span>
            <div>
              <div className="text-[13px] font-semibold">What could be shared</div>
              <div className="text-[13px] text-fg-dim">{o.shareable}</div>
            </div>
          </div>
        )}

        {/* Headline numbers */}
        <div className="grid grid-cols-2 gap-3">
          <div className="border border-ink-500 bg-ink-700 px-4 py-3.5">
            <div className="text-[12px] font-semibold text-fg-faint">Distance</div>
            <div className="text-2xl font-bold text-brand-accent">{fmtNum(o.center_distance_mi, 2)} mi</div>
            <div className="text-[11px] text-fg-faint">Closest points {fmtDistance(o.closest_distance_mi)}</div>
          </div>
          <div className="border border-ink-500 bg-ink-700 px-4 py-3.5">
            <div className="text-[12px] font-semibold text-fg-faint">In service apart</div>
            <div className="text-2xl font-bold">{gapMonths === null ? '—' : gapMonths < 1 ? `${o.in_service_gap_days} d` : `${gapMonths} mo`}</div>
            <div className="text-[11px] text-fg-faint">{o.in_service_gap_days === null ? 'Dates unknown' : `${fmtNum(o.in_service_gap_days)} days`}</div>
          </div>
        </div>

        {/* Timeline */}
        <div className="tile p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold">Timeline</span>
            {!live && (
              <Pill tone={o.build_windows_overlap ? 'teal' : 'default'}>
                <CalendarCheck2 className="h-3 w-3" /> {o.build_windows_overlap ? 'Build windows overlap' : 'Build windows apart'}
              </Pill>
            )}
          </div>
          <ol className="relative ml-2 border-l border-ink-500">
            {events.map((e, i) =>
              e.kind === 'today' ? (
                <li key={i} className="relative -ml-px mb-3 pl-5">
                  <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 bg-brand-accent" />
                  <span className="bg-brand-accent-dim px-2 py-0.5 text-[11px] font-semibold text-brand-accent">Today</span>
                </li>
              ) : (
                <li key={i} className="relative mb-3 pl-5 last:mb-0">
                  <span
                    className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 border-2 ${e.kind === 'done' ? 'bg-fg' : 'bg-transparent'}`}
                    style={{ borderColor: colors[e.p.utility_id] ?? '#9198A3' }}
                  />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-semibold">
                      <UtilityTag id={e.p.utility_id} colors={colors} /> {e.what}
                    </span>
                    <span className="shrink-0 text-[11px] text-fg-faint">{e.when}</span>
                  </div>
                  <div className="truncate text-[12px] text-fg-dim">{tidyName(e.p.name)}</div>
                </li>
              ),
            )}
          </ol>
        </div>

        {!live && (o.override_involved || o.user_data_involved || o.either_already_in_service) && (
          <div className="flex flex-wrap gap-1.5">
            {o.either_already_in_service && <Pill>One is already in service</Pill>}
            {o.override_involved && (
              <Pill tone="amber">
                <Hand className="h-3 w-3" /> Hand-placed location
              </Pill>
            )}
            {o.user_data_involved && (
              <Pill tone="purple">
                <Users className="h-3 w-3" /> Community data
              </Pill>
            )}
          </div>
        )}

        {!live && o.shared_row_acres_upper_bound !== null && (
          <div className="border border-ink-500 bg-ink-700 px-4 py-3.5">
            <div className="text-[12px] font-semibold text-fg-faint">Shared right-of-way (upper bound)</div>
            <div className="text-xl font-bold">
              {fmtNum(o.shared_row_acres_upper_bound, 1)} acres
              {o.shared_row_value_usd !== null && <span className="ml-2 text-[13px] font-semibold text-brand-accent">≈ {fmtUsd(o.shared_row_value_usd)}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-ink-500 px-5 py-4 sm:flex-row">
        {orbiting ? (
          <button type="button" className="btn-ghost flex-1" onClick={onStop}>
            <Square className="h-3.5 w-3.5" /> Stop orbit
          </button>
        ) : (
          <button type="button" className="btn-ghost flex-1" onClick={onOrbit}>
            <Orbit className="h-3.5 w-3.5" /> Orbit
          </button>
        )}
        {live ? (
          <span className="btn-ghost flex-1 cursor-default text-center text-[12px]" title="Live results aren't stored, so they have no detail page">
            Live: no detail page
          </span>
        ) : (
          <a className="btn-primary flex-1" href={`/overlap/?id=${o.overlap_id}`}>
            Full detail <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  )
}