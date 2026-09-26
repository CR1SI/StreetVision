import { ExternalLink } from 'lucide-react'
import { Layout } from '../components/Layout'
import { useAsync } from '../hooks/useAsync'
import { api } from '../lib/api'
import { TIERS } from '../lib/colors'
import { fmtNum } from '../lib/format'

const STEPS = [
  ['Find each project’s center point', 'The midpoint between its two named substations, or the single point if only one is located (multi-segment projects: the mean of their endpoints).'],
  ['Measure the straight-line distance', 'Great-circle distance between the centers of every pair of projects owned by two different utilities.'],
  ['Flag pairs under 25 miles', 'This is the primary signal. Most pairs will not qualify, by design.'],
  ['Record the timing gap', 'Days between the two in-service dates: a secondary signal, weighed alongside distance and never instead of it.'],
  ['Rank the opportunities', 'Score = 0.7 × (1 − distance / 25 mi) + 0.3 × (1 − gap / 1,095 days, capped). Higher means closer in space and time.'],
]

const ASSUMPTIONS = [
  'Lines are drawn as straight segments between endpoint substations, not surveyed routes.',
  'DESC build window = years with more than $500k planned spend; Georgia Power = detail-page Start Date to Need Date.',
  'The DESC 2024–2028 edition is the baseline; newer-edition dates are kept alongside as “updated” dates.',
  'Impossible dates in the DESC filing (e.g. 04/31/26) are clamped to month end.',
  'Georgia Power + SAV sponsors = Georgia Power (SAV is the former Savannah Electric); GTC, MEAG and DU projects are excluded.',
  'Shared right-of-way = shorter line × 100 ft corridor × a land cost per acre: an upper bound, only for two lines within 1.6 km.',
  'Low-confidence OpenStreetMap matches are flagged; substations not in OSM are placed by hand and marked as such.',
  'Only public filings are used: no Critical Energy Infrastructure Information (CEII), and redacted costs are never estimated.',
  'Community-submitted data is labeled everywhere and can be filtered out with Source → Official filings.',
]

export default function About() {
  const health = useAsync((signal) => api.health({ signal }), [])
  const h = health.data
  return (
    <Layout active="about">
      <article className="mx-auto max-w-[820px] px-5 pb-16 pt-12">
        <p className="eyebrow mb-3 text-brand-teal">About StreetVision</p>
        <h1 className="mb-5 text-[28px] font-bold leading-tight sm:text-[32px]">How StreetVision finds coordination opportunities</h1>
        <p className="mb-4 text-[14px] leading-7 text-fg-dim">
          Utilities plan future construction years in advance (new lines, substation upgrades), often without visibility into what a neighboring utility is
          doing nearby. FERC Order No. 1920 (2024) exists because planning in isolation leads to duplicated, inefficient work.
        </p>
        <p className="mb-10 text-[14px] leading-7 text-fg-dim">
          StreetVision is a hackathon-sized version of that coordination problem. It compares the public construction plans of two or more utilities (starting
          with Dominion Energy South Carolina and Georgia Power, which share the Savannah River border) and flags where their planned work is close enough to
          share crews, equipment, or right-of-way.
        </p>

        <div className="mb-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Utilities', h?.utilities],
            ['Datasets', h?.datasets],
            ['Projects mapped', h?.projects],
            ['Overlaps found', h?.overlaps],
          ].map(([l, v]) => (
            <div key={l} className="card px-4 py-3 text-center">
              <div className="font-display text-xl font-bold">{v === undefined ? (health.error ? '—' : '…') : fmtNum(v)}</div>
              <div className="text-[11px] text-fg-faint">{l}</div>
            </div>
          ))}
        </div>

        <h2 className="mb-4 text-lg font-bold">Data sources</h2>
        <div className="mb-12 grid gap-4 sm:grid-cols-2">
          <Source color="#7C6FEF" title="Dominion Energy South Carolina">
            SCRTP “Planned Transmission Projects $2M and above”: the 2024–2028 edition as the baseline, with the 2026–2030 edition’s updated dates alongside.
          </Source>
          <Source color="#2FD1C0" title="Georgia Power">
            2025 IRP Volume 3 (public disclosure), Georgia ITS 10-Year Plan, Table 2 plus the per-project detail pages for start and need dates.
          </Source>
          <Source color="#F0397E" title="Coordinates">
            OpenStreetMap substations (Overpass API), fuzzy-matched to project endpoints, then reviewed by hand against each filing’s zone and description.
          </Source>
          <Source color="#FBBF63" title="Community data">
            Any utility can add its own planned projects through the Contribute page, in the same standard format and validation as the official data.
          </Source>
        </div>

        <h2 className="mb-5 text-lg font-bold">Our method</h2>
        <ol className="mb-12 space-y-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-600 text-[12px] font-bold text-fg-dim">{i + 1}</span>
              <p className="pt-0.5 text-[13.5px] leading-6 text-fg-dim">
                <b className="text-fg">{t}.</b> {d}
              </p>
            </li>
          ))}
        </ol>

        <h2 className="mb-2 text-lg font-bold">Proximity tiers</h2>
        <p className="mb-4 text-[13px] text-fg-dim">
          Beyond the official center-to-center distance, we measure how close the two projects’ nearest points come. That tells a planner what could actually be
          shared:
        </p>
        <div className="card mb-12 overflow-hidden">
          {TIERS.map((t) => (
            <div key={t.key} className="flex items-center gap-4 border-b border-ink-500 px-5 py-3.5 last:border-b-0">
              <span className="w-6 border-t-[3px] border-dashed" style={{ borderColor: t.color }} />
              <span className="w-40 shrink-0 text-[13px] font-bold" style={{ color: t.color }}>
                {t.label}
              </span>
              <span className="text-[13px] text-fg-dim">{t.share}</span>
            </div>
          ))}
        </div>

        <h2 className="mb-3 text-lg font-bold">Why most pairs don’t overlap</h2>
        <p className="mb-12 text-[13.5px] leading-7 text-fg-dim">
          That’s expected, not a bug. Two utilities’ territories only meet along part of their range: for DESC and Georgia Power, the Savannah River corridor
          around Augusta and Savannah. Finding the handful of pairs that genuinely sit close together, out of every possible combination, is the point of the
          exercise.
        </p>

        <h2 className="mb-4 text-lg font-bold">Assumptions &amp; limitations</h2>
        <ul className="mb-12 space-y-2.5">
          {ASSUMPTIONS.map((a) => (
            <li key={a} className="flex gap-3 text-[13px] leading-6 text-fg-dim">
              <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-fg-faint" />
              {a}
            </li>
          ))}
        </ul>

        <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-sans text-[14px] font-bold">Build on the API</h2>
            <p className="text-[12.5px] text-fg-dim">Every number on this site comes from the public FastAPI endpoints, documented interactively.</p>
          </div>
          <a href={api.docsUrl} className="btn-ghost">
            API docs <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </article>
    </Layout>
  )
}

function Source({ color, title, children }) {
  return (
    <div className="card p-5" style={{ borderLeft: `3px solid ${color}` }}>
      <h3 className="mb-1.5 font-sans text-[13.5px] font-bold">{title}</h3>
      <p className="text-[12.5px] leading-6 text-fg-dim">{children}</p>
    </div>
  )
}
