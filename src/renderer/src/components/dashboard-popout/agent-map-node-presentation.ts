import { agentStateLabel, type AgentDotState } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { agentMapDirectLineageChevronPath } from './agent-map-lineage-chevron-path'
import type { AgentMapAgentNode } from './agent-map-layout'

/** Lives here, not in `agent-map-node-metadata`: `agentStateLabel` drags in React and
 *  lucide-react, and that module is on the layout and filter paths, which must stay
 *  free of component imports. `agentStateLabel` is shared with every other dot
 *  renderer, so the map's extra state gets its label here rather than widening
 *  `AgentDotState`. */
export function agentMapDotState(node: AgentMapAgentNode): AgentDotState {
  if (node.card.backgroundOnly === true && node.status === 'working') {
    return 'background'
  }
  return node.status === 'done-seen' ? 'done' : node.status
}

export function agentMapStatusLabel(node: AgentMapAgentNode): string {
  return node.status === 'done-seen'
    ? translate('dashboardPopout.map.status.doneSeen', 'Done, seen')
    : agentStateLabel(agentMapDotState(node))
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) {
    return translate('dashboardPopout.card.time.justNow', 'just now')
  }
  if (minutes < 60) {
    return translate('dashboardPopout.card.time.minutes', '{{count}}m', {
      count: Math.floor(minutes)
    })
  }
  return translate('dashboardPopout.card.time.hours', '{{count}}h', {
    count: Math.floor(minutes / 60)
  })
}

export function lineagePath(parent: AgentMapAgentNode, child: AgentMapAgentNode): string {
  return agentMapDirectLineageChevronPath(parent, child)
}

export function agentName(card: DashboardCard): string {
  return card.conversationName ?? (card.task.trim() || card.agentType)
}

export function agentMapAttentionMarkerScale(mapScale: number): number {
  const inverseScale = 1 / Math.max(mapScale, 0.001)
  return Math.max(1, inverseScale ** 0.72, inverseScale * 0.5)
}
