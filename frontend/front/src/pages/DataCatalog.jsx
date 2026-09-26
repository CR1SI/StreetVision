import { useMemo, useState } from 'react'
import { Download, FileJson, FileSpreadsheet, Loader2, Plus, Search, ShieldCheck } from 'lucide-react'
import { Layout } from '../components/Layout'
import { ErrorState, Row, Skeleton } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useUtilities } from '../hooks/useUtilities'
import { api } from '../lib/api'
import { fmtDateTime, fmtNum } from '../lib/format'
import { downloadDataset } from '../lib/datasetDownload'

const TABS = [
  { v: 'all', l: 'All' },
  { v: 'official', l: 'Official filings' },
  { v: 'user_submitted', l: 'Community submitted' },
]

export default function DataCatalog() {
  const utils = useUtilities()
  const datasets = useAsync((signal) => api.datasets({}, { signal }), [])
  const health = useAsync((signal) => api.health({ signal }), [])
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('all')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (datasets.data ?? [])
      .filter((d) => tab === 'all' || d.kind === tab)
      .filter(
        (d) =>
          !needle ||
          [d.utility_id, d.source_name, utils.names[d.utility_id], d.submitted_by, d.notes].some((s) => s && s.toLowerCase().includes(needle)),
      )
  }, [datasets.data, q, tab, utils.names])

  const h = health.data
  return (
    <Layout active="data">
      <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-10">
        <div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <h1 className="mb-1.5 text-2xl font-bold">Data catalog</h1>
            <p className="max-w-2xl text-[13px] text-fg-dim">
              Every planned-project dataset behind StreetVision: official utility filings and community-submitted data. All public, no account needed to
              browse or download.
            </p>
          </div>
          <label className="flex w-full items-center gap-2.5 rounded-xl border border-ink-500 bg-ink-800 px-3.5 py-2.5 focus-within:border-brand-teal md:w-80">
            <Search className="h-4 w-4 text-fg-faint" aria-hidden="true" />
            <span className="sr-only">Search datasets</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search datasets, utilities…" className="w-full bg-transparent text-[13px] placeholder:text-fg-faint focus:outline-none" />
          </label>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Utilities', h?.utilities],
            ['Datasets', h?.datasets],
            ['Projects mapped', h?.projects],
            ['Overlaps found', h?.overlaps],
          ].map(([label, v]) => (
            <div key={label} className="card px-4 py-3">
              <div className="font-display text-xl font-bold">{v === undefined ? '…' : fmtNum(v)}</div>
              <div className="text-[11px] text-fg-faint">{label}</div>
            </div>
          ))}
        </div>

        <div className="mb-5 flex gap-1.5" role="tablist" aria-label="Filter by source">
          {TABS.map((t) => (
            <button
              key={t.v}
              type="button"
              role="tab"
              aria-selected={tab === t.v}
              onClick={() => setTab(t.v)}
              className={`chip ${tab === t.v ? 'bg-ink-600 text-fg' : 'text-fg-dim hover:text-fg'}`}
            >
              {t.l}
            </button>
          ))}
        </div>

        {datasets.error && <ErrorState error={datasets.error} onRetry={datasets.reload} />}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {datasets.loading && !datasets.data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}
          {shown.map((d) => (
            <DatasetCard key={d.dataset_id} d={d} color={utils.colors[d.utility_id]} name={utils.names[d.utility_id]} />
          ))}
          {datasets.data && shown.length === 0 && (
            <div className="card p-6 text-sm text-fg-dim md:col-span-2 xl:col-span-3">No datasets match “{q}”.</div>
          )}
          <a
            href="/contribute/"
            className="flex min-h-40 items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-ink-500 p-6 text-fg-dim transition-colors hover:border-brand-teal hover:text-fg md:col-span-2 xl:col-span-3"
          >
            <Plus className="h-5 w-5 text-fg-faint" aria-hidden="true" />
            <span className="text-[13.5px] font-semibold">Contribute your utility’s planned-project data</span>
          </a>
        </div>
      </div>
    </Layout>
  )
}

function initials(name, id) {
  const words = (name || id).replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || id).slice(0, 2)).toUpperCase()
}

function DatasetCard({ d, color, name }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const official = d.kind === 'official'
  const get = async (format) => {
    setBusy(format)
    setErr(null)
    try {
      await downloadDataset(d, format)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <article className="card flex flex-col p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-extrabold" style={{ background: `${color}26`, color }}>
          {initials(name, d.utility_id)}
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-sans text-[15px] font-bold">{name ?? d.utility_id}</h2>
          <div className="text-[11.5px] text-fg-faint">{official ? 'Official utility filing' : 'Community submitted'}</div>
        </div>
      </div>
      <p className="mb-5 flex-1 text-[12.5px] leading-relaxed text-fg-dim">{d.source_name}</p>
      <div className="mb-5 space-y-2">
        <Row label="Records">{fmtNum(d.projects)} projects</Row>
        <Row label={official ? 'Loaded' : 'Submitted'}>{fmtDateTime(d.created_at)}</Row>
        {!official && d.submitted_by && <Row label="Submitted by">{d.submitted_by}</Row>}
        <Row label={official ? 'License' : 'Attestation'}>
          {official ? (
            'Public regulatory filing'
          ) : (
            <span className="inline-flex items-center gap-1 text-brand-teal">
              <ShieldCheck className="h-3.5 w-3.5" /> Public, no CEII
            </span>
          )}
        </Row>
      </div>
      <div className="flex gap-2">
        <a href={`/dataset/?id=${d.dataset_id}`} className="btn flex-1 font-bold" style={{ background: color, color: '#0A0F1C' }}>
          View dataset
        </a>
        <button type="button" className="btn-ghost px-3" onClick={() => get('geojson')} disabled={!!busy} aria-label="Download GeoJSON" title="Download GeoJSON">
          {busy === 'geojson' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
        </button>
        <button type="button" className="btn-ghost px-3" onClick={() => get('csv')} disabled={!!busy} aria-label="Download CSV" title="Download CSV">
          {busy === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        </button>
      </div>
      {err && (
        <p role="alert" className="mt-2 flex items-center gap-1 text-[11.5px] text-brand-pink">
          <Download className="h-3 w-3" /> {err}
        </p>
      )}
    </article>
  )
}
