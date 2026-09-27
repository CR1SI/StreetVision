import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, CalendarCheck2, CalendarX2, Check, Hand, Link2, Map as MapIcon, Orbit, Users } from 'lucide-react'
import { Layout } from '../components/Layout'
import { MapView } from '../components/MapView'
import { Timeline } from '../components/Timeline'
import { ConfidenceBadge, ErrorState, Pill, Row, Skeleton, Stat, TierLabel, UtilityTag } from '../components/ui'
import { param, useAsync } from '../hooks/useAsync'
import { useUtilities } from '../hooks/useUtilities'
import { api } from '../lib/api'
import { CONFIDENCE, tierColor } from '../lib/colors'
import { fmtDate, fmtDistance, fmtGap, fmtNum, fmtUsd, tidyName } from '../lib/format'
import { bounds, midpoint } from '../lib/geo'
import { projectKey } from '../lib/mapLayers'
import { TypeIcon, typeLabel } from '../lib/projectTypes'

const DEFAULT_LAND_COST = 10000

export default function Overlap() {
  const id = param('id')
  const utils = useUtilities()
  const [landCost, setLandCost] = useState(Number(param('land_cost')) || DEFAULT_LAND_COST)
  const [landDraft, setLandDraft] = useState(String(landCost))
  const [copied, setCopied] = useState(false)

  // Debounce the land-cost field so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const n = Number(landDraft)
      if (n > 0) setLandCost(n)
    }, 400)
    return () => clearTimeout(t)
  }, [landDraft])

  const detail = useAsync(
    (signal) => (id ? api.overlap(id, { land_cost_per_acre: landCost }, { signal }) : Promise.reject(Object.assign(new Error('No overlap selected. Open one from the ranked list on the map.'), { status: 404 }))),
    [id, landCost],
  )
  const o = detail.data
  useEffect(() => {
    if (o) document.title = `${tidyName(o.a.name)} × ${tidyName(o.b.name)} · StreetVision`
  }, [o])

  // Both projects' real geometries for the inset map.
  const pair = useAsync(
    (signal) => {
      if (!o) return Promise.resolve(null)
      const pa = o.project_a ?? o.a
      const pb = o.project_b ?? o.b
      return api.projects({ utilities: [pa.utility_id, pb.utility_id] }, { signal })
    },
    [o?.overlap_id],
  )
  const pairFc = useMemo(() => {
    if (!pair.data || !o) return null
    const pa = o.project_a ?? o.a
    const pb = o.project_b ?? o.b
    const keys = [projectKey(pa), projectKey(pb)]
    return { ...pair.data, features: pair.data.features.filter((f) => keys.includes(projectKey(f.properties))) }
  }, [pair.data, o])
  const pairOverlaps = useMemo(() => (o ? [o] : undefined), [o])
  const fit = useMemo(() => (pairFc ? bounds([...pairFc.features, ...(o ? o.connector : [])]) : null), [pairFc, o])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked: the URL bar still has it */
    }
  }

  return (
    <Layout active="home">
      <div className="mx-auto flex max-w-[1440px] flex-col lg:flex-row">
        <div className="min-w-0 flex-1 px-4 py-8 sm:px-10">
          <div className="mb-5 flex items-center justify-between gap-3">
            <a href={o ? `/?overlap=${o.overlap_id}` : '/'} className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-dim hover:text-fg">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to the map
            </a>
            {o && (
              <button type="button" onClick={copyLink} className="btn-ghost py-1.5 text-xs">
                {copied ? <Check className="h-3.5 w-3.5 text-brand-teal" /> : <Link2 className="h-3.5 w-3.5" />}
                {copied ? 'Link copied' : 'Copy link'}
              </button>
            )}
          </div>

          {detail.error && <ErrorState error={detail.error} onRetry={id ? detail.reload : undefined} />}
          {!o && !detail.error && (
            <div className="space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-44" />
                <Skeleton className="h-44" />
              </div>
              <Skeleton className="h-20" />
            </div>
          )}

          {o && (
            <div className="animate-in">
              <div className="mb-2 flex flex-wrap items-center gap-2.5">
                <span className="rounded-lg px-2.5 py-1 text-[11px] font-bold" style={{ background: `${tierColor(o.proximity_tier)}22`, color: tierColor(o.proximity_tier) }}>
                  RANK {o.rank} · <TierLabel tier={o.proximity_tier} className="!text-inherit" />
                </span>
                <span className="rounded-lg bg-ink-700 px-2.5 py-1 text-[11px] font-bold text-fg-dim">Score {fmtNum(o.score, 3)}</span>
                <span className="rounded-lg bg-ink-700 px-2.5 py-1 text-[11px] font-bold text-fg-faint">{o.label}</span>
              </div>
              <h1 className="mb-7 mt-2 text-2xl font-bold leading-snug sm:text-[26px]">
                {tidyName(o.a.name)} <span className="font-medium text-fg-faint">×</span> {tidyName(o.b.name)}
              </h1>

              <div className="mb-6 grid gap-4 md:grid-cols-2">
                {[o.project_a ?? o.a, o.project_b ?? o.b].map((p) => (
                  <ProjectCard key={projectKey(p)} p={p} colors={utils.colors} name={utils.names[p.utility_id]} />
                ))}
              </div>

              <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat value={`${fmtNum(o.center_distance_mi, 2)} mi`} label="Center distance (official)" />
                <Stat value={fmtDistance(o.closest_distance_mi)} label="Closest points" />
                <Stat value={o.in_service_gap_days === null ? '—' : fmtNum(o.in_service_gap_days)} label="Days between in-service" />
                <Stat value={CONFIDENCE[o.location_confidence]?.label} label="Location confidence" tone={CONFIDENCE[o.location_confidence]?.fg} />
              </div>

              <div className="mb-6 rounded-xl border px-5 py-4" style={{ borderColor: tierColor(o.proximity_tier), background: `${tierColor(o.proximity_tier)}14` }}>
                <div className="mb-1 flex items-center gap-2 text-[13px] font-bold">
                  <AlertTriangle className="h-4 w-4" style={{ color: tierColor(o.proximity_tier) }} aria-hidden="true" />
                  What could be shared
                </div>
                <p className="text-[13px] text-fg/90">
                  {o.shareable}. The closest points of the two projects are {fmtDistance(o.closest_distance_mi)} apart ({o.proximity_tier}).
                </p>
              </div>

              <section className="card mb-6 p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[15px] font-bold">Timing</h2>
                  <Pill tone={o.build_windows_overlap ? 'teal' : 'default'}>
                    {o.build_windows_overlap ? <CalendarCheck2 className="h-3 w-3" /> : <CalendarX2 className="h-3 w-3" />}
                    {o.build_windows_overlap ? 'Build windows overlap' : 'Build windows don’t overlap'}
                  </Pill>
                </div>
                <Timeline projects={[o.project_a ?? o.a, o.project_b ?? o.b]} colors={utils.colors} />
                <p className="mt-4 text-[12.5px] text-fg-dim">
                  {fmtGap(o.in_service_gap_days)} between in-service dates.{' '}
                  {o.either_already_in_service && 'At least one project’s in-service date has already passed, so this may be a lesson for the next project rather than a live opportunity.'}
                </p>
              </section>

              <section className="card mb-6 p-5">
                <h2 className="mb-1 text-[15px] font-bold">Shared right-of-way estimate</h2>
                {o.shared_row_acres_upper_bound === null ? (
                  <p className="text-[12.5px] leading-relaxed text-fg-dim">
                    Only computed when both projects are lines within 1 mi of each other (they could share a corridor). This pair doesn’t qualify, so the value
                    here is shared crews and logistics rather than land.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <div className="font-display text-2xl font-bold">
                        {fmtNum(o.shared_row_acres_upper_bound, 1)} acres <span className="text-lg text-brand-teal">≈ {fmtUsd(o.shared_row_value_usd)}</span>
                      </div>
                      <p className="mt-1 text-[11.5px] text-fg-faint">Upper bound: shorter line × 100 ft corridor × land cost per acre.</p>
                    </div>
                    <label className="w-44">
                      <span className="label">Land cost per acre (USD)</span>
                      <input type="number" min="1" step="500" className="input" value={landDraft} onChange={(e) => setLandDraft(e.target.value)} />
                    </label>
                  </div>
                )}
              </section>

              <div className="flex flex-wrap gap-1.5">
                {o.override_involved && (
                  <Pill tone="amber">
                    <Hand className="h-3 w-3" /> A location was placed by hand
                  </Pill>
                )}
                {o.user_data_involved && (
                  <Pill tone="purple">
                    <Users className="h-3 w-3" /> Includes community-submitted data
                  </Pill>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Inset map */}
        <aside className="flex h-[440px] flex-col border-ink-500 lg:sticky lg:top-0 lg:h-[calc(100vh-4rem)] lg:w-[440px] lg:shrink-0 lg:border-l">
          <MapView className="min-h-0 flex-1" projects={pairFc} overlaps={pairOverlaps} colors={utils.colors} highlight={o ? [projectKey(o.project_a ?? o.a), projectKey(o.project_b ?? o.b)] : []} fit={fit} fitOptions={{ padding: 70, maxZoom: 13 }}>
            {({ startOrbit, stopOrbit, orbiting, fitBounds }) =>
              o && (
                <div className="absolute left-3 top-3 z-10 flex gap-2">
                  <button type="button" className="btn-ghost bg-ink-800/95 py-1.5 text-xs" onClick={() => (orbiting ? stopOrbit() : startOrbit(midpoint(o.connector), 12))}>
                    <Orbit className="h-3.5 w-3.5" /> {orbiting ? 'Stop' : 'Orbit'}
                  </button>
                  <button type="button" className="btn-ghost bg-ink-800/95 py-1.5 text-xs" onClick={() => fitBounds(fit, { padding: 70, maxZoom: 13, pitch: 0, bearing: 0 })}>
                    <MapIcon className="h-3.5 w-3.5" /> Reset view
                  </button>
                </div>
              )
            }
          </MapView>
          <p className="shrink-0 border-t border-ink-500 bg-ink-800 px-4 py-2.5 text-[11px] text-fg-faint">
            Lines are straight segments between substations, not surveyed routes.
          </p>
        </aside>
      </div>
    </Layout>
  )
}

function ProjectCard({ p, colors, name }) {
  const color = colors[p.utility_id]
  return (
    <article className="card p-5" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="eyebrow mb-2">
        <UtilityTag id={p.utility_id} colors={colors} /> <span className="text-fg-faint">· {name ?? p.utility_id} · {p.project_id}</span>
      </div>
      <h3 className="mb-2 font-sans text-[15px] font-bold leading-snug">{tidyName(p.name)}</h3>
      {p.description && <p className="mb-4 text-[12.5px] leading-relaxed text-fg-dim">{p.description}</p>}
      <div className="space-y-1.5">
        <Row label="Type">
          <span className="inline-flex items-center gap-1.5"><TypeIcon type={p.project_type} className="h-3.5 w-3.5 text-fg-dim" />{typeLabel(p.project_type)}</span>
        </Row>
        {(p.endpoint_a || p.endpoint_b) && <Row label="Substations">{[p.endpoint_a, p.endpoint_b].filter(Boolean).join(' – ')}</Row>}
        <Row label="In service">{fmtDate(p.in_service_date)}</Row>
        {p.in_service_date_updated && p.in_service_date_updated !== p.in_service_date && <Row label="Updated (newer edition)">{fmtDate(p.in_service_date_updated)}</Row>}
        <Row label="Build window">{p.build_start || p.build_end ? `${p.build_start ?? '?'} – ${p.build_end ?? '?'}` : 'Not published'}</Row>
        {p.kv && <Row label="Voltage">{p.kv} kV</Row>}
        {p.status && <Row label="Status">{p.status}</Row>}
        <Row label="Location">
          <ConfidenceBadge level={p.location_confidence} />
        </Row>
        <Row label="Source">{p.source_kind === 'official' ? 'Official filing' : <span className="text-[#B3AAF7]">Community submitted</span>}</Row>
      </div>
      {(p.confidence_note || p.is_override) && (
        <p className="mt-3 rounded-lg bg-ink-700 px-3 py-2 text-[11.5px] text-fg-dim">
          {p.is_override && <b className="text-brand-amber">Hand-placed location. </b>}
          {p.confidence_note}
        </p>
      )}
    </article>
  )
}
