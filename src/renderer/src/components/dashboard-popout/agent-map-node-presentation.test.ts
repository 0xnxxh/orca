import { describe, expect, it, vi } from 'vitest'
import { agentMapDotState, agentMapStatusLabel } from './agent-map-node-presentation'
import type { AgentMapAgentNode } from './agent-map-layout'

vi.mock('@/i18n/i18n', () => ({
  translate: (key: string, fallback: string) => `${key}:${fallback}`
}))

describe('agentMapStatusLabel', () => {
  function node(status: AgentMapAgentNode['status'], backgroundOnly = false): AgentMapAgentNode {
    return {
      status,
      card: backgroundOnly ? { backgroundOnly: true } : {}
    } as AgentMapAgentNode
  }

  it('localizes the map-only acknowledged completion state', () => {
    expect(agentMapStatusLabel(node('done-seen'))).toBe(
      'dashboardPopout.map.status.doneSeen:Done, seen'
    )
  })

  it('keeps shared agent states on their existing labels', () => {
    expect(agentMapStatusLabel(node('working'))).toBe('Working')
    expect(agentMapStatusLabel(node('done'))).toBe('Done')
  })

  it('presents a background-only working node without changing its map status', () => {
    const background = node('working', true)
    expect(agentMapDotState(background)).toBe('background')
    expect(agentMapStatusLabel(background)).toBe('Background work')
    expect(background.status).toBe('working')
  })
})
