import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { CONFIDENCE, tierColor, tierLabel } from '../lib/colors'

export function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <circle cx="10" cy="20" r="4.5" fill="#7C6FEF" />
      <circle cx="20" cy="10" r="4.5" fill="#2FD1C0" />
      <line x1="10" y1="20" x2="20" y2="10" stroke="#F0397E" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function ConfidenceBadge({ level, suffix = true, className = '' }) {
  const c = CONFIDENCE[level] ?? CONFIDENCE.none
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${className}`}
      style={{ background: c.bg, color: c.fg }}
      title="How sure we are of the project's location"
    >
      {c.label}
      {suffix && level !== 'none' ? ' confidence' : ''}
    </span>
  )
}

export function TierLabel({ tier, className = '' }) {
  return (
    <span className={`eyebrow ${className}`} style={{ color: tierColor(tier) }}>
      {tierLabel(tier)}
    </span>
  )
}

export function UtilityTag({ id, colors, className = '' }) {
  return (
    <span className={`font-bold ${className}`} style={{ color: colors?.[id] ?? '#8C96AD' }}>
      {id}
    </span>
  )
}

export function Pill({ children, tone = 'default', title, className = '' }) {
  const tones = {
    default: 'bg-ink-600 text-fg-dim',
    teal: 'bg-brand-teal-dim text-brand-teal',
    pink: 'bg-brand-pink-dim text-brand-pink',
    amber: 'bg-brand-amber-dim text-brand-amber',
    purple: 'bg-brand-purple-dim text-[#B3AAF7]',
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 text-sm text-fg-dim ${className}`}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry, className = '' }) {
  return (
    <div role="alert" className={`card flex flex-col items-start gap-3 border-brand-pink/60 p-5 ${className}`}>
      <div className="flex items-center gap-2 text-sm font-bold text-brand-pink">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {error?.status === 404 ? 'Not found' : 'Something went wrong'}
      </div>
      <p className="text-[13px] leading-relaxed text-fg-dim">{error?.message ?? String(error)}</p>
      {onRetry && (
        <button type="button" className="btn-ghost py-2" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-xl bg-ink-700 ${className}`} />
}

export function Stat({ value, label, tone }) {
  return (
    <div className="rounded-xl bg-ink-700 px-4 py-3.5 text-center">
      <div className="font-display text-xl font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-fg-faint">{label}</div>
    </div>
  )
}

export function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[12.5px]">
      <span className="shrink-0 text-fg-faint">{label}</span>
      <span className="text-right font-semibold text-fg">{children}</span>
    </div>
  )
}
