import { describe, expect, it } from 'vitest'
import {
  appendDashboardOrchestratorMessage,
  MAX_DASHBOARD_ORCHESTRATOR_MESSAGE_BYTES,
  MAX_DASHBOARD_ORCHESTRATOR_MESSAGES,
  type DashboardOrchestratorMessage
} from './dashboard-orchestrator-message-history'

function append(
  current: DashboardOrchestratorMessage[],
  id: number,
  text = `message-${id}`
): DashboardOrchestratorMessage[] {
  return appendDashboardOrchestratorMessage(current, { id, role: 'user', text })
}

describe('dashboard orchestrator message history', () => {
  it('retains only the newest bounded message count', () => {
    let history: DashboardOrchestratorMessage[] = []
    for (let id = 1; id <= MAX_DASHBOARD_ORCHESTRATOR_MESSAGES + 10; id += 1) {
      history = append(history, id)
    }

    expect(history).toHaveLength(MAX_DASHBOARD_ORCHESTRATOR_MESSAGES)
    expect(history[0]?.id).toBe(11)
  })

  it('bounds retained UTF-8 bytes and oversized individual messages', () => {
    const large = 'x'.repeat(Math.ceil(MAX_DASHBOARD_ORCHESTRATOR_MESSAGE_BYTES * 0.6))
    const first = append([], 1, large)
    const second = append(first, 2, large)

    expect(second).toHaveLength(1)
    expect(second[0]?.id).toBe(2)

    const oversized = append([], 3, '界'.repeat(MAX_DASHBOARD_ORCHESTRATOR_MESSAGE_BYTES))
    const retainedBytes = oversized.reduce((total, message) => total + message.byteLength, 0)
    expect(retainedBytes).toBeLessThanOrEqual(MAX_DASHBOARD_ORCHESTRATOR_MESSAGE_BYTES)
    expect(oversized[0]?.text.endsWith('…')).toBe(true)
  })
})
