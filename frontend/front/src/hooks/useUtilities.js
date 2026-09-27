import { useMemo } from 'react'
import { api } from '../lib/api'
import { utilityColors } from '../lib/colors'
import { useAsync } from './useAsync'

/** Utilities from the API plus a stable color per utility (uploaded ones included). */
export function useUtilities() {
  const res = useAsync((signal) => api.utilities({ signal }), [])
  const list = useMemo(() => res.data ?? [], [res.data])
  const colors = useMemo(() => utilityColors(list.map((u) => u.utility_id)), [list])
  const names = useMemo(() => Object.fromEntries(list.map((u) => [u.utility_id, u.name || u.utility_id])), [list])
  return { ...res, list, colors, names }
}
