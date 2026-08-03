import { describe, expect, it } from 'vitest'
import {
  AGENT_DASHBOARD_VIEWS,
  isAgentDashboardView,
  resolveAgentDashboardView,
} from './agent-dashboard-view'

describe('agent dashboard view', () => {
  it('keeps the accepted URL views and selector views on one typed list', () => {
    expect(AGENT_DASHBOARD_VIEWS).toEqual(['board', 'lanes', 'map', 'cells'])
    expect(isAgentDashboardView('lanes')).toBe(true)
    expect(isAgentDashboardView('unknown')).toBe(false)
    expect(isAgentDashboardView(null)).toBe(false)
  })

  it('keeps legacy rings URLs pointed at the map', () => {
    expect(resolveAgentDashboardView('rings')).toBe('map')
    expect(resolveAgentDashboardView('map')).toBe('map')
    expect(resolveAgentDashboardView('unknown')).toBeNull()
  })
})
