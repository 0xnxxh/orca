import { translate } from '@/i18n/i18n'
import type { DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'
import type { AgentMapTimeField } from './agent-map-time-filter'

export function hostLabel(host: DashboardCardHostKind): string {
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

export function timeFieldLabel(field: AgentMapTimeField): string {
  switch (field) {
    case 'lifespan':
      return translate('dashboardPopout.map.filters.lifespan', 'Session lifespan')
    case 'sinceMessage':
      return translate('dashboardPopout.map.filters.sinceMessage', 'Since last message')
    case 'timeInState':
      return translate('dashboardPopout.map.filters.timeInState', 'Time in current state')
  }
}
