import { describe, expect, it } from 'vitest'
import {
  MAX_RUNTIME_SSH_RELAY_RECOVERIES,
  MAX_RUNTIME_SSH_RELAY_RECOVERY_RETAINED_TARGET_ID_BYTES,
  MAX_RUNTIME_SSH_RELAY_RECOVERY_TARGET_ID_BYTES,
  RuntimeSshRelayRecoveryGenerations
} from './runtime-ssh-relay-recovery-generations'

describe('RuntimeSshRelayRecoveryGenerations', () => {
  it('releases completed recoveries under sequential unique-target churn', () => {
    const generations = new RuntimeSshRelayRecoveryGenerations()

    for (let index = 0; index < 10_000; index += 1) {
      const lease = generations.begin(`ssh-${index}`)
      expect(lease).not.toBeNull()
      lease?.release()
    }

    expect(generations.evidence()).toEqual({ recoveries: 0, retainedTargetIdBytes: 0 })
  })

  it('keeps a replacement current when an older recovery finishes late', () => {
    const generations = new RuntimeSshRelayRecoveryGenerations()
    const stale = generations.begin('ssh-1')!
    const replacement = generations.begin('ssh-1')!

    stale.release()

    expect(stale.isCurrent()).toBe(false)
    expect(replacement.isCurrent()).toBe(true)
    expect(generations.evidence()).toEqual({ recoveries: 1, retainedTargetIdBytes: 5 })
  })

  it('caps same-target hung replacements by outstanding lease count', () => {
    const generations = new RuntimeSshRelayRecoveryGenerations()
    const leases = Array.from({ length: 10_000 }, () => generations.begin('ssh-1')).filter(
      (lease) => lease !== null
    )

    expect(leases).toHaveLength(MAX_RUNTIME_SSH_RELAY_RECOVERIES)
    expect(leases.slice(0, -1).every((lease) => !lease.isCurrent())).toBe(true)
    expect(leases.at(-1)?.isCurrent()).toBe(true)
    for (const lease of leases) {
      lease.release()
    }
    expect(generations.evidence()).toEqual({ recoveries: 0, retainedTargetIdBytes: 0 })
  })

  it('keeps invalidated attempts admitted until their work releases', () => {
    const generations = new RuntimeSshRelayRecoveryGenerations({
      maxRecoveries: 1,
      maxTargetIdBytes: 8,
      maxRetainedTargetIdBytes: 8
    })
    const stale = generations.begin('ssh-1')!

    generations.invalidate('ssh-1')

    expect(stale.isCurrent()).toBe(false)
    expect(generations.begin('ssh-2')).toBeNull()
    stale.release()
    expect(generations.begin('ssh-2')?.isCurrent()).toBe(true)
  })

  it('bounds individual and aggregate retained target-id bytes', () => {
    const generations = new RuntimeSshRelayRecoveryGenerations({
      maxRecoveries: 3,
      maxTargetIdBytes: 8,
      maxRetainedTargetIdBytes: 10
    })
    const first = generations.begin('123456')
    const second = generations.begin('abcd')

    expect(first?.isCurrent()).toBe(true)
    expect(second?.isCurrent()).toBe(true)
    expect(generations.begin('x')).toBeNull()
    expect(generations.begin('🌊🌊🌊')).toBeNull()
  })

  it('publishes explicit production bounds', () => {
    expect(MAX_RUNTIME_SSH_RELAY_RECOVERIES).toBe(256)
    expect(MAX_RUNTIME_SSH_RELAY_RECOVERY_TARGET_ID_BYTES).toBe(64 * 1024)
    expect(MAX_RUNTIME_SSH_RELAY_RECOVERY_RETAINED_TARGET_ID_BYTES).toBe(4 * 1024 * 1024)
  })
})
