import { forwardRef } from 'react'
import { CalendarCheck2, Hand, Users } from 'lucide-react'
import { fmtGap, fmtNum, tidyName } from '../lib/format'
import { ConfidenceBadge, Pill, TierLabel, UtilityTag } from './ui'

/** One row of the ranked coordination list. Works for stored and live (radius > 25 mi) results. */
export const OverlapCard = forwardRef(function OverlapCard({ o, colors, selected, onSelect, compact = false }, ref) {
  const live = o.overlap_id === undefined || o.overlap_id === null
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group block w-full rounded-xl px-4 pb-3 pt-3.5 text-left transition-colors ${
        selected ? 'bg-ink-600 shadow-[inset_3px_0_0_#F0397E]' : 'bg-ink-700 shadow-[inset_3px_0_0_transparent] hover:bg-[#1B2641]'
      }`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-ink-600 px-1 text-[10.5px] font-bold text-fg-dim group-aria-pressed:bg-ink-500">
            {o.rank}
          </span>
          {live ? <span className="eyebrow text-[#C4B5FD]">Live · {fmtNum(o.center_distance_mi, 1)} mi</span> : <TierLabel tier={o.proximity_tier} />}
        </span>
        <span className="shrink-0 text-[10.5px] text-fg-faint">{fmtGap(o.in_service_gap_days).replace(/ \(.*\)/, '')}</span>
      </div>
      <div className="mb-0.5 truncate text-[13px] font-semibold" title={o.a.name}>
        <UtilityTag id={o.a.utility_id} colors={colors} />
        &nbsp; {tidyName(o.a.name)}
      </div>
      <div className="mb-2.5 truncate text-[13px] font-semibold" title={o.b.name}>
        <UtilityTag id={o.b.utility_id} colors={colors} />
        &nbsp; {tidyName(o.b.name)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] text-fg-dim">
          {fmtNum(o.center_distance_mi, 2)} mi apart · score {fmtNum(o.score, 2)}
        </span>
        {!live && <ConfidenceBadge level={o.location_confidence} />}
      </div>
      {!compact && !live && (o.build_windows_overlap || o.override_involved || o.user_data_involved || o.either_already_in_service) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {o.build_windows_overlap && (
            <Pill tone="teal" title="The two construction windows overlap in time">
              <CalendarCheck2 className="h-3 w-3" aria-hidden="true" /> Same build window
            </Pill>
          )}
          {o.either_already_in_service && <Pill title="At least one project's in-service date has passed">In service</Pill>}
          {o.override_involved && (
            <Pill tone="amber" title="At least one location was placed by hand">
              <Hand className="h-3 w-3" aria-hidden="true" /> Hand-placed
            </Pill>
          )}
          {o.user_data_involved && (
            <Pill tone="purple" title="Includes user-submitted data">
              <Users className="h-3 w-3" aria-hidden="true" /> Community data
            </Pill>
          )}
        </div>
      )}
    </button>
  )
})
