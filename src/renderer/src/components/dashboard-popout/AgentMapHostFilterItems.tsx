import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'
import { ALL_AGENT_MAP_HOSTS, type AgentMapHostCounts } from './agent-map-filter'
import { FilterOptionCount } from './FilterOptionCount'

type AgentMapHostFilterItemsProps = {
  enabledHosts: ReadonlySet<DashboardCardHostKind>
  hostCounts: AgentMapHostCounts
  onHostToggle: (host: DashboardCardHostKind) => void
}

function hostLabel(host: DashboardCardHostKind): string {
  switch (host) {
    case 'local':
      return translate('dashboardPopout.map.host.local', 'Local')
    case 'ssh':
      return translate('dashboardPopout.map.host.ssh', 'SSH')
    case 'wsl':
      return translate('dashboardPopout.map.host.wsl', 'WSL')
    case 'remote':
      return translate('dashboardPopout.map.host.remote', 'Remote')
  }
}

/**
 * The map-only "Hosts" rows of the shared dashboard filter menu. Hosts that
 * contribute nothing are omitted, so a single-host fleet never sees the section.
 */
export function AgentMapHostFilterItems({
  enabledHosts,
  hostCounts,
  onHostToggle
}: AgentMapHostFilterItemsProps): React.JSX.Element | null {
  const hosts = ALL_AGENT_MAP_HOSTS.filter((host) => hostCounts[host] > 0)
  if (hosts.length < 2) {
    return null
  }
  return (
    <>
      <DropdownMenuLabel>
        {translate('dashboardPopout.map.filters.hosts', 'Hosts')}
      </DropdownMenuLabel>
      {hosts.map((host) => (
        <DropdownMenuCheckboxItem
          key={host}
          checked={enabledHosts.has(host)}
          onCheckedChange={() => onHostToggle(host)}
          onSelect={(event) => event.preventDefault()}
        >
          <span className="truncate">{hostLabel(host)}</span>
          <FilterOptionCount count={hostCounts[host]} />
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
    </>
  )
}
