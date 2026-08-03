import { getAgentRowConversationName } from '../../../../shared/agent-row-conversation-name'
import {
  DASHBOARD_MAX_LABEL_LENGTH,
  type DashboardBucket
} from '../../../../shared/dashboard-snapshot'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { DashboardAgentRow } from './useDashboardData'

const INTERNAL_ORCHESTRATION_TITLE_RE = /^worker-task_[a-z0-9_-]+$/i

export function dashboardBucketForState(state: DashboardAgentRow['state']): DashboardBucket {
  switch (state) {
    case 'working':
      return 'working'
    case 'done':
      return 'done'
    case 'idle':
      return 'idle'
    case 'blocked':
    case 'waiting':
      return 'attention'
  }
}

export function dashboardCardTask(row: DashboardAgentRow): string {
  return (row.entry.orchestration?.taskTitle ?? '').trim() || (row.entry.prompt ?? '').trim()
}

export function dashboardOptionalText(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function boundedDashboardLabel(value: string): string {
  return value.length > DASHBOARD_MAX_LABEL_LENGTH
    ? value.slice(0, DASHBOARD_MAX_LABEL_LENGTH)
    : value
}

export function boundedDashboardLabelOrUndefined(value: string | undefined): string | undefined {
  return value === undefined ? undefined : boundedDashboardLabel(value)
}

export function dashboardCardConversationName(
  row: DashboardAgentRow,
  generatedTitlesEnabled: boolean
): string | undefined {
  const parentPaneKey = row.entry.orchestration?.parentPaneKey
  // Why: a child row rendered on its parent's tab does not own that tab's name.
  if (
    row.lineage?.depth === 1 &&
    parentPaneKey !== undefined &&
    parsePaneKey(parentPaneKey)?.tabId === row.tab.id
  ) {
    return undefined
  }
  const conversationName =
    getAgentRowConversationName(row.tab, row.agentType, generatedTitlesEnabled) ?? undefined
  if (conversationName && !INTERNAL_ORCHESTRATION_TITLE_RE.test(conversationName)) {
    return conversationName
  }
  return (
    dashboardOptionalText(row.entry.orchestration?.displayName) ??
    dashboardOptionalText(row.entry.orchestration?.taskTitle) ??
    conversationName
  )
}
