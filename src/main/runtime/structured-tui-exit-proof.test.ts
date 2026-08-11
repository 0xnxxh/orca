import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionProcessIdentity } from '../../shared/agent-session-record'
import { waitForStructuredTuiExitProof } from './structured-tui-exit-proof'

const identity: AgentSessionProcessIdentity = {
  hostId: 'local',
  pid: 123,
  processStartTimeMs: 1_700_000_000_000,
  spawnToken: 'spawn-token'
}

describe('structured TUI exit proof', () => {
  it('accepts the exact terminal exit event without probing', async () => {
    const probe = vi.fn()

    await expect(
      waitForStructuredTuiExitProof({ identity, waitForExit: async () => {}, probe })
    ).resolves.toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })

  it.each([
    { outcome: 'pid-absent' as const },
    { outcome: 'identity-mismatch' as const, field: 'process-start-time' as const }
  ])('accepts a retired handle only when the recorded process is gone: $outcome', async (proof) => {
    await expect(
      waitForStructuredTuiExitProof({
        identity,
        waitForExit: async () => {
          throw new Error('terminal_handle_stale')
        },
        probe: async () => proof
      })
    ).resolves.toBeUndefined()
  })

  it.each([
    { outcome: 'identity-matched' as const, matchedOn: ['process-start-time' as const] },
    { outcome: 'indeterminate' as const, reason: 'probe unavailable' }
  ])('fails closed while the recorded process may still own: $outcome', async (proof) => {
    await expect(
      waitForStructuredTuiExitProof({
        identity,
        waitForExit: async () => {
          throw new Error('terminal_handle_stale')
        },
        probe: async () => proof
      })
    ).rejects.toThrow('terminal_handle_stale')
  })

  it('preserves unrelated terminal wait failures', async () => {
    const probe = vi.fn()

    await expect(
      waitForStructuredTuiExitProof({
        identity,
        waitForExit: async () => {
          throw new Error('timeout')
        },
        probe
      })
    ).rejects.toThrow('timeout')
    expect(probe).not.toHaveBeenCalled()
  })
})
