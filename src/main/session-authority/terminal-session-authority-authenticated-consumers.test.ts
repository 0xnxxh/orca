import { describe, expect, it, vi } from 'vitest'
import type { TerminalAuthorityAuthenticatedNamespacePreparation } from './terminal-session-authority-authenticated-namespace-preparation'
import { TerminalSessionAuthorityAuthenticatedConsumers } from './terminal-session-authority-authenticated-consumers'
import type { TerminalSessionAuthorityPolicyConsumers } from './terminal-session-authority-policy-consumers'
import type { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'

describe('authenticated terminal authority consumer rollback', () => {
  it('reports the primary transport-release cause with a failed pending rollback', async () => {
    const report = vi.fn()
    const consumers = new TerminalSessionAuthorityAuthenticatedConsumers(
      {} as TerminalSessionAuthorityRegistry,
      {} as TerminalSessionAuthorityPolicyConsumers,
      report
    )
    const rollbackFailure = new Error('pending rollback failed')
    const preparation = {
      rollback: async () => {
        throw rollbackFailure
      }
    } as unknown as TerminalAuthorityAuthenticatedNamespacePreparation
    const transportToken = {}
    const state = consumers as unknown as {
      pendingPreparations: Map<object, Set<TerminalAuthorityAuthenticatedNamespacePreparation>>
    }
    state.pendingPreparations.set(transportToken, new Set([preparation]))

    consumers.releaseTransport(transportToken)

    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce())
    const joined = report.mock.calls[0]?.[0]
    expect(joined).toBeInstanceOf(AggregateError)
    expect((joined as AggregateError).errors[1]).toBe(rollbackFailure)
  })
})
