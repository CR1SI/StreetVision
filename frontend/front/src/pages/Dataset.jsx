import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FileJson, FileSpreadsheet, Loader2, Map as MapIcon, Table2 } from 'lucide-react'
import { Layout } from '../components/Layout'
import { MapView } from '../components/MapView'
import { ConfidenceBadge, ErrorState, Row, Skeleton } from '../components/ui'
import { param, useAsync } from '../hooks/useAsync'
import { useUtilities } from '../hooks/useUtilities'
import { api } from '../lib/api'
import { fmtDate, fmtDateTime, fmtNum, tidyName } from '../lib/format'
import { bounds } from '../lib/geo'
import { datasetFeatures, downloadDataset } from '../lib/datasetDownload'

export default function Dataset() {
  const id = Number(param('id'))
  const utils = useUtilities()
  const [view, setView] = useState(param('view') === 'table' ? 'table' : 'map')
  const [busy, setBusy] = useState(null)
  const [dlError, setDlError] = useState(null)

  // There's no single-dataset endpoint, so find it in the list.
  const ds = useAsync(
    async (signal) => {
      const all = await api.datasets({}, { signal })
      const d = all.find((x) => x.dataset_id === id)
      if (!d) throw Object.assign(new Error(id ? `No dataset ${id}. It may have been deleted.` : 'No dataset selected.'), { status: 404 })
      return d
    },
    [id],
  )
  const d = ds.data
  useEffect(() => {
    if (d) document.title = `${d.source_name} · StreetVision`
  }, [d])

  const features = useAsync((signal) => (d ? datasetFeatures(d, signal) : Promise.resolve(null)), [d?.dataset_id])
  const overlaps = useAsync((signal) => (d ? api.overlaps({ utilities: d.utility_id, limit: 2000 }, { signal }) : Promise.resolve(null)), [d?.utility_id])

  const fc = useMemo(() => (features.data ? { type: 'FeatureCollection', features: features.data } : null), [features.data])
  const fit = useMemo(() => (features.data?.length ? bounds(features.data) : null), [features.data])
  const keys = useMemo(() => new Set((features.data ?? []).map((f) => f.properties.project_id)), [features.data])
  const involved = useMemo(
    () =>
      (overlaps.data ?? []).filter(
        (o) => (o.a.utility_id === d?.utility_id && keys.has(o.a.project_id)) || (o.b.utility_id === d?.utility_id && keys.has(o.b.project_id)),
      ),
    [overlaps.data, keys, d],
  )
  const confCounts = useMemo(() => {
    const c = {}
    for (const f of features.data ?? []) c[f.properties.location_confidence] = (c[f.properties.location_confidence] ?? 0) + 1
    return c
  }, [features.data])

  const get = async (format) => {
    setBusy(format)
    setDlError(null)
    try {
      await downloadDataset(d, format)
    } catch (e) {
      setDlError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const official = d?.kind === 'official'
  const color = d ? utils.colors[d.utility_id] : undefined

  return (
    <Layout active="data" fill>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* Item panel */}
        <aside className="scroll-thin shrink-0 overflow-y-auto border-ink-500 bg-ink-900 px-6 py-7 lg:w-[400px] lg:border-r">
          <a href="/data/" className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] text-fg-dim hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to catalog
          </a>
          {ds.error && <ErrorState error={ds.error} onRetry={ds.reload} />}
          {!d && !ds.error && (
            <div className="space-y-3">
              <Skeleton className="h-7 w-4/5" />
              <Skeleton className="h-24" />
              <Skeleton className="h-48" />
            </div>
          )}
          {d && (
            <div className="animate-in">
              <h1 className="mb-3 text-xl font-bold leading-snug">{d.source_name}</h1>
              <div className="mb-5 flex items-center gap-2.5">
                <span className="h-7 w-7 rounded-lg" style={{ background: `${color}33`, boxShadow: `inset 0 0 0 2px ${color}` }} />
                <div>
                  <div className="text-[13px] font-semibold">{utils.names[d.utility_id] ?? d.utility_id}</div>
                  <div className="text-[11px] text-fg-faint">{official ? 'Official utility filing' : 'Community submitted'}</div>
                </div>
              </div>
              <p className="mb-6 text-[12.5px] leading-relaxed text-fg-dim">
                {official
                  ? `Planned transmission projects extracted from ${utils.names[d.utility_id] ?? d.utility_id}'s public filing, geocoded against OpenStreetMap and reviewed by hand. Only public fields are used; redacted costs are never estimated.`
                  : `Planned projects uploaded by ${d.submitted_by || 'a contributor'} through the public contribution form, with a public-data / no-CEII attestation. Community data is labeled everywhere it appears.`}
                {d.notes && <span className="mt-2 block text-fg">“{d.notes}”</span>}
              </p>

              <div className="mb-7 flex gap-2">
                <a href={`/?utilities=${d.utility_id}`} className="btn flex-1" style={{ background: color, color: '#0A0F1C' }}>
                  <MapIcon className="h-4 w-4" /> View on main map
                </a>
                <button type="button" className="btn-ghost px-3" onClick={() => get('geojson')} disabled={!!busy} title="Download GeoJSON" aria-label="Download GeoJSON">
                  {busy === 'geojson' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
                </button>
                <button type="button" className="btn-ghost px-3" onClick={() => get('csv')} disabled={!!busy} title="Download CSV" aria-label="Download CSV">
                  {busy === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                </button>
              </div>

              {dlError && (
                <p role="alert" className="-mt-5 mb-5 text-[11.5px] text-brand-pink">
                  Download failed: {dlError}
                </p>
              )}
              <div className="space-y-3.5 border-t border-ink-500 pt-5">
                <Row label="Dataset type">Planned transmission projects</Row>
                <Row label="Utility ID">{d.utility_id}</Row>
                <Row label="Dataset ID">{d.dataset_id}</Row>
                <Row label={official ? 'Loaded' : 'Submitted'}>{fmtDateTime(d.created_at)}</Row>
                <Row label="Records">
                  <button type="button" className="font-bold text-brand-teal hover:underline" onClick={() => setView('table')}>
                    {fmtNum(d.projects)} · View data table
                  </button>
                </Row>
                <Row label="Cross-utility overlaps">{overlaps.data ? fmtNum(involved.length) : '…'}</Row>
                <Row label="Location confidence">
                  <span className="flex flex-wrap justify-end gap-1">
                    {['high', 'medium', 'low', 'none']
                      .filter((k) => confCounts[k])
                      .map((k) => (
                        <span key={k} className="inline-flex items-center gap-1">
                          <ConfidenceBadge level={k} suffix={false} /> {confCounts[k]}
                        </span>
                      ))}
                  </span>
                </Row>
                <Row label="Access">
                  <span className="text-brand-teal">Public: anyone can view</span>
                </Row>
                <Row label="License">{official ? 'Public regulatory filing' : 'Contributor-attested public data'}</Row>
              </div>
            </div>
          )}
        </aside>

        {/* Map / table */}
        <section className="relative flex min-h-[420px] flex-1 flex-col">
          <div className="absolute right-14 top-3 z-20 flex overflow-hidden rounded-lg border border-ink-500 bg-ink-800/95" role="tablist" aria-label="View">
            {[
              ['map', 'Map', MapIcon],
              ['table', 'Table', Table2],
            ].map(([v, l, Icon]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold ${view === v ? 'bg-ink-600 text-fg' : 'text-fg-dim hover:text-fg'}`}>
                <Icon className="h-3.5 w-3.5" /> {l}
              </button>
            ))}
          </div>
          {d && (
            <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-lg border border-ink-500 bg-ink-800/95 px-3 py-1.5 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full" style={{ background: color }} /> Showing: {d.source_name.length > 40 ? `${utils.names[d.utility_id]} dataset` : d.source_name}
            </div>
          )}
          {view === 'map' && <MapView className="flex-1" projects={fc} colors={utils.colors} fit={fit} fitOptions={{ padding: 70 }} />}
          {view === 'table' && <ProjectTable features={features.data} loading={features.loading} involved={involved} />}
        </section>
      </div>
    </Layout>
  )
}

function ProjectTable({ features, loading, involved }) {
  const [sort, setSort] = useState({ key: 'in_service_date', dir: 1 })
  const counts = useMemo(() => {
    const c = {}
    for (const o of involved) for (const s of [o.a, o.b]) c[`${s.utility_id}|${s.project_id}`] = (c[`${s.utility_id}|${s.project_id}`] ?? 0) + 1
    return c
  }, [involved])
  const rows = useMemo(() => {
    const r = (features ?? []).map((f) => ({ ...f.properties, overlaps: counts[`${f.properties.utility_id}|${f.properties.project_id}`] ?? 0 }))
    return r.sort((a, b) => {
      const x = a[sort.key] ?? ''
      const y = b[sort.key] ?? ''
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
    })
  }, [features, counts, sort])
  if (loading && !features) return <Skeleton className="m-6 flex-1" />
  const cols = [
    ['project_id', 'ID'],
    ['name', 'Project'],
    ['kv', 'kV'],
    ['in_service_date', 'In service'],
    ['location_confidence', 'Location'],
    ['overlaps', 'Overlaps'],
  ]
  return (
    <div className="scroll-thin flex-1 overflow-auto bg-ink px-4 pb-6 pt-16 sm:px-6">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-[12.5px]">
        <thead>
          <tr>
            {cols.map(([k, l]) => (
              <th key={k} scope="col" className="sticky top-0 border-b border-ink-500 bg-ink px-3 py-2.5 font-semibold text-fg-faint">
                <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }))} className="flex items-center gap-1 hover:text-fg">
                  {l} {sort.key === k ? (sort.dir > 0 ? '↑' : '↓') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.project_id} className="hover:bg-ink-800">
              <td className="border-b border-ink-700 px-3 py-2.5 font-mono text-[11.5px] text-fg-dim">{p.project_id}</td>
              <td className="border-b border-ink-700 px-3 py-2.5">
                <div className="font-semibold">{tidyName(p.name)}</div>
                {p.description && <div className="line-clamp-1 max-w-xl text-[11.5px] text-fg-faint">{p.description}</div>}
              </td>
              <td className="border-b border-ink-700 px-3 py-2.5 text-fg-dim">{p.kv ?? '—'}</td>
              <td className="whitespace-nowrap border-b border-ink-700 px-3 py-2.5 text-fg-dim">{fmtDate(p.in_service_date)}</td>
              <td className="border-b border-ink-700 px-3 py-2.5">
                <ConfidenceBadge level={p.location_confidence} suffix={false} />
              </td>
              <td className="border-b border-ink-700 px-3 py-2.5 font-semibold">{p.overlaps || <span className="text-fg-faint">0</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
