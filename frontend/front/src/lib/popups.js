import { CONFIDENCE } from './colors'
import { fmtDate, fmtNum, tidyName } from './format'
import { typeLabel } from './projectTypes'

// MapLibre popups take HTML strings. Everything that comes from data is escaped here,
// because uploaded datasets are user-controlled text.
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const line = (label, value) =>
  `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:3px"><span style="color:#5C6784">${esc(label)}</span><span style="color:#F3F5FA;font-weight:600;text-align:right">${value}</span></div>`

export function projectPopup(p, colors, involved = []) {
  const c = CONFIDENCE[p.location_confidence] ?? CONFIDENCE.none
  const window = p.build_start || p.build_end ? `${p.build_start ?? '?'}–${p.build_end ?? '?'}` : '—'
  const pairs = involved.length
    ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #26314C">
         <div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8C96AD;margin-bottom:4px">In ${involved.length} overlap${involved.length > 1 ? 's' : ''}</div>
         ${involved
           .slice(0, 4)
           .map((o) => {
             const other = o.a.utility_id === p.utility_id && o.a.project_id === p.project_id ? o.b : o.a
             return `<a href="/overlap/?id=${esc(o.overlap_id)}" style="display:block;color:#2FD1C0;text-decoration:none;margin-top:3px">#${esc(o.rank)} ↔ ${esc(tidyName(other.name))} · ${esc(fmtNum(o.center_distance_mi, 1))} mi</a>`
           })
           .join('')}
       </div>`
    : ''
  return `
    <div style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${esc(colors[p.utility_id] ?? '#8C96AD')}">${esc(p.utility_id)} · ${esc(p.project_id)}</div>
    <div style="font-size:13px;font-weight:700;margin:3px 0 8px;line-height:1.35">${esc(tidyName(p.name))}</div>
    ${line('Type', esc(typeLabel(p.project_type)))}
    ${line('In service', esc(fmtDate(p.in_service_date)))}
    ${p.in_service_date_updated ? line('Updated date', esc(fmtDate(p.in_service_date_updated))) : ''}
    ${line('Build window', esc(window))}
    ${p.kv ? line('Voltage', `${esc(p.kv)} kV`) : ''}
    ${line('Location', `<span style="color:${c.fg}">${esc(c.label)}${p.is_override ? ' · hand-placed' : ''}</span>`)}
    ${p.source_kind === 'user_submitted' ? line('Source', '<span style="color:#B3AAF7">Community submitted</span>') : ''}
    ${pairs}`
}

/** A substation at the end of one or more planned lines. */
export function substationPopup(s, colors) {
  const n = Number(s.projects) || 1
  return `
    <div style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${esc(colors[s.utility_id] ?? '#8C96AD')}">${esc(s.utility_id)} · Substation</div>
    <div style="font-size:13px;font-weight:700;margin:3px 0 6px;line-height:1.35">${esc(tidyName(s.name) || 'Unnamed substation')}</div>
    <div style="color:#8C96AD">End point of ${n} planned line project${n > 1 ? 's' : ''}. Click a line or its badge for the project.</div>`
}

export function nearPopup(lngLat, results, radius) {
  const head = `<div style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#8C96AD">What's near here · ${radius} mi</div>
    <div style="font-size:11px;color:#5C6784;margin:2px 0 8px">${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}</div>`
  if (!results.length) return `${head}<div style="color:#8C96AD">No planned projects within ${radius} miles.</div>`
  return (
    head +
    results
      .slice(0, 6)
      .map(
        (r) =>
          `<div style="display:flex;justify-content:space-between;gap:10px;margin-top:4px"><span><b>${esc(r.utility_id)}</b> ${esc(tidyName(r.name))}</span><span style="color:#8C96AD;white-space:nowrap">${esc(fmtNum(r.distance_mi, 1))} mi</span></div>`,
      )
      .join('') +
    (results.length > 6 ? `<div style="color:#5C6784;margin-top:6px">+${results.length - 6} more</div>` : '') +
    `<a href="/check/?lat=${lngLat.lat.toFixed(5)}&lon=${lngLat.lng.toFixed(5)}" style="display:block;margin-top:10px;color:#F0397E;font-weight:700;text-decoration:none">Run a coordination check here →</a>`
  )
}
