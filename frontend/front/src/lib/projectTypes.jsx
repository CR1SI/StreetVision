import { CircleHelp, Layers, Plus, Wrench, Zap } from 'lucide-react'

// What kind of work a project is. Keys match the API's project_type (backend/api/project_types.py).
// `paths` are the same Lucide icons as `Icon`, as SVG path data, so the map can draw them on a canvas.
export const PROJECT_TYPES = [
  {
    key: 'line_rebuild',
    label: 'Line rebuild / upgrade',
    hint: 'Existing line: new poles, wire or structures',
    Icon: Wrench,
    paths: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  },
  {
    key: 'new_line',
    label: 'New line or tap',
    hint: 'A new route or a branch to a new customer',
    Icon: Plus,
    paths: ['M5 12h14', 'M12 5v14'],
  },
  {
    key: 'substation',
    label: 'Substation work',
    hint: 'Equipment inside a substation: reactor, transformer, relays',
    Icon: Zap,
    paths: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
  },
  {
    key: 'area_package',
    label: 'Area package',
    hint: 'Several upgrades bundled under one name',
    Icon: Layers,
    paths: [
      'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
      'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
      'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
    ],
  },
  {
    key: 'other',
    label: 'Other / unspecified',
    hint: 'The source doesn’t say',
    Icon: CircleHelp,
    paths: ['M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
  },
]

export const TYPE_BY_KEY = Object.fromEntries(PROJECT_TYPES.map((t) => [t.key, t]))
export const typeOf = (key) => TYPE_BY_KEY[key] ?? TYPE_BY_KEY.other
export const typeLabel = (key) => typeOf(key).label

/** Small inline type icon for lists and cards. */
export function TypeIcon({ type, className = 'h-3.5 w-3.5', title }) {
  const t = typeOf(type)
  return <t.Icon className={className} aria-label={title ?? t.label} role="img" />
}
