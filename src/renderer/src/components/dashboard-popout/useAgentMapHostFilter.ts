import { useCallback, useState } from 'react'
import type { DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'
import { ALL_AGENT_MAP_HOSTS } from './agent-map-filter'

/** Map-only host muting. It lives on the board rather than inside the map so the
 *  shared toolbar filter — and its clear-all — can drive it. */
export function useAgentMapHostFilter(): {
  hosts: ReadonlySet<DashboardCardHostKind>
  toggleHost: (host: DashboardCardHostKind) => void
  resetHosts: () => void
} {
  const [hosts, setHosts] = useState<ReadonlySet<DashboardCardHostKind>>(
    () => new Set(ALL_AGENT_MAP_HOSTS)
  )
  const toggleHost = useCallback((host: DashboardCardHostKind): void => {
    setHosts((current) => {
      const next = new Set(current)
      if (!next.delete(host)) {
        next.add(host)
      }
      return next
    })
  }, [])
  const resetHosts = useCallback((): void => {
    setHosts(new Set(ALL_AGENT_MAP_HOSTS))
  }, [])
  return { hosts, toggleHost, resetHosts }
}
