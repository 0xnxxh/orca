import { describe, expect, it } from 'vitest'
import { coordinateSshLegacyMigration } from './ssh-legacy-migration-coordinator'
import type {
  LegacyPhysicalWorkerDescriptor,
  SshLegacyInspectedWorker,
  SshLegacyMigrationCoordinatorInput
} from './ssh-legacy-migration-coordinator-types'
import {
  combineSshLegacyInventories,
  descriptorForInventory,
  evidenceProviderForInventory,
  inspectionForWorker,
  SSH_LEGACY_TEST_CAPABILITIES
} from './__tests__/ssh-legacy-migration-evidence'
import { FutureSshLegacyMigrationRpc } from './__tests__/ssh-legacy-migration-future-rpc'
import { makeSshLegacyInventoryScenario } from './__tests__/ssh-legacy-migration-inventory'
import type { SshLegacyMigrationInventoryInput } from './ssh-legacy-migration-inventory-types'

describe('SSH legacy migration coordinator commit', () => {
  it('commits exact evidence, a durable barrier, then protected GC in order', async () => {
    const harness = migrationHarness(makeSshLegacyInventoryScenario())

    const outcome = await coordinateSshLegacyMigration(harness.input)

    expect(outcome).toMatchObject({
      kind: 'committed',
      receipts: [{ workerId: 'worker-a', sequence: 1, duplicate: false }],
      catalogRevision: 1,
      gc: { kind: 'completed', removed: ['/old/relay'] }
    })
    expect(methods(harness.rpc)).toEqual([
      'inspect',
      'migrate',
      'gcProtection',
      'migrationBarrier',
      'gc'
    ])
    expect(new Set(harness.rpc.calls.map((call) => call.signal))).toEqual(
      new Set([harness.input.signal])
    )
    const barrierIndex = methods(harness.rpc).indexOf('migrationBarrier')
    expect(methods(harness.rpc).indexOf('gc')).toBeGreaterThan(barrierIndex)
  })

  it('retries a lost migration response through the exact authority operation', async () => {
    const harness = migrationHarness(makeSshLegacyInventoryScenario(), {
      loseMigrationResponseOnce: true
    })

    const uncertain = await coordinateSshLegacyMigration(harness.input)
    const outcome = await coordinateSshLegacyMigration(harness.input)

    expect(uncertain).toMatchObject({ kind: 'unresolved', mutationState: 'commit-uncertain' })
    expect(outcome).toMatchObject({
      kind: 'committed',
      receipts: [{ duplicate: true }]
    })
    expect(methods(harness.rpc).filter((method) => method === 'migrate')).toHaveLength(2)
    expect(methods(harness.rpc)).not.toContain('migrationStatus')
  })

  it('replays an already durable worker commit through the same migrate request', async () => {
    const harness = migrationHarness(makeSshLegacyInventoryScenario(), {
      committedInitially: true
    })

    const outcome = await coordinateSshLegacyMigration(harness.input)

    expect(outcome).toMatchObject({
      kind: 'committed',
      receipts: [{ workerId: 'worker-a', duplicate: true }]
    })
    expect(methods(harness.rpc).filter((method) => method === 'migrate')).toHaveLength(1)
  })

  it('partitions multiple workers deterministically and never mixes candidate catalogs', async () => {
    const first = makeSshLegacyInventoryScenario({ physicalPtyId: 'pty-a' })
    const second = makeSshLegacyInventoryScenario({
      workerId: 'worker-b',
      buildId: 'build-b',
      physicalPtyId: 'pty-b',
      ptyIncarnationId: 'incarnation-b',
      processId: 4_202,
      tabId: 'tab-b',
      leafId: 'leaf-b',
      namespaceId: 'namespace-b'
    })
    const inventory = combineSshLegacyInventories(first, second)
    const workerA = descriptorForInventory(inventory, 0)
    const workerB = descriptorForInventory(inventory, 1)
    const harness = migrationHarness(inventory, {}, [workerB, workerA])

    const outcome = await coordinateSshLegacyMigration(harness.input)

    expect(outcome).toMatchObject({
      kind: 'committed',
      receipts: [
        { workerId: 'worker-a', sequence: 1 },
        { workerId: 'worker-b', sequence: 2 }
      ]
    })
    const migrations = harness.rpc.calls.filter((call) => call.method.endsWith('.migrate'))
    expect(migrations).toHaveLength(2)
    for (const call of migrations) {
      const worker = call.params.worker as LegacyPhysicalWorkerDescriptor
      const catalog = call.params.catalog as {
        imports: { physicalPty: { workerId: string } }[]
        unresolved: { physicalPty: { workerId: string } }[]
      }
      expect(
        [...catalog.imports, ...catalog.unresolved].every(
          (candidate) => candidate.physicalPty.workerId === worker.workerId
        )
      ).toBe(true)
    }
    expect(
      harness.rpc.calls
        .filter((call) => call.method.endsWith('.inspect'))
        .map((call) => (call.params.worker as LegacyPhysicalWorkerDescriptor).workerId)
    ).toEqual(['worker-a', 'worker-b'])
  })

  it('commits ambiguous evidence only after the host records isolated preservation', async () => {
    const base = makeSshLegacyInventoryScenario()
    const inventory: SshLegacyMigrationInventoryInput = {
      ...base,
      remoteSnapshotPanes: [
        {
          ...base.remoteSnapshotPanes[0],
          paneKey: 'tab-stale:leaf-stale',
          tabId: 'tab-stale',
          leafId: 'leaf-stale'
        }
      ]
    }
    const harness = migrationHarness(inventory)

    const outcome = await coordinateSshLegacyMigration(harness.input)

    expect(outcome).toMatchObject({
      kind: 'committed',
      summary: { importCount: 0, unresolvedCount: 1 }
    })
    const migration = harness.rpc.calls.find((call) => call.method.endsWith('.migrate'))
    expect(
      (
        migration?.params.catalog as
          | { unresolved: { preservation: { kind: string } }[] }
          | undefined
      )?.unresolved[0]?.preservation.kind
    ).toBe('evidence-gc-retained')
  })

  it('never runs GC when the durable barrier is unconfirmed', async () => {
    const harness = migrationHarness(makeSshLegacyInventoryScenario(), {
      barrierError: new Error('barrier disk unavailable')
    })

    const outcome = await coordinateSshLegacyMigration(harness.input)

    expect(outcome).toMatchObject({
      kind: 'unresolved',
      phase: 'barrier',
      mutationState: 'catalog-committed'
    })
    expect(methods(harness.rpc)).not.toContain('gc')
  })

  it('keeps a durable migration committed when post-barrier GC must retry', async () => {
    const harness = migrationHarness(makeSshLegacyInventoryScenario(), {
      gcError: new Error('GC retry required')
    })

    const outcome = await coordinateSshLegacyMigration(harness.input)

    expect(outcome).toMatchObject({
      kind: 'committed',
      gc: { kind: 'pending', reason: 'GC retry required' }
    })
  })
})

function migrationHarness(
  inventory: SshLegacyMigrationInventoryInput,
  rpcOptions: ConstructorParameters<typeof FutureSshLegacyMigrationRpc>[1] = {},
  workers?: readonly LegacyPhysicalWorkerDescriptor[]
) {
  const selectedWorkers =
    workers ?? inventory.liveRelays.map((_, index) => descriptorForInventory(inventory, index))
  const inspected: SshLegacyInspectedWorker[] = selectedWorkers.map((descriptor) => ({
    descriptor,
    inspection: inspectionForWorker(inventory, descriptor)
  }))
  const rpc = new FutureSshLegacyMigrationRpc(inspected, rpcOptions)
  const input: SshLegacyMigrationCoordinatorInput = {
    targetId: inventory.targetId,
    authorityHostId: inventory.authorityHostId,
    hostPathFlavor: inventory.hostPathFlavor,
    authorityCapabilities: SSH_LEGACY_TEST_CAPABILITIES,
    attemptId: 'attempt-1',
    signal: new AbortController().signal,
    isAttemptCurrent: () => true,
    rpc,
    evidenceProvider: evidenceProviderForInventory(inventory, selectedWorkers)
  }
  return { input, rpc }
}

function methods(rpc: FutureSshLegacyMigrationRpc): string[] {
  return rpc.calls.map((call) => call.method.split('.').at(-1) ?? call.method)
}
