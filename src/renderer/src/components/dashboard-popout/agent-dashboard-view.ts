export const AGENT_DASHBOARD_VIEWS = ['board', 'lanes', 'map', 'cells'] as const

export type AgentDashboardView = (typeof AGENT_DASHBOARD_VIEWS)[number]

export function isAgentDashboardView(value: string | null): value is AgentDashboardView {
  return AGENT_DASHBOARD_VIEWS.some((view) => view === value)
}

export function resolveAgentDashboardView(value: string | null): AgentDashboardView | null {
  if (value === 'rings') {
    return 'map'
  }
  return isAgentDashboardView(value) ? value : null
}
