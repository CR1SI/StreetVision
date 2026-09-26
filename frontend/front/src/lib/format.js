const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-06-01" -> "Jun 1, 2026". Parsed as a calendar date, so no timezone shift. */
export function fmtDate(iso) {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`
}

export function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export const fmtNum = (n, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const fmtUsd = (n) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function fmtGap(days) {
  if (days === null || days === undefined) return 'Gap unknown'
  if (days < 60) return `${days}-day gap`
  if (days < 730) return `${days}-day gap (~${Math.round(days / 30.4)} mo)`
  return `${fmtNum(days)}-day gap (~${(days / 365.25).toFixed(1)} yr)`
}

/** "2024-2026" build windows; the API returns "2028-2028" for single-year windows. */
export function fmtWindow(w) {
  if (!w) return 'Unknown'
  const [a, b] = w.split('-')
  if (a === 'None' || !a) return b ? `by ${b}` : 'Unknown'
  if (!b || b === 'None') return `from ${a}`
  return a === b ? a : `${a} – ${b}`
}

export const yearOf = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null)

/** Remove the "SAV:" / "GTC:" sponsor prefixes GPC titles carry, and tidy all-caps names. */
export function tidyName(name = '') {
  const n = name.replace(/^(SAV|GTC|MEAG|DU|GPC):\s*/i, '')
  if (n === n.toUpperCase() && /[A-Z]{4}/.test(n)) {
    return n
      .toLowerCase()
      .replace(/\b([a-z])/g, (c) => c.toUpperCase())
      .replace(/\b(\d+)kv\b/gi, '$1 kV')
      .replace(/\b(Usa|Sav|Cc|Ii|Iii)\b/g, (w) => w.toUpperCase())
  }
  return n
}
