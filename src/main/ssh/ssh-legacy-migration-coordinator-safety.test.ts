import { describe, expect, it, vi } from 'vitest'
import {
  coordinateSshLegacyMigration,
  SshLegacyMigrationAttemptSupersededError
} from './ssh-legacy-migration-coordinator'
import type {
  SshLegacyMigrationCoordinatorInput,
  SshLegacyMigrationEvidenceProvider,
  SshLegacyMigrationRpc
} from './ssh-legacy-migration-coordinator-types'
import {
  descriptorForInventory,
  evidenceProviderForInventory,
  inspectionForWorker,
  SSH_LEGACY_TEST_CAPABILITIES
} from './__tests__/ssh-legacy-migration-evidence'
import { makeSshLegacyInventoryScenario } from './__tests__/ssh-legacy-migration-inventory'

describe('SSH legacy migration coordinator safety', () => {
  it('keeps both version-skew directions read-only without the explicit capability', async () => {
    const inventory = makeSshLegacyInventoryScenario()
    const descriptor = descriptorForInventory(inventory)
    const discoverWorkers = vi.fn(async () => ({ kind: 'ready' as const, workers: [descriptor] }))
    const provider: SshLegacyMigrationEvidenceProvider = {
      discoverWorkers,
      buildInventory: vi.fn(async () => ({ kind: 'ready' as const, inventory }))
    }
    const rpc = requestSpy(() => Promise.reject(new Error('must not call RPC')))

    for (const capabilities of [undefined, ['terminal-session.authority.v1']]) {
      await expect(
        coordinateSshLegacyMigration(
          input({ rpc, evidenceProvider: provider, authorityCapabilities: capabilities })
        )
      ).resolves.toEqual({ kind: 'read-only', reason: 'capability-not-negotiated' })
    }

    expect(discoverWorkers).not.toHaveBeenCalled()
    expect(rpc.request).not.toHaveBeenCalled()
  })

  it('reports missing production evidence without probing or mutating the worker', async () => {
    const rpc = requestSpy(() => Promise.reject(new Error('must not call RPC')))

    await expect(
      coordinateSshLegacyMigration(
        input({ rpc, authorityCapabilities: SSH_LEGACY_TEST_CAPABILITIES })
      )
    ).resolves.toEqual({
      kind: 'unresolved',
      phase: 'worker-discovery',
      reason: 'migration evidence provider is unavailable',
      mutationState: 'none'
    })
    expect(rpc.request).not.toHaveBeenCalled()
  })

  it('rejects the current side-effecting inspection shape before catalog mutation', async () => {
    const inventory = makeSshLegacyInventoryScenario()
    const descriptor = descriptorForInventory(inventory)
    const buildInventory = vi.fn()
    const provider: SshLegacyMigrationEvidenceProvider = {
      discoverWorkers: async () => ({ kind: 'ready', workers: [descriptor] }),
      buildInventory
    }
    const rpc = requestSpy(async () => ({
      workerId: descriptor.workerId,
      routeId: descriptor.routeId,
      buildId: descriptor.buildId,
      ptys: []
    }))
    const controller = new AbortController()

    const outcome = await coordinateSshLegacyMigration(
      input({ rpc, evidenceProvider: provider, signal: controller.signal })
    )

    expect(outcome).toMatchObject({
      kind: 'unresolved',
      phase: 'inspection',
      mutationState: 'none',
      workerId: descriptor.workerId
    })
    expect(buildInventory).not.toHaveBeenCalled()
    expect(rpc.request).toHaveBeenCalledWith(
      'terminalAuthority.legacyPhysicalWorker.inspect',
      expect.objectContaining({
        requirements: {
          inspectionMode: 'observational',
          catalogValidation: 'before-isolation',
          replay: 'durable-operation-id'
        }
      }),
      { signal: controller.signal }
    )
  })

  it('rejects inventory that weakens exact endpoint or process proof', async () => {
    const inventory = makeSshLegacyInventoryScenario()
    const descriptor = descriptorForInventory(inventory)
    const inspection = inspectionForWorker(inventory, descriptor)
    const weakened = {
      ...inventory,
      liveRelays: [
        {
          ...inventory.liveRelays[0],
          identityProof: { ...inventory.liveRelays[0].identityProof, observedProcess: null }
        }
      ]
    }
    const provider = evidenceProviderForInventory(weakened, [descriptor])
    const rpc = requestSpy(async (method) => {
      if (method.endsWith('.inspect')) {
        return inspection
      }
      throw new Error('mutation must not run')
    })

    const outcome = await coordinateSshLegacyMigration(input({ rpc, evidenceProvider: provider }))

    expect(outcome).toMatchObject({ kind: 'unresolved', phase: 'planning', mutationState: 'none' })
    expect(rpc.request).toHaveBeenCalledTimes(1)
  })

  it('propagates one abort signal through evidence collection and stops the attempt', async () => {
    const deferred =
      Promise.withResolvers<
        Awaited<ReturnType<SshLegacyMigrationEvidenceProvider['discoverWorkers']>>
      >()
    const provider: SshLegacyMigrationEvidenceProvider = {
      discoverWorkers: () => deferred.promise,
      buildInventory: vi.fn()
    }
    const rpc = requestSpy(() => Promise.reject(new Error('must not call RPC')))
    const controller = new AbortController()
    const coordinating = coordinateSshLegacyMigration(
      input({ rpc, evidenceProvider: provider, signal: controller.signal })
    )

    controller.abort()
    deferred.resolve({ kind: 'unresolved', reason: 'late evidence' })

    await expect(coordinating).rejects.toMatchObject({ name: 'AbortError' })
    expect(rpc.request).not.toHaveBeenCalled()
  })

  it('fences a superseded attempt after an awaited provider boundary', async () => {
    const inventory = makeSshLegacyInventoryScenario()
    const descriptor = descriptorForInventory(inventory)
    let current = true
    const provider: SshLegacyMigrationEvidenceProvider = {
      discoverWorkers: async () => {
        current = false
        return { kind: 'ready', workers: [descriptor] }
      },
      buildInventory: vi.fn()
    }

    await expect(
      coordinateSshLegacyMigration(
        input({
          rpc: requestSpy(() => Promise.reject(new Error('must not call RPC'))),
          evidenceProvider: provider,
          isAttemptCurrent: () => current
        })
      )
    ).rejects.toBeInstanceOf(SshLegacyMigrationAttemptSupersededError)
  })
})

function input(
  overrides: Partial<SshLegacyMigrationCoordinatorInput> &
    Pick<SshLegacyMigrationCoordinatorInput, 'rpc'>
): SshLegacyMigrationCoordinatorInput {
  return {
    targetId: 'target-a',
    authorityHostId: 'authority-host-a',
    hostPathFlavor: 'posix',
    authorityCapabilities: SSH_LEGACY_TEST_CAPABILITIES,
    attemptId: 'attempt-1',
    signal: new AbortController().signal,
    isAttemptCurrent: () => true,
    ...overrides
  }
}

function requestSpy(
  implementation: (
    method: string,
    params?: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>
): SshLegacyMigrationRpc & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(implementation) }
}
