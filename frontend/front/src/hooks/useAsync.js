import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Run an async loader whenever `deps` change. Stale responses are dropped (an AbortSignal is
 * passed to the loader), so rapid filter changes never show an older result.
 * Returns { data, error, loading, reload }.
 */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true })
  const [nonce, setNonce] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve()
      .then(() => loaderRef.current(ctrl.signal))
      .then((data) => !ctrl.signal.aborted && setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (ctrl.signal.aborted || error?.name === 'AbortError') return
        setState((s) => ({ data: s.data, error, loading: false }))
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}

/** Read a query-string parameter once (pages are separate documents, so no router needed). */
export const param = (name) => new URLSearchParams(window.location.search).get(name)

/** Keep query-string params in sync with state without reloading the page. */
export function writeParams(values) {
  const url = new URL(window.location.href)
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length)) url.searchParams.delete(k)
    else url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  window.history.replaceState(null, '', url)
}
