// Address / ZIP -> [lon, lat] using OpenStreetMap Nominatim (the same OSM data the pipeline geocodes
// substations against). Free, no key; its policy asks for low volume (about 1 request/second), which
// a person typing into a search box is well under. Plain "lat, lon" input skips the network entirely.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

export async function geocode(query, signal) {
  const q = query.trim()
  const coord = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q)
  if (coord) {
    const lat = Number(coord[1])
    const lon = Number(coord[2])
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { center: [lon, lat], label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` }
  }
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'us', addressdetails: '0' })
  if (/^\d{5}(-\d{4})?$/.test(q)) params.set('postalcode', q.slice(0, 5))
  else params.set('q', q)
  let res
  try {
    res = await fetch(`${NOMINATIM}?${params}`, { signal, headers: { Accept: 'application/json' } })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error('The address lookup service (OpenStreetMap Nominatim) is unreachable. Try a ZIP example below, enter “lat, lon”, or click the map.')
  }
  if (!res.ok) throw new Error(`Address lookup failed (${res.status}). Try again in a moment.`)
  const [hit] = await res.json()
  if (!hit) throw new Error(`No match for “${q}”. Try a ZIP code or a city and state.`)
  return { center: [Number(hit.lon), Number(hit.lat)], label: hit.display_name.split(',').slice(0, 3).join(',') }
}
