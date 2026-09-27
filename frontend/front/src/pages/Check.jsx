import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { AlertTriangle, CalendarCheck2, CheckCircle2, Crosshair, Hand, Loader2, MapPin, Search, Users } from 'lucide-react'
import { Layout } from '../components/Layout'
import { MapView } from '../components/MapView'
import { ConfidenceBadge, ErrorState, Pill, TierLabel, UtilityTag } from '../components/ui'
import { param, useAsync, writeParams } from '../hooks/useAsync'
import { setSource } from '../hooks/useMapLibre'
import { useUtilities } from '../hooks/useUtilities'
import { api } from '../lib/api'
import { PALETTE, tierColor } from '../lib/colors'
import { fmtGap, fmtNum, tidyName } from '../lib/format'
import { geocode } from '../lib/geocode'
import { bounds, circle } from '../lib/geo'
import { projectKey } from '../lib/mapLayers'

const RADII = [5, 10, 25, 50]
// Worked examples with coordinates baked in, so the demo works even without the geocoder.
const EXAMPLES = [
  { label: 'Hardeeville, SC', center: [-81.079, 32.2871] },
  { label: 'Rincon, GA', center: [-81.2354, 32.296] },
  { label: 'North Augusta, SC', center: [-81.9651, 33.5018] },
  { label: 'Charleston, SC', center: [-79.9311, 32.7765] },
]

export default function Check() {
  const utils = useUtilities()
  const [query, setQuery] = useState(param('q') ?? '')
  const [radius, setRadius] = useState(RADII.includes(Number(param('radius'))) ? Number(param('radius')) : 25)
  const [point, setPoint] = useState(() => {
    const lat = Number(param('lat'))
    const lon = Number(param('lon'))
    return param('lat') && param('lon') && Number.isFinite(lat) && Number.isFinite(lon) ? { center: [lon, lat], label: param('label') ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}` } : null
  })
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoError, setGeoError] = useState(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)

  const allProjects = useAsync((signal) => api.projects({}, { signal }), [])
  const allOverlaps = useAsync((signal) => api.overlaps({ limit: 2000 }, { signal }), [])
  const near = useAsync(
    (signal) => (point ? api.near({ lat: point.center[1], lon: point.center[0], radius_mi: radius }, { signal }) : Promise.resolve(null)),
    [point?.center.join(','), radius],
  )

  useEffect(() => {
    writeParams({ lat: point?.center[1].toFixed(5), lon: point?.center[0].toFixed(5), label: point?.label, radius: radius !== 25 ? radius : null })
  }, [point, radius])

  // ------------------------------------------------ verdict
  const verdict = useMemo(() => {
    if (!point || near.loading || !near.data || !allOverlaps.data) return null
    const nearby = near.data
    const keys = new Set(nearby.map(projectKey))
    const dist = Object.fromEntries(nearby.map((n) => [projectKey(n), n.distance_mi]))
    const matched = allOverlaps.data.filter((o) => keys.has(projectKey(o.a)) || keys.has(projectKey(o.b)))
    const inZone = matched.filter((o) => keys.has(projectKey(o.a)) && keys.has(projectKey(o.b)))
    const involvedKeys = new Set(matched.flatMap((o) => [projectKey(o.a), projectKey(o.b)]))
    return {
      nearby,
      dist,
      // Both sides of the pair inside the radius = the coordination zone is right here.
      matched: (inZone.length ? inZone : matched).slice(0, 8),
      kind: inZone.length ? 'zone' : matched.length ? 'edge' : nearby.length ? 'nearby' : 'clear',
      lonely: nearby.filter((n) => !involvedKeys.has(projectKey(n))),
      utilitiesNearby: [...new Set(nearby.map((n) => n.utility_id))],
    }
  }, [point, near.loading, near.data, allOverlaps.data])

  // ------------------------------------------------ map: marker + radius ring + framing
  const drawPoint = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const ring = point ? circle(point.center, radius) : { type: 'FeatureCollection', features: [] }
    setSource(map, 'search-radius', ring)
    if (!map.getLayer('search-radius-fill')) {
      map.addLayer({ id: 'search-radius-fill', type: 'fill', source: 'search-radius', paint: { 'fill-color': PALETTE.pink, 'fill-opacity': 0.06 } }, map.getLayer('project-lines-glow') ? 'project-lines-glow' : undefined)
      map.addLayer({ id: 'search-radius-line', type: 'line', source: 'search-radius', paint: { 'line-color': PALETTE.pink, 'line-width': 1.5, 'line-dasharray': [2, 3] } })
    }
    markerRef.current?.remove()
    markerRef.current = null
    if (point) {
      const el = document.createElement('div')
      el.className = 'h-5 w-5 rounded-full border-[3px] border-white bg-brand-pink shadow-[0_0_0_6px_rgba(240,57,126,0.25)]'
      el.setAttribute('aria-label', 'Search point')
      markerRef.current = new maplibregl.Marker({ element: el }).setLngLat(point.center).addTo(map)
    }
  }, [point, radius])

  const [mapReady, setMapReady] = useState(false)
  useEffect(() => {
    if (mapReady && allProjects.data) drawPoint()
  }, [mapReady, allProjects.data, drawPoint])

  const fit = useMemo(() => (point ? bounds(circle(point.center, radius).geometry.coordinates[0]) : null), [point, radius])

  const run = async (e) => {
    e?.preventDefault()
    if (!query.trim()) return
    setGeoBusy(true)
    setGeoError(null)
    try {
      setPoint(await geocode(query))
    } catch (err) {
      if (err.name !== 'AbortError') setGeoError(err.message)
    } finally {
      setGeoBusy(false)
    }
  }

  const highlight = useMemo(() => (verdict ? verdict.nearby.map(projectKey) : []), [verdict])

  return (
    <Layout active="check" fill>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section className="relative h-[55vh] min-h-[380px] flex-none lg:h-auto lg:flex-1">
          <div className="absolute inset-0">
          <MapView
            className="h-full"
            projects={allProjects.data}
            overlaps={verdict?.matched}
            colors={utils.colors}
            highlight={highlight}
            fit={fit}
            fitOptions={{ padding: { top: 140, bottom: 50, left: 50, right: 70 }, maxZoom: 12.5 }}
            onReady={(map) => {
              mapRef.current = map
              setMapReady(true)
            }}
            onMapClick={(lngLat) => {
              setGeoError(null)
              setQuery('')
              setPoint({ center: [lngLat.lng, lngLat.lat], label: `Map point ${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}` })
            }}
          />
          </div>

          <form onSubmit={run} className="absolute left-1/2 top-4 z-20 w-[min(560px,calc(100%-5rem))] -translate-x-1/2 sm:top-6" role="search">
            <div className="flex gap-2">
              <label className="flex flex-1 items-center gap-2.5 rounded-xl border border-ink-500 bg-ink-800/95 px-4 py-3 shadow-2xl backdrop-blur focus-within:border-brand-pink">
                <Search className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden="true" />
                <span className="sr-only">Address, city, ZIP, or lat, lon</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Address, city, ZIP, or “lat, lon”"
                  className="w-full bg-transparent text-[13px] placeholder:text-fg-faint focus:outline-none"
                />
              </label>
              <button type="submit" className="btn-pink px-5 shadow-2xl" disabled={geoBusy || !query.trim()}>
                {geoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Check'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-fg-faint">Try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => {
                    setGeoError(null)
                    setQuery(ex.label)
                    setPoint(ex)
                  }}
                  className="rounded-full border border-ink-500 bg-ink-800/90 px-2.5 py-1 text-[11px] text-fg-dim hover:border-fg-faint hover:text-fg"
                >
                  {ex.label}
                </button>
              ))}
              <span className="ml-1 flex items-center gap-1 text-[11px] text-fg-faint">
                <Crosshair className="h-3 w-3" aria-hidden="true" /> or click the map
              </span>
            </div>
            {geoError && (
              <p role="alert" className="mt-2 rounded-lg border border-brand-pink/60 bg-ink-800/95 px-3 py-2 text-[12px] text-brand-pink">
                {geoError}
              </p>
            )}
          </form>
        </section>

        <aside className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto border-ink-500 bg-ink-800 lg:w-[440px] lg:flex-none lg:border-l" aria-live="polite">
          <div className="border-b border-ink-500 px-6 py-5">
            <h1 className="mb-1 text-base font-bold">Coordination check</h1>
            <p className="mb-4 text-[12px] text-fg-dim">Is this location inside a zone where two utilities plan work close together? And why?</p>
            <div className="flex items-center gap-2" role="radiogroup" aria-label="Search radius">
              <span className="text-[11.5px] text-fg-faint">Radius</span>
              {RADII.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={radius === r}
                  onClick={() => setRadius(r)}
                  className={`chip ${radius === r ? 'bg-brand-pink text-white' : 'bg-ink-700 text-fg-dim hover:text-fg'}`}
                >
                  {r} mi
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 px-6 py-6">
            {!point && <Intro />}
            {point && (near.error || allOverlaps.error) && <ErrorState error={near.error || allOverlaps.error} onRetry={near.error ? near.reload : allOverlaps.reload} />}
            {point && !verdict && !near.error && !allOverlaps.error && (
              <div className="flex items-center gap-2 text-sm text-fg-dim">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking {radius} mi around {point.label}…
              </div>
            )}
            {verdict && <Verdict v={verdict} point={point} radius={radius} colors={utils.colors} />}
          </div>
        </aside>
      </div>
    </Layout>
  )
}

function Intro() {
  return (
    <div className="space-y-4 text-[12.5px] leading-relaxed text-fg-dim">
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-pink" />
        <p>Search an address or ZIP, pick an example, or click anywhere on the map.</p>
      </div>
      <p>We look up every planned project within the radius (a PostGIS distance query), then check whether any of them belong to a flagged cross-utility overlap. The verdict explains itself with the same signals the ranking uses:</p>
      <ul className="space-y-2">
        <li><b className="text-fg">Distance</b> is the primary signal: under 25 miles counts as an overlap.</li>
        <li><b className="text-fg">Proximity tier</b> says what could be shared, from crews to right-of-way.</li>
        <li><b className="text-fg">Timing</b> is secondary: days between in-service dates, and whether build windows overlap.</li>
        <li><b className="text-fg">Confidence</b> says how sure we are of each location.</li>
      </ul>
    </div>
  )
}

const VERDICTS = {
  zone: { icon: AlertTriangle, color: PALETTE.pink, bg: '#3E1330', title: 'Coordination zone', body: 'Planned projects from different utilities inside this radius have been flagged as a coordination opportunity.' },
  edge: { icon: AlertTriangle, color: PALETTE.amber, bg: '#3F2E12', title: 'Near a coordination zone', body: 'Planned work here pairs with another utility’s project just outside this radius.' },
  nearby: { icon: CheckCircle2, color: PALETTE.sky, bg: '#12304A', title: 'Planned work nearby, no overlap', body: 'There are planned projects here, but none pair with another utility’s project within 25 miles.' },
  clear: { icon: CheckCircle2, color: PALETTE.teal, bg: '#123B37', title: 'No planned work found', body: 'No planned transmission projects in our data within this radius.' },
}

function Verdict({ v, point, radius, colors }) {
  const meta = VERDICTS[v.kind]
  const Icon = meta.icon
  const top = v.matched[0]
  return (
    <div className="animate-in space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: meta.bg }}>
          <Icon className="h-5 w-5" style={{ color: meta.color }} aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-sans text-[15px] font-bold" style={{ color: meta.color }}>
            {meta.title}
          </h2>
          <p className="text-[11.5px] text-fg-faint">
            Within {radius} mi of {point.label}
          </p>
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg-dim">
        {meta.body} {v.nearby.length > 0 && `${v.nearby.length} planned project${v.nearby.length > 1 ? 's' : ''} from ${v.utilitiesNearby.join(' and ')} within ${radius} mi.`}
      </p>

      {top && (
        <div>
          <h3 className="eyebrow mb-2.5 text-fg-faint">Why: strongest signal</h3>
          <ul className="space-y-2.5 text-[12.5px] text-fg-dim">
            <Reason color={tierColor(top.proximity_tier)}>
              <b className="text-fg">{fmtNum(top.center_distance_mi, 2)} mi apart</b> (center to center), closest points {fmtNum(top.closest_distance_km, 2)} km: tier{' '}
              <TierLabel tier={top.proximity_tier} className="!text-[11px]" />. {top.shareable}.
            </Reason>
            <Reason color={top.build_windows_overlap ? PALETTE.teal : PALETTE.faint}>
              <b className="text-fg">{fmtGap(top.in_service_gap_days)}</b> between in-service dates, and the build windows{' '}
              {top.build_windows_overlap ? <b className="text-brand-teal">overlap</b> : 'don’t overlap'}.
            </Reason>
            <Reason color={PALETTE.faint}>
              Location confidence: <ConfidenceBadge level={top.location_confidence} suffix={false} />
              {top.location_confidence === 'low' && ' Treat the exact distance as approximate.'}
              {top.override_involved && ' A location was placed by hand.'}
            </Reason>
            {top.either_already_in_service && <Reason color={PALETTE.faint}>One project’s in-service date has already passed.</Reason>}
          </ul>
        </div>
      )}

      {v.matched.length > 0 && (
        <div>
          <h3 className="eyebrow mb-2.5 text-fg-faint">Flagged pairs ({v.matched.length})</h3>
          <div className="space-y-2">
            {v.matched.map((o) => (
              <a key={o.overlap_id} href={`/overlap/?id=${o.overlap_id}`} className="block rounded-xl bg-ink-700 px-4 py-3 transition-colors hover:bg-ink-600">
                <div className="mb-1.5 flex items-center justify-between">
                  <TierLabel tier={o.proximity_tier} />
                  <span className="text-[10.5px] text-fg-faint">#{o.rank} · {fmtNum(o.center_distance_mi, 1)} mi</span>
                </div>
                <div className="truncate text-[12.5px] font-semibold">
                  <UtilityTag id={o.a.utility_id} colors={colors} /> {tidyName(o.a.name)}
                </div>
                <div className="truncate text-[12.5px] font-semibold">
                  <UtilityTag id={o.b.utility_id} colors={colors} /> {tidyName(o.b.name)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {o.build_windows_overlap && (
                    <Pill tone="teal">
                      <CalendarCheck2 className="h-3 w-3" /> Same build window
                    </Pill>
                  )}
                  {o.override_involved && (
                    <Pill tone="amber">
                      <Hand className="h-3 w-3" /> Hand-placed
                    </Pill>
                  )}
                  {o.user_data_involved && (
                    <Pill tone="purple">
                      <Users className="h-3 w-3" /> Community
                    </Pill>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {v.lonely.length > 0 && (
        <div className="border-t border-ink-500 pt-4">
          <h3 className="eyebrow mb-2.5 text-fg-faint">Also nearby, no flagged overlap</h3>
          <ul className="space-y-1.5">
            {v.lonely.slice(0, 8).map((n) => (
              <li key={projectKey(n)} className="flex justify-between gap-3 text-[12px]">
                <span className="truncate">
                  <UtilityTag id={n.utility_id} colors={colors} /> {tidyName(n.name)}
                </span>
                <span className="shrink-0 text-fg-faint">{fmtNum(n.distance_mi, 1)} mi</span>
              </li>
            ))}
          </ul>
          {v.lonely.length > 8 && <p className="mt-2 text-[11px] text-fg-faint">+{v.lonely.length - 8} more</p>}
        </div>
      )}
    </div>
  )
}

function Reason({ color, children }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span>{children}</span>
    </li>
  )
}
