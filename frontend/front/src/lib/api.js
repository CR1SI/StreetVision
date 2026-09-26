// Thin client for the FastAPI backend. Every call goes through here so the base URL,
// error handling, and query-string building live in one place.
//
// By default calls are same-origin (/api/...): FastAPI serves the built site, and in dev
// Vite proxies /api to localhost:8000. Set VITE_API_BASE to point at another host.
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, { status, detail, errors } = {}) {
    super(message)
    this.status = status
    this.detail = detail
    this.errors = errors ?? [] // row-level upload errors: [{row, project_id, error}]
  }
}

function qs(params = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

// FastAPI returns {detail: "..."} or, for validation errors, {detail: [{loc, msg}, ...]}.
function describe(detail) {
  if (!detail) return null
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((x) => x !== 'body' && x !== 'query').join('.') : ''
        return field ? `${field}: ${d.msg}` : d.msg
      })
      .join('; ')
  }
  return JSON.stringify(detail)
}

async function request(path, { method = 'GET', params, body, headers, signal } = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}${qs(params)}`, { method, body, headers, signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new ApiError('Could not reach the StreetVision API. Is the backend running (uvicorn api.main:app)?', {
      status: 0,
    })
  }
  const type = res.headers.get('content-type') || ''
  const data = type.includes('application/json') ? await res.json().catch(() => null) : await res.text()
  if (!res.ok) {
    const msg = describe(data?.detail) || `Request failed (${res.status})`
    throw new ApiError(msg, { status: res.status, detail: data?.detail, errors: data?.errors })
  }
  return data
}

export const api = {
  health: (opts) => request('/api/health', opts),
  utilities: (opts) => request('/api/utilities', opts),

  /** GeoJSON FeatureCollection. params: utilities, source, min_confidence, hide_in_service */
  projects: (params, opts) => request('/api/projects', { params, ...opts }),

  /** Ranked list. params: utilities, source, max_distance_mi (<=25), min_confidence,
   *  hide_in_service, tier, land_cost_per_acre, limit */
  overlaps: (params, opts) => request('/api/overlaps', { params, ...opts }),

  overlap: (id, params, opts) => request(`/api/overlaps/${encodeURIComponent(id)}`, { params, ...opts }),

  /** Recomputed by PostGIS on request; radius up to 100 mi. No overlap_id / tier in the result. */
  overlapsLive: (params, opts) => request('/api/overlaps/live', { params, ...opts }),

  near: (params, opts) => request('/api/projects/near', { params, ...opts }),

  datasets: (params, opts) => request('/api/datasets', { params, ...opts }),
  templateUrl: `${BASE}/api/datasets/template`,
  docsUrl: `${BASE}/docs`,

  uploadDataset: (formData, { uploadToken } = {}) =>
    request('/api/datasets', {
      method: 'POST',
      body: formData,
      headers: uploadToken ? { 'X-Upload-Token': uploadToken } : undefined,
    }),

  deleteDataset: (id, token) =>
    request(`/api/datasets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-Delete-Token': token },
    }),
}
