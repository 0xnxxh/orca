import { describe, expect, it, vi } from 'vitest'
import {
  createSshPtyOutputIntakeHarness as createHarness,
  sshPtyOutputEvent as event
} from './ssh-pty-output-intake-test-harness'

describe('SshPtyOutputModelMigration', () => {
  it('fences a running source span before exporting its migration checkpoint', async () => {
    const harness = createHarness()
    const first = harness.intake.acceptData(
      event({
        data: 'aaaa',
        source: {
          spanId: 'span-a',
          clientGeneration: 3,
          ownerGeneration: 4,
          deliveryToken: 'delivery-token-1',
          sourceStartSu: 0,
          sourceEndSu: 4
        }
      })
    )
    harness.completions[0]!.resolve()
    await first
    const second = harness.intake.acceptData(
      event({
        data: 'bbbb',
        source: {
          spanId: 'span-b',
          clientGeneration: 3,
          ownerGeneration: 4,
          deliveryToken: 'delivery-token-1',
          sourceStartSu: 4,
          sourceEndSu: 8
        }
      })
    )

    const migration = harness.intake.beginGenerationMigration(1)
    const result = migration.byPty.get('pty-1')
    expect(result).toBeDefined()
    await expect(Promise.race([result, Promise.resolve('pending')])).resolves.toBe('pending')
    expect(harness.intake.getAcceptedSourceCheckpoints(1)[0]?.acceptedSourceEndSu).toBe(4)

    harness.completions[1]!.resolve()
    await expect(second).resolves.toMatchObject({ sequence: 8 })
    await expect(result).resolves.toMatchObject({
      status: 'settled',
      checkpoint: { acceptedSourceEndSu: 8 }
    })
    expect(harness.order.filter((entry) => entry === 'project:bbbb')).toHaveLength(1)
    await migration.completion
  })

  it('times out one migration, resets its model, and releases retained admission once', async () => {
    vi.useFakeTimers()
    try {
      const resetModelForMigration = vi.fn()
      const harness = createHarness({ resetModelForMigration })
      const receipt = harness.intake.acceptData(
        event({
          source: {
            spanId: 'span-b',
            clientGeneration: 3,
            ownerGeneration: 4,
            deliveryToken: 'delivery-token-1',
            sourceStartSu: 0,
            sourceEndSu: 4
          }
        })
      )
      const migration = harness.intake.beginGenerationMigration(1, 10_000)
      const result = migration.byPty.get('pty-1')

      await vi.advanceTimersByTimeAsync(10_000)

      await expect(result).resolves.toMatchObject({ status: 'checkpoint-unavailable' })
      await expect(receipt).rejects.toThrow('ssh_model_migration_timeout')
      expect(resetModelForMigration).toHaveBeenCalledOnce()
      expect(resetModelForMigration).toHaveBeenCalledWith(1, 'pty-1')
      expect(harness.intake.getDebugSnapshot().model).toMatchObject({
        sourceUnits: 0,
        bytes: 0,
        migratingPtys: 1
      })
      expect(vi.getTimerCount()).toBe(0)
      harness.completions[0]!.resolve()
      await Promise.resolve()
      expect(resetModelForMigration).toHaveBeenCalledOnce()
      harness.intake.closeGeneration(1, 'connection_lost')
      expect(harness.intake.getDebugSnapshot().model.migratingPtys).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
