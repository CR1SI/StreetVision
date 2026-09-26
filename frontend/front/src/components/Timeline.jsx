import { tidyName, yearOf } from '../lib/format'

/**
 * Two build windows on one shared year axis, so it's obvious at a glance whether the crews
 * would be in the field at the same time. Diamonds mark in-service dates; a line marks today.
 */
export function Timeline({ projects, colors }) {
  const rows = projects.map((p) => {
    const isd = yearOf(p.in_service_date)
    const start = p.build_start ?? p.build_end ?? isd
    const end = p.build_end ?? isd ?? p.build_start
    return { p, isd, start, end, isdFrac: fracYear(p.in_service_date) }
  })
  const years = rows.flatMap((r) => [r.start, r.end, r.isd]).filter(Boolean)
  const now = new Date()
  const today = now.getFullYear() + now.getMonth() / 12
  if (!years.length) return <p className="text-[12.5px] text-fg-dim">No build dates published for either project.</p>
  const lo = Math.min(...years, Math.floor(today)) - 1
  const hi = Math.max(...years, Math.floor(today)) + 2
  const x = (y) => `${((y - lo) / (hi - lo)) * 100}%`
  const ticks = []
  const step = hi - lo > 12 ? 2 : 1
  for (let y = lo + 1; y < hi; y += step) ticks.push(y)

  return (
    <div className="select-none" role="img" aria-label={rows.map((r) => `${r.p.utility_id} builds ${r.start ?? '?'} to ${r.end ?? '?'}`).join('; ')}>
      <div className="relative ml-[92px] h-5 text-[10.5px] text-fg-faint">
        {ticks.map((y) => (
          <span key={y} className="absolute -translate-x-1/2" style={{ left: x(y) }}>
            {y}
          </span>
        ))}
      </div>
      <div className="relative">
        {rows.map((r) => (
          <div key={r.p.utility_id + r.p.project_id} className="flex h-10 items-center">
            <div className="w-[92px] shrink-0 truncate pr-3 text-[11.5px] font-bold" style={{ color: colors[r.p.utility_id] }} title={tidyName(r.p.name)}>
              {r.p.utility_id}
            </div>
            <div className="relative h-full flex-1 border-l border-ink-500">
              {ticks.map((y) => (
                <span key={y} className="absolute inset-y-0 w-px bg-ink-600/70" style={{ left: x(y) }} />
              ))}
              {r.start && r.end && (
                <span
                  className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full"
                  style={{ left: x(r.start), width: `calc(${x(r.end + 1)} - ${x(r.start)})`, background: colors[r.p.utility_id], opacity: 0.85 }}
                  title={`Build window ${r.start}–${r.end}`}
                />
              )}
              {r.isdFrac && (
                <span
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-ink-800 bg-fg"
                  style={{ left: x(r.isdFrac) }}
                  title={`In service ${r.p.in_service_date}`}
                />
              )}
            </div>
          </div>
        ))}
        <span className="absolute bottom-0 top-0 w-0.5 bg-brand-pink/80" style={{ left: `calc(92px + (100% - 92px) * ${(today - lo) / (hi - lo)})` }} title="Today" />
      </div>
      <div className="ml-[92px] mt-2 flex gap-4 text-[10.5px] text-fg-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full bg-fg-dim" /> Build window
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rotate-45 bg-fg" /> In service
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-brand-pink" /> Today
        </span>
      </div>
    </div>
  )
}

function fracYear(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? '')
  return m ? +m[1] + (+m[2] - 1) / 12 : null
}
