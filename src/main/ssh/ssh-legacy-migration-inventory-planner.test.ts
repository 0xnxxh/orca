import { describe, expect, it } from 'vitest'
import { assertTerminalLegacyMigrationImportRequest } from '../../shared/terminal-legacy-cutover-request-validation'
import {
  floatingWorkspace,
  folderWorkspace,
  gitWorkspace,
  makeSshLegacyInventoryScenario
} from './__tests__/ssh-legacy-migration-inventory'
import {
  planSshLegacyMigrationInventory,
  type SshLegacyMigrationInventoryInput
} from './ssh-legacy-migration-inventory-planner'

describe('SSH legacy migration inventory planner', () => {
  it('imports generation zero without treating lease state or timestamps as liveness', () => {
    const input = makeSshLegacyInventoryScenario({ rendererGeneration: 0 })

    const plan = planSshLegacyMigrationInventory(input)

    expect(plan.imports).toHaveLength(1)
    expect(plan.unresolved).toEqual([])
    expect(plan.imports[0]).toMatchObject({
      pane: { paneGenerationId: 'renderer:0' },
      physicalPty: {
        workerId: 'worker-a',
        physicalPtyId: 'pty-1',
        ptyIncarnationId: 'incarnation-1',
        processId: 4_201
      },
      matchEvidence: {
        localLease: { rendererGeneration: 0 },
        uniqueness: {
          localCandidates: 1,
          remoteCandidates: 1,
          endpointIdentityMatched: true,
          processIdentityMatched: true
        }
      }
    })
    expect(input.persistedPtyLeases[0].state).toBe('expired')
    expect(plan.summary).toEqual({
      evidenceDigest: plan.evidenceDigest,
      migrationId: plan.migrationId,
      relayCount: 1,
      inventoryRowCount: 1,
      importCount: 1,
      unresolvedCount: 0,
      unresolvedReasons: []
    })
    expect(JSON.stringify(plan.summary)).not.toContain('/srv/private')
    expect(() => assertExactCandidateRequest(plan, input)).not.toThrow()
  })

  it('plans git, folder, and floating panes from separate persisted partitions', () => {
    const git = makeSshLegacyInventoryScenario({
      physicalPtyId: 'pty-git',
      ptyIncarnationId: 'inc-git',
      tabId: 'tab-git',
      leafId: 'leaf-git',
      namespaceId: 'namespace-git',
      localPartitionId: 'partition-local-git',
      snapshotPartitionId: 'partition-remote-git',
      workspace: gitWorkspace('/srv/private/git', 'repo::git')
    })
    const folder = makeSshLegacyInventoryScenario({
      physicalPtyId: 'pty-folder',
      ptyIncarnationId: 'inc-folder',
      processId: 4_202,
      tabId: 'tab-folder',
      leafId: 'leaf-folder',
      namespaceId: 'namespace-folder',
      localPartitionId: 'partition-local-folder',
      snapshotPartitionId: 'partition-remote-folder',
      workspace: folderWorkspace('/srv/private/folder')
    })
    const floating = makeSshLegacyInventoryScenario({
      physicalPtyId: 'pty-floating',
      ptyIncarnationId: 'inc-floating',
      processId: 4_203,
      tabId: 'tab-floating',
      leafId: 'leaf-floating',
      namespaceId: 'namespace-floating',
      localPartitionId: 'partition-local-floating',
      snapshotPartitionId: 'partition-remote-floating',
      workspace: floatingWorkspace()
    })

    const plan = planSshLegacyMigrationInventory(combineScenarios(git, folder, floating))

    expect(plan.unresolved).toEqual([])
    expect(plan.imports).toHaveLength(3)
    expect(new Set(plan.imports.map((candidate) => candidate.workspace.kind))).toEqual(
      new Set(['git-worktree', 'folder', 'floating'])
    )
    expect(new Set(plan.imports.map((candidate) => candidate.namespace.namespaceId))).toEqual(
      new Set(['namespace-git', 'namespace-folder', 'namespace-floating'])
    )
    expect(JSON.stringify(plan.summary)).not.toContain('/srv/private')
  })

  it('uses the remote host path flavor for Windows folder locators', () => {
    const input = makeSshLegacyInventoryScenario({
      hostPathFlavor: 'windows',
      workspace: folderWorkspace('C:/Users/Alice/private-project', 'windows')
    })

    const plan = planSshLegacyMigrationInventory(input)

    expect(plan.imports).toHaveLength(1)
    expect(plan.imports[0].workspace).toMatchObject({
      kind: 'folder',
      locator: { kind: 'workspace', pathFlavor: 'windows' }
    })
    expect(JSON.stringify(plan.summary)).not.toContain('Alice')
  })

  it('keeps authority and recovery identity stable across target reconfiguration', () => {
    const beforeRename = makeSshLegacyInventoryScenario({
      targetId: 'routing-target-before',
      authorityHostId: 'stable-authority-host'
    })
    const afterRename = makeSshLegacyInventoryScenario({
      targetId: 'routing-target-after',
      authorityHostId: 'stable-authority-host'
    })

    const beforePlan = planSshLegacyMigrationInventory(beforeRename)
    const afterPlan = planSshLegacyMigrationInventory(afterRename)

    expect(beforePlan.imports[0].namespace.authorityHostId).toBe('stable-authority-host')
    expect(afterPlan).toEqual(beforePlan)
  })
})

function assertExactCandidateRequest(
  plan: ReturnType<typeof planSshLegacyMigrationInventory>,
  input: SshLegacyMigrationInventoryInput
): void {
  const relay = input.liveRelays[0]
  const endpoint = relay.identityProof.expectedEndpoint
  const process = relay.identityProof.expectedProcess
  if (endpoint?.kind !== 'unix-socket' || process === null) {
    throw new Error('test requires exact POSIX relay identity')
  }
  assertTerminalLegacyMigrationImportRequest({
    version: 1,
    migrationId: plan.migrationId,
    authorityHostId: plan.imports[0].namespace.authorityHostId,
    requestedAtMs: 0,
    mode: 'cutover',
    workerRoute: {
      routeId: 'route-a',
      workerId: relay.workerId,
      ownerIncarnationId: 'owner-incarnation-a',
      buildId: relay.buildId,
      relayDirectory: '/relay/build-a',
      socketPath: '/relay/private.sock',
      credentialFile: '/relay/private.credential',
      process,
      endpoint,
      sourceOwner: {
        clientInstanceId: 'client-a',
        ownerGeneration: 1,
        ownerLease: 'owner-lease-a',
        outputWindowSourceUnits: 1
      },
      gcProtection: {
        relayDirectories: ['/relay/build-a'],
        evidencePaths: ['/relay/private.sock', '/relay/private.credential']
      }
    },
    cutover: {
      kind: 'posix-relocated',
      publicCredentialFile: '/relay/public.credential',
      privateCredentialFile: '/relay/private.credential',
      brokerClientCount: 1,
      acceptedConnectionCount: 1,
      quiescenceSamples: 2,
      connectionProof: {
        method: 'linux-procfs-unix',
        listenerIdentity: 'listener-a',
        brokerConnectionIdentity: 'broker-a',
        acceptedServerConnections: 1
      },
      graceConfiguration: {
        capabilityVersion: 1,
        configuredGraceMs: 0,
        acknowledged: true
      },
      sealedAtMs: 0,
      publicSocketPath: '/relay/public.sock',
      privateSocketPath: '/relay/private.sock',
      endpointIdentity: endpoint
    },
    imports: plan.imports,
    unresolved: []
  })
}

function combineScenarios(
  first: SshLegacyMigrationInventoryInput,
  ...rest: readonly SshLegacyMigrationInventoryInput[]
): SshLegacyMigrationInventoryInput {
  const scenarios = [first, ...rest]
  return {
    targetId: first.targetId,
    authorityHostId: first.authorityHostId,
    hostPathFlavor: first.hostPathFlavor,
    persistedConsumerRecoveries: first.persistedConsumerRecoveries,
    persistedPtyLeases: scenarios.flatMap((scenario) => scenario.persistedPtyLeases),
    localLayoutPanes: scenarios.flatMap((scenario) => scenario.localLayoutPanes),
    remoteSnapshotPanes: scenarios.flatMap((scenario) => scenario.remoteSnapshotPanes),
    liveRelays: scenarios.flatMap((scenario) => scenario.liveRelays)
  }
}
