// One palette shared by the map layers and the UI, so a color always means the same thing.

export const PALETTE = {
  bg: '#0A0F1C',
  surface: '#111A2C',
  surface2: '#17223A',
  surface3: '#1E2A46',
  border: '#26314C',
  map: '#171717', // basemap land color
  text: '#F3F5FA',
  dim: '#8C96AD',
  faint: '#5C6784',
  purple: '#7C6FEF',
  teal: '#2FD1C0',
  pink: '#F0397E',
  amber: '#FBBF63',
  orange: '#FB8B3D',
  sky: '#5AC8FA',
}

// Utilities are the cool/categorical colors. DESC and GPC are fixed; uploaded utilities
// take the next free color in order (the list comes from /api/utilities, never hardcoded).
const FIXED = { DESC: PALETTE.purple, GPC: PALETTE.teal }
const EXTRA = ['#D946EF', '#A3E635', '#F9A8D4', '#C4B5FD', '#67E8F9', '#FDE68A', '#94A3B8']

export function utilityColors(utilityIds = []) {
  const map = { ...FIXED }
  let i = 0
  for (const id of [...utilityIds].sort()) {
    if (!map[id]) map[id] = EXTRA[i++ % EXTRA.length]
  }
  return map
}

export function colorFor(colors, utilityId) {
  return colors?.[utilityId] ?? PALETTE.dim
}

// Proximity tiers are the warm/sequential colors: hotter = closer = more valuable.
// Keys match the API's proximity_tier strings exactly.
export const TIERS = [
  { key: 'touching/crossing', label: 'Touching / crossing', color: PALETTE.pink, share: 'Coordinate outages and crossing structures' },
  { key: 'under 1 mi', label: 'Under 1 mi', color: PALETTE.orange, share: 'Share right-of-way, access roads, permits' },
  { key: 'under 5 mi', label: 'Under 5 mi', color: PALETTE.amber, share: 'Share laydown yards, deliveries, site logistics' },
  { key: 'under 25 mi', label: 'Under 25 mi', color: PALETTE.sky, share: 'Share crews, cranes, contractors' },
]
export const TIER_BY_KEY = Object.fromEntries(TIERS.map((t) => [t.key, t]))
export const tierColor = (key) => TIER_BY_KEY[key]?.color ?? PALETTE.dim
export const tierLabel = (key) => TIER_BY_KEY[key]?.label ?? key ?? 'Live result'

export const CONFIDENCE = {
  high: { label: 'High', fg: PALETTE.teal, bg: '#123B37' },
  medium: { label: 'Medium', fg: PALETTE.amber, bg: '#3F2E12' },
  low: { label: 'Low', fg: '#C9CFDC', bg: '#2A3350' },
  none: { label: 'Unplaced', fg: PALETTE.faint, bg: '#1E2A46' },
}
