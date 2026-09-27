export function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadGeoJSON(filename, features) {
  downloadBlob(filename, JSON.stringify({ type: 'FeatureCollection', features }, null, 2), 'application/geo+json')
}

const CSV_COLUMNS = [
  'utility_id', 'project_id', 'name', 'description', 'status', 'kv', 'in_service_date', 'in_service_date_updated',
  'build_start', 'build_end', 'location_confidence', 'is_override', 'confidence_note', 'source_kind', 'center_lon', 'center_lat',
]

const cell = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadProjectsCSV(filename, features) {
  const rows = features.map((f) => {
    const p = f.properties
    const r = { ...p, center_lon: p.center?.[0], center_lat: p.center?.[1] }
    return CSV_COLUMNS.map((c) => cell(r[c])).join(',')
  })
  downloadBlob(filename, [CSV_COLUMNS.join(','), ...rows].join('\n'), 'text/csv')
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
