import { describe, expect, it } from 'vitest'
import {
  SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY,
  SshLegacyMigrationInventoryCapacityError,
  planSshLegacyMigrationInventory,
  type SshLegacyMigrationInventoryInput,
  type SshLegacyRelayInventoryRow
} from './ssh-legacy-migration-inventory-planner'
import { makeSshLegacyInventoryScenario } from './__tests__/ssh-legacy-migration-inventory'

describe('SSH legacy migration inventory safety', () => {
  it('separates duplicate physical PTY ids by the persisted relay build', () => {
    const input = makeSshLegacyInventoryScenario()
    const relayA = input.liveRelays[0]
    const rowA = relayA.rows[0]
    const relayB = {
      ...relayA,
      workerId: 'worker-b',
      buildId: 'build-b',
      rows: [{ ...rowA, workerId: 'worker-b', buildId: 'build-b' }]
    }

    const plan = planSshLegacyMigrationInventory({ ...input, liveRelays: [relayB, relayA] })

    expect(plan.imports).toEqual([])
    expect(plan.unresolved).toHaveLength(2)
    expect(new Set(plan.unresolved.map((candidate) => candidate.physicalPty.workerId))).toEqual(
      new Set(['worker-a', 'worker-b'])
    )
  })

  it('matches independent consumer recovery evidence per worker and build', () => {
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
    const input = combine(first, second)

    const plan = planSshLegacyMigrationInventory({
      ...input,
      persistedConsumerRecoveries: [
        ...first.persistedConsumerRecoveries,
        ...second.persistedConsumerRecoveries
      ]
    })

    expect(plan.unresolved).toEqual([])
    expect(new Set(plan.imports.map((candidate) => candidate.physicalPty.workerId))).toEqual(
      new Set(['worker-a', 'worker-b'])
    )
  })

  it('contains duplicate consumer evidence to only its worker partition', () => {
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
    const duplicateFirst = {
      ...first.persistedConsumerRecoveries[0],
      clientInstanceId: 'consumer-recovery-a-duplicate'
    }
    const input = combine(first, second)

    const plan = planSshLegacyMigrationInventory({
      ...input,
      persistedConsumerRecoveries: [
        ...first.persistedConsumerRecoveries,
        duplicateFirst,
        ...second.persistedConsumerRecoveries
      ]
    })

    expect(plan.imports).toHaveLength(1)
    expect(plan.imports[0].physicalPty.workerId).toBe('worker-b')
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0]).toMatchObject({
      reason: 'endpoint-identity-unproved',
      physicalPty: { workerId: 'worker-a' }
    })
  })

  it('keeps stale remote snapshot disagreement unresolved', () => {
    const input = makeSshLegacyInventoryScenario()
    const staleSnapshot = {
      ...input.remoteSnapshotPanes[0],
      paneKey: 'tab-stale:leaf-stale',
      tabId: 'tab-stale',
      leafId: 'leaf-stale'
    }

    const plan = planSshLegacyMigrationInventory({
      ...input,
      remoteSnapshotPanes: [staleSnapshot]
    })

    expect(plan.imports).toEqual([])
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0].reason).toBe('workspace-mismatch')
    expect(JSON.stringify(plan)).not.toContain('dead')
    expect(JSON.stringify(plan)).not.toContain('kill')
  })

  it('turns a persisted lease with a missing remote row into recovery evidence', () => {
    const input = makeSshLegacyInventoryScenario()
    const relay = input.liveRelays[0]

    const plan = planSshLegacyMigrationInventory({
      ...input,
      liveRelays: [{ ...relay, rows: [] }]
    })

    expect(plan.imports).toEqual([])
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0]).toMatchObject({
      reason: 'physical-pty-incarnation-unproved',
      physicalPty: {
        workerId: 'worker-a',
        physicalPtyId: 'pty-1',
        ptyIncarnationId: 'incarnation-1',
        processId: null
      },
      inventoryEvidence: {
        serializedPtyIncarnationId: null,
        serializedProcessId: null
      }
    })
    expect(plan.summary.inventoryRowCount).toBe(0)
  })

  it('rejects ambiguous local pane generations without choosing the newest', () => {
    const input = makeSshLegacyInventoryScenario({ rendererGeneration: 0 })
    const secondGeneration = { ...input.localLayoutPanes[0], rendererGeneration: 1 }

    const plan = planSshLegacyMigrationInventory({
      ...input,
      localLayoutPanes: [secondGeneration, input.localLayoutPanes[0]]
    })

    expect(plan.imports).toEqual([])
    expect(plan.unresolved[0].reason).toBe('ambiguous-pane-generation')
  })

  it.each([
    [
      'incarnation',
      (row: SshLegacyRelayInventoryRow): SshLegacyRelayInventoryRow => ({
        ...row,
        ptyIncarnationId: null,
        serialized: { ...row.serialized, ptyIncarnationId: null }
      })
    ],
    [
      'serialized process',
      (row: SshLegacyRelayInventoryRow): SshLegacyRelayInventoryRow => ({
        ...row,
        serialized: { ...row.serialized, processId: null }
      })
    ]
  ])('keeps missing %s evidence unresolved', (_label, changeRow) => {
    const input = makeSshLegacyInventoryScenario()
    const plan = planSshLegacyMigrationInventory(replaceOnlyRow(input, changeRow))

    expect(plan.imports).toEqual([])
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0].reason).toBe('physical-pty-incarnation-unproved')
  })

  it('requires independently matching endpoint and process identity proof', () => {
    const input = makeSshLegacyInventoryScenario()
    const relay = input.liveRelays[0]
    const expectedEndpoint = relay.identityProof.expectedEndpoint
    const expectedProcess = relay.identityProof.expectedProcess
    if (expectedEndpoint?.kind !== 'unix-socket') {
      throw new Error('test requires a Unix endpoint')
    }
    if (expectedProcess === null) {
      throw new Error('test requires a relay process')
    }
    const changedEndpoint = { ...expectedEndpoint, inode: '999' }

    const endpointPlan = planSshLegacyMigrationInventory({
      ...input,
      liveRelays: [
        {
          ...relay,
          identityProof: { ...relay.identityProof, observedEndpoint: changedEndpoint }
        }
      ]
    })
    const processPlan = planSshLegacyMigrationInventory({
      ...input,
      liveRelays: [
        {
          ...relay,
          identityProof: {
            ...relay.identityProof,
            observedProcess: { ...expectedProcess, birthMarker: 'changed-birth-marker' }
          }
        }
      ]
    })

    expect(endpointPlan.imports).toEqual([])
    expect(endpointPlan.unresolved[0].reason).toBe('endpoint-identity-unproved')
    expect(processPlan.imports).toEqual([])
    expect(processPlan.unresolved[0].reason).toBe('endpoint-identity-unproved')
  })

  it('rejects namespaces that disagree with the explicit authority marker', () => {
    const input = makeSshLegacyInventoryScenario({ authorityHostId: 'authority-from-marker' })
    const relay = input.liveRelays[0]
    const row = relay.rows[0]

    expect(() =>
      planSshLegacyMigrationInventory({
        ...input,
        liveRelays: [
          {
            ...relay,
            rows: [
              {
                ...row,
                namespace: { ...row.namespace, authorityHostId: 'routing-target-derived-host' }
              }
            ]
          }
        ]
      })
    ).toThrow('namespace authority host does not match its marker')
  })

  it('produces identical digests and ids after every evidence array is reordered', () => {
    const first = makeSshLegacyInventoryScenario()
    const second = makeSshLegacyInventoryScenario({
      physicalPtyId: 'pty-2',
      ptyIncarnationId: 'incarnation-2',
      processId: 4_202,
      tabId: 'tab-b',
      leafId: 'leaf-b',
      namespaceId: 'namespace-b',
      localPartitionId: 'local-partition-b',
      snapshotPartitionId: 'remote-partition-b'
    })
    const separateRelays = combine(first, second)
    const combined: SshLegacyMigrationInventoryInput = {
      ...separateRelays,
      liveRelays: [
        {
          ...separateRelays.liveRelays[0],
          rows: separateRelays.liveRelays.flatMap((relay) => relay.rows)
        }
      ]
    }
    const reordered: SshLegacyMigrationInventoryInput = {
      ...combined,
      persistedConsumerRecoveries: combined.persistedConsumerRecoveries.toReversed(),
      persistedPtyLeases: combined.persistedPtyLeases.toReversed(),
      localLayoutPanes: combined.localLayoutPanes.toReversed(),
      remoteSnapshotPanes: combined.remoteSnapshotPanes.toReversed(),
      liveRelays: combined.liveRelays
        .toReversed()
        .map((relay) => ({ ...relay, rows: relay.rows.toReversed() }))
    }

    expect(planSshLegacyMigrationInventory(reordered)).toEqual(
      planSshLegacyMigrationInventory(combined)
    )
  })

  it('rejects capacity before scanning oversized evidence values', () => {
    const input = makeSshLegacyInventoryScenario()
    const oversized = Array.from(
      { length: SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.persistedConsumerRecoveries + 1 },
      () => null as never
    )

    expect(() =>
      planSshLegacyMigrationInventory({
        ...input,
        persistedConsumerRecoveries: oversized
      })
    ).toThrow(SshLegacyMigrationInventoryCapacityError)
  })
})

function replaceOnlyRow(
  input: SshLegacyMigrationInventoryInput,
  change: (row: SshLegacyRelayInventoryRow) => SshLegacyRelayInventoryRow
): SshLegacyMigrationInventoryInput {
  const relay = input.liveRelays[0]
  return { ...input, liveRelays: [{ ...relay, rows: [change(relay.rows[0])] }] }
}

function combine(
  first: SshLegacyMigrationInventoryInput,
  second: SshLegacyMigrationInventoryInput
): SshLegacyMigrationInventoryInput {
  return {
    ...first,
    persistedPtyLeases: [...first.persistedPtyLeases, ...second.persistedPtyLeases],
    localLayoutPanes: [...first.localLayoutPanes, ...second.localLayoutPanes],
    remoteSnapshotPanes: [...first.remoteSnapshotPanes, ...second.remoteSnapshotPanes],
    liveRelays: [...first.liveRelays, ...second.liveRelays]
  }
}
