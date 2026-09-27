// One palette shared by the map layers and the UI, so a color always means the same thing.
// v2: near-black base, a single blue accent for interactive chrome, and muted (not candy-bright)
// colors for the things that must stay visually distinct — utilities, tiers, confidence.

export const PALETTE = {
  bg: '#0B0D10',
  surface: '#111318',
  surface2: '#15181D',
  surface3: '#1B1F26',
  border: '#2A2E35',
  map: '#141414', // basemap land color
  text: '#F2F3F5',
  dim: '#9198A3',
  faint: '#6B7280',
  accent: '#3B82F6',
  danger: '#DC5B5B',
  warn: '#C9963E',
  ok: '#3FA679',
  sky: '#5C8FC9',
}

// Utilities are the categorical colors. DESC and GPC are fixed; uploaded utilities
// take the next free color in order (the list comes from /api/utilities, never hardcoded).
// Muted, desaturated set — distinguishable at a glance, not a rainbow.
const FIXED = { DESC: '#6C8FCF', GPC: '#4FA894' }
const EXTRA = ['#B57DBE', '#8FA35C', '#C98CA0', '#6FA3B0', '#B0975C', '#8C93A6']

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

// Proximity tiers: sequential, hotter (more saturated / more red) = closer = more valuable,
// but pulled well back from neon. Keys match the API's proximity_tier strings exactly.
export const TIERS = [
  { key: 'touching/crossing', label: 'Touching / crossing', color: PALETTE.danger, share: 'Coordinate outages and crossing structures' },
  { key: 'under 1 mi', label: 'Under 1 mi', color: PALETTE.warn, share: 'Share right-of-way, access roads, permits' },
  { key: 'under 5 mi', label: 'Under 5 mi', color: '#B0975C', share: 'Share laydown yards, deliveries, site logistics' },
  { key: 'under 25 mi', label: 'Under 25 mi', color: PALETTE.sky, share: 'Share crews, cranes, contractors' },
]
export const TIER_BY_KEY = Object.fromEntries(TIERS.map((t) => [t.key, t]))
export const tierColor = (key) => TIER_BY_KEY[key]?.color ?? PALETTE.dim
export const tierLabel = (key) => TIER_BY_KEY[key]?.label ?? key ?? 'Live result'

export const CONFIDENCE = {
  high: { label: 'High', fg: PALETTE.ok, bg: '#122520' },
  medium: { label: 'Medium', fg: PALETTE.warn, bg: '#2A2013' },
  low: { label: 'Low', fg: '#C9CFDC', bg: '#1B1F26' },
  none: { label: 'Unplaced', fg: PALETTE.faint, bg: '#15181D' },
}