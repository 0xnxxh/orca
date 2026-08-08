import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import type { TerminalLegacyWorkspaceEvidence } from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityPathFlavor } from '../../shared/terminal-session-authority-locator'
import { makePaneKey } from '../../shared/stable-pane-id'
import { toAppSshPtyId } from '../../shared/ssh-pty-id'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../shared/types'
import {
  SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY,
  SshLegacyMigrationEvidenceError,
  buildSshLegacyMigrationInventoryInput,
  parseSshLegacyRemoteWorkspaceSnapshotEvidence,
  type SshLegacyDiscoveredRelayEvidence,
  type SshLegacyMigrationEvidenceBridgeInput,
  type SshLegacyPersistedWorkspacePartition,
  type SshLegacyWorkerRecoveryAssociation,
  type SshLegacyWorkspaceResolution,
  type SshLegacyWorkspaceResolutionRequest
} from './ssh-legacy-migration-evidence-bridge'
import {
  floatingWorkspace,
  folderWorkspace,
  gitWorkspace
} from './__tests__/ssh-legacy-migration-inventory'
import { planSshLegacyMigrationInventory } from './ssh-legacy-migration-inventory-planner'

const DEFAULT_LEAF_ID = '00000000-0000-4000-8000-000000000001'

describe('SSH legacy migration evidence bridge', () => {
  it('constructs an exact generation-zero import without liveness or client namespace guesses', async () => {
    const scenario = makeScenario({
      clientWorkspaceId: 'client-repo-id::/client/private/repo',
      canonicalWorkspace: gitWorkspace(
        '/authority/canonical/repo',
        'authority-repo-id::/authority/canonical/repo'
      )
    })

    const inventory = await buildSshLegacyMigrationInventoryInput(scenario.input)
    const plan = planSshLegacyMigrationInventory(inventory)

    expect(plan.imports).toHaveLength(1)
    expect(plan.unresolved).toEqual([])
    expect(plan.imports[0]).toMatchObject({
      namespace: { authorityHostId: 'authority-host', namespaceId: 'authority-namespace' },
      pane: { paneGenerationId: 'renderer:0' },
      matchEvidence: { localLease: { rendererGeneration: 0 } }
    })
    expect(inventory.persistedPtyLeases[0]).toMatchObject({
      state: 'expired',
      worktreeId: 'authority-repo-id::/authority/canonical/repo'
    })
    expect(inventory.liveRelays[0].rows[0].serialized.worktreeId).toBe(
      'authority-repo-id::/authority/canonical/repo'
    )
    expect(new Set(scenario.requests.map((request) => request.source))).toEqual(
      new Set(['local-layout', 'remote-snapshot', 'relay-inventory'])
    )
    expect(scenario.requests.map((request) => request.reference)).toContainEqual({
      kind: 'git-worktree',
      clientWorkspaceId: 'client-repo-id::/client/private/repo',
      path: '/client/private/repo'
    })
    expect(JSON.stringify(plan.summary)).not.toContain('/client/private')
    expect(JSON.stringify(plan.summary)).not.toContain('/authority/canonical')
  })

  it('preserves Windows folder paths and floating paths until authority resolution', async () => {
    const windowsFolder = makeScenario({
      hostPathFlavor: 'windows',
      workspaceKind: 'folder',
      clientWorkspaceId: 'folder:client-folder-id',
      localPath: 'C:\\Users\\Alice\\client-folder',
      remotePath: 'C:\\Users\\Alice\\snapshot-folder',
      relayPath: 'C:\\Users\\Alice\\relay-folder',
      canonicalWorkspace: folderWorkspace('C:/Authority/Canonical Folder', 'windows')
    })
    const floating = makeScenario({
      workspaceKind: 'floating',
      clientWorkspaceId: FLOATING_TERMINAL_WORKTREE_ID,
      localPath: '/client/floating-cwd',
      remotePath: '/snapshot/floating-cwd',
      relayPath: '/relay/floating-cwd',
      canonicalWorkspace: floatingWorkspace()
    })

    const folderInventory = await buildSshLegacyMigrationInventoryInput(windowsFolder.input)
    const floatingInventory = await buildSshLegacyMigrationInventoryInput(floating.input)

    expect(planSshLegacyMigrationInventory(folderInventory).imports[0].workspace).toEqual(
      folderWorkspace('C:/Authority/Canonical Folder', 'windows')
    )
    expect(folderInventory.persistedPtyLeases[0].worktreeId).toBeUndefined()
    expect(folderInventory.liveRelays[0].rows[0].serialized.worktreeId).toBeNull()
    expect(windowsFolder.requests.map(referencePath)).toEqual([
      'C:\\Users\\Alice\\client-folder',
      'C:\\Users\\Alice\\snapshot-folder',
      'C:\\Users\\Alice\\relay-folder'
    ])
    expect(planSshLegacyMigrationInventory(floatingInventory).imports[0].workspace).toEqual(
      floatingWorkspace()
    )
    expect(floatingInventory.persistedPtyLeases[0].worktreeId).toBeUndefined()
    expect(floatingInventory.liveRelays[0].rows[0].serialized.worktreeId).toBeNull()
    expect(floating.requests.map(referencePath)).toEqual([
      '/client/floating-cwd',
      '/snapshot/floating-cwd',
      '/relay/floating-cwd'
    ])
  })

  it('excludes other targets but leaves same-target cross-partition evidence ambiguous', async () => {
    const scenario = makeScenario()
    const wrongTarget = 'other-target'
    const wrongPartition = {
      ...scenario.partition,
      targetId: wrongTarget,
      partitionId: 'wrong-target-partition'
    }
    const wrongLease = { ...scenario.input.persistedPtyLeases[0], targetId: wrongTarget }
    const wrongRecovery = {
      ...scenario.association,
      targetId: wrongTarget,
      recovery: { ...scenario.association.recovery, targetId: wrongTarget }
    }
    const wrongRelay = {
      ...scenario.relay,
      targetId: wrongTarget,
      endpointId: 'wrong-target-endpoint'
    }
    const scoped = await buildSshLegacyMigrationInventoryInput({
      ...scenario.input,
      persistedWorkspacePartitions: [wrongPartition, scenario.partition],
      persistedPtyLeases: [wrongLease, ...scenario.input.persistedPtyLeases],
      workerRecoveries: [wrongRecovery, scenario.association],
      remoteSnapshotPanes: [
        { ...scenario.input.remoteSnapshotPanes[0], targetId: wrongTarget },
        ...scenario.input.remoteSnapshotPanes
      ],
      discoveredRelays: [wrongRelay, scenario.relay]
    })

    expect(planSshLegacyMigrationInventory(scoped).imports).toHaveLength(1)
    expect(scoped.localLayoutPanes.map((pane) => pane.partitionId)).toEqual(['local-partition'])

    const ambiguous = await buildSshLegacyMigrationInventoryInput({
      ...scenario.input,
      persistedWorkspacePartitions: [
        scenario.partition,
        { ...scenario.partition, partitionId: 'second-local-partition' }
      ]
    })
    const ambiguousPlan = planSshLegacyMigrationInventory(ambiguous)
    expect(ambiguousPlan.imports).toEqual([])
    expect(ambiguousPlan.unresolved[0].reason).toBe('ambiguous-pane-generation')
  })

  it('requires one explicit recovery association per target endpoint, worker, and build', async () => {
    const first = makeScenario({
      physicalPtyId: 'pty-first',
      workerId: 'worker-first',
      endpointId: 'endpoint-first',
      buildId: 'shared-build',
      clientWorkspaceId: 'client-first::/client/first',
      canonicalWorkspace: gitWorkspace('/authority/first', 'authority::/authority/first')
    })
    const second = makeScenario({
      physicalPtyId: 'pty-second',
      workerId: 'worker-second',
      endpointId: 'endpoint-second',
      buildId: 'shared-build',
      tabId: 'tab-second',
      leafId: '00000000-0000-4000-8000-000000000002',
      partitionId: 'partition-second',
      clientWorkspaceId: 'client-second::/client/second',
      remotePath: '/snapshot/second',
      canonicalWorkspace: gitWorkspace('/authority/second', 'authority::/authority/second')
    })
    const combined = combineScenarios(first, second)

    const inventory = await buildSshLegacyMigrationInventoryInput(combined)
    expect(inventory.persistedConsumerRecoveries).toEqual([
      {
        targetId: 'target-a',
        workerId: 'worker-first',
        clientInstanceId: 'recovery-worker-first',
        serverBuildId: 'shared-build'
      },
      {
        targetId: 'target-a',
        workerId: 'worker-second',
        clientInstanceId: 'recovery-worker-second',
        serverBuildId: 'shared-build'
      }
    ])
    expect(planSshLegacyMigrationInventory(inventory).imports).toHaveLength(2)

    const reusedRecovery = {
      ...second.association,
      recovery: first.association.recovery
    }
    await expect(
      buildSshLegacyMigrationInventoryInput({
        ...combined,
        workerRecoveries: [first.association, reusedRecovery]
      })
    ).rejects.toMatchObject({ code: 'ambiguity' })
  })

  it('keeps stale or incomplete evidence unresolved and is deterministic after reordering', async () => {
    const first = makeScenario()
    const second = makeScenario({
      physicalPtyId: 'pty-two',
      workerId: 'worker-two',
      endpointId: 'endpoint-two',
      buildId: 'build-two',
      tabId: 'tab-two',
      leafId: '00000000-0000-4000-8000-000000000002',
      partitionId: 'partition-two',
      clientWorkspaceId: 'client-two::/client/two',
      remotePath: '/snapshot/two',
      canonicalWorkspace: gitWorkspace('/authority/two', 'authority::/authority/two')
    })
    const combined = combineScenarios(first, second)
    const reordered = {
      ...combined,
      persistedWorkspacePartitions: combined.persistedWorkspacePartitions.toReversed(),
      persistedPtyLeases: combined.persistedPtyLeases.toReversed(),
      workerRecoveries: combined.workerRecoveries.toReversed(),
      remoteSnapshotPanes: combined.remoteSnapshotPanes.toReversed(),
      discoveredRelays: combined.discoveredRelays
        .toReversed()
        .map((relay) => ({ ...relay, rows: relay.rows.toReversed() }))
    }
    const originalPlan = planSshLegacyMigrationInventory(
      await buildSshLegacyMigrationInventoryInput(combined)
    )
    const reorderedPlan = planSshLegacyMigrationInventory(
      await buildSshLegacyMigrationInventoryInput(reordered)
    )

    expect(reorderedPlan).toEqual(originalPlan)

    const staleInventory = await buildSshLegacyMigrationInventoryInput({
      ...first.input,
      remoteSnapshotPanes: [{ ...first.input.remoteSnapshotPanes[0], rendererGeneration: 1 }]
    })
    expect(planSshLegacyMigrationInventory(staleInventory).unresolved[0].reason).toBe(
      'workspace-mismatch'
    )

    const relay = first.relay
    const incompleteInventory = await buildSshLegacyMigrationInventoryInput({
      ...first.input,
      discoveredRelays: [
        {
          ...relay,
          rows: relay.rows.map((row) => ({
            ...row,
            processId: null,
            serialized: { ...row.serialized, processId: null }
          }))
        }
      ]
    })
    expect(planSshLegacyMigrationInventory(incompleteInventory).unresolved[0].reason).toBe(
      'physical-pty-incarnation-unproved'
    )
  })

  it('rejects oversized top-level evidence before scanning malformed entries', async () => {
    const scenario = makeScenario()
    const malformedOversized = Array.from(
      { length: SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.workspacePartitions + 1 },
      () => null as never
    )

    await expect(
      buildSshLegacyMigrationInventoryInput({
        ...scenario.input,
        persistedWorkspacePartitions: malformedOversized,
        discoveredRelays: [null as never]
      })
    ).rejects.toBeInstanceOf(SshLegacyMigrationEvidenceError)
    await expect(
      buildSshLegacyMigrationInventoryInput({
        ...scenario.input,
        persistedWorkspacePartitions: malformedOversized,
        discoveredRelays: [null as never]
      })
    ).rejects.toMatchObject({ code: 'capacity' })
  })
})

type ScenarioOptions = Readonly<{
  targetId?: string
  authorityHostId?: string
  hostPathFlavor?: TerminalAuthorityPathFlavor
  endpointId?: string
  workerId?: string
  buildId?: string
  physicalPtyId?: string
  ptyIncarnationId?: string
  processId?: number
  tabId?: string
  leafId?: string
  partitionId?: string
  generation?: number
  workspaceKind?: 'git' | 'folder' | 'floating'
  clientWorkspaceId?: string
  localPath?: string
  remotePath?: string
  relayPath?: string
  canonicalWorkspace?: TerminalLegacyWorkspaceEvidence
}>

type Scenario = Readonly<{
  input: SshLegacyMigrationEvidenceBridgeInput
  partition: SshLegacyPersistedWorkspacePartition
  association: SshLegacyWorkerRecoveryAssociation
  relay: SshLegacyDiscoveredRelayEvidence
  resolution: SshLegacyWorkspaceResolution
  requests: SshLegacyWorkspaceResolutionRequest[]
  ownsRequest: (request: SshLegacyWorkspaceResolutionRequest) => boolean
}>

function makeScenario(options: ScenarioOptions = {}): Scenario {
  const targetId = options.targetId ?? 'target-a'
  const authorityHostId = options.authorityHostId ?? 'authority-host'
  const hostPathFlavor = options.hostPathFlavor ?? 'posix'
  const endpointId = options.endpointId ?? 'endpoint-a'
  const workerId = options.workerId ?? 'worker-a'
  const buildId = options.buildId ?? 'build-a'
  const physicalPtyId = options.physicalPtyId ?? 'pty-a'
  const ptyIncarnationId = options.ptyIncarnationId ?? 'incarnation-a'
  const processId = options.processId ?? 4_201
  const tabId = options.tabId ?? 'tab-a'
  const leafId = options.leafId ?? DEFAULT_LEAF_ID
  const partitionId = options.partitionId ?? 'local-partition'
  const generation = options.generation ?? 0
  const workspaceKind = options.workspaceKind ?? 'git'
  const clientWorkspaceId =
    options.clientWorkspaceId ??
    (workspaceKind === 'folder'
      ? 'folder:folder-a'
      : workspaceKind === 'floating'
        ? FLOATING_TERMINAL_WORKTREE_ID
        : 'client-repo::/client/repo')
  const localPath = options.localPath ?? '/client/repo'
  const remotePath = options.remotePath ?? '/snapshot/repo'
  const relayPath = options.relayPath ?? '/relay/repo'
  const canonicalWorkspace =
    options.canonicalWorkspace ?? gitWorkspace('/authority/repo', 'authority::/authority/repo')
  const appPtyId = toAppSshPtyId(targetId, physicalPtyId)
  const paneKey = makePaneKey(tabId, leafId)
  const localTab = makeTab({ tabId, ptyId: appPtyId, worktreeId: clientWorkspaceId, generation })
  const partition = makePartition({
    targetId,
    partitionId,
    workspaceKind,
    clientWorkspaceId,
    localPath,
    tab: localTab,
    leafId,
    appPtyId
  })
  const remoteSnapshotPanes = parseSshLegacyRemoteWorkspaceSnapshotEvidence({
    targetId,
    partitionId: `remote-${partitionId}`,
    snapshot: makeRemoteSnapshot({
      workspaceKind,
      workspacePath: remotePath,
      tab: localTab,
      leafId,
      appPtyId
    })
  })
  const resolution = Object.freeze({
    namespace: Object.freeze({ authorityHostId, namespaceId: 'authority-namespace' }),
    workspace: canonicalWorkspace
  })
  const association = makeRecoveryAssociation({ targetId, endpointId, workerId, buildId })
  const relay = makeRelay({
    targetId,
    endpointId,
    workerId,
    buildId,
    physicalPtyId,
    ptyIncarnationId,
    processId,
    paneKey,
    tabId,
    clientWorkspaceId,
    workspaceKind,
    relayPath,
    hostPathFlavor
  })
  const requests: SshLegacyWorkspaceResolutionRequest[] = []
  const ownsRequest = (request: SshLegacyWorkspaceResolutionRequest): boolean =>
    request.reference.kind === 'workspace-path'
      ? request.reference.path === remotePath
      : 'clientWorkspaceId' in request.reference &&
        request.reference.clientWorkspaceId === clientWorkspaceId
  const input: SshLegacyMigrationEvidenceBridgeInput = {
    targetId,
    authorityHostId,
    hostPathFlavor,
    persistedWorkspacePartitions: [partition],
    persistedPtyLeases: [
      {
        targetId,
        ptyId: physicalPtyId,
        incarnationId: ptyIncarnationId,
        worktreeId: clientWorkspaceId,
        tabId,
        leafId,
        paneGeneration: generation,
        state: 'expired',
        createdAt: 99_999,
        updatedAt: 1
      }
    ],
    workerRecoveries: [association],
    remoteSnapshotPanes,
    discoveredRelays: [relay],
    resolveWorkspace: (request) => {
      requests.push(request)
      return resolution
    }
  }
  return { input, partition, association, relay, resolution, requests, ownsRequest }
}

function makePartition(args: {
  targetId: string
  partitionId: string
  workspaceKind: 'git' | 'folder' | 'floating'
  clientWorkspaceId: string
  localPath: string
  tab: TerminalTab
  leafId: string
  appPtyId: string
}): SshLegacyPersistedWorkspacePartition {
  const folderId = args.clientWorkspaceId.startsWith('folder:')
    ? args.clientWorkspaceId.slice('folder:'.length)
    : 'unused-folder'
  return {
    targetId: args.targetId,
    partitionId: args.partitionId,
    session: {
      tabsByWorktree: { [args.clientWorkspaceId]: [args.tab] },
      terminalLayoutsByTabId: { [args.tab.id]: makeLayout(args.leafId, args.appPtyId) }
    },
    folderWorkspaces:
      args.workspaceKind === 'folder' ? [{ id: folderId, folderPath: args.localPath }] : [],
    ...(args.workspaceKind === 'floating' ? { floatingWorkspacePath: args.localPath } : {})
  }
}

function makeRemoteSnapshot(args: {
  workspaceKind: 'git' | 'folder' | 'floating'
  workspacePath: string
  tab: TerminalTab
  leafId: string
  appPtyId: string
}): unknown {
  const { worktreeId: _worktreeId, ...tab } = args.tab
  void _worktreeId
  const workspacePath =
    args.workspaceKind === 'floating' ? FLOATING_TERMINAL_WORKTREE_ID : args.workspacePath
  return {
    namespace: 'client-routing-namespace',
    revision: 1,
    updatedAt: 123,
    schemaVersion: 1,
    session: {
      tabsByWorktreePath: {
        [workspacePath]: [
          {
            ...tab,
            worktreePath: workspacePath,
            ...(args.workspaceKind === 'floating' ? { startupCwd: args.workspacePath } : {})
          }
        ]
      },
      terminalLayoutsByTabId: { [args.tab.id]: makeLayout(args.leafId, args.appPtyId) }
    }
  }
}

function makeTab(args: {
  tabId: string
  ptyId: string
  worktreeId: string
  generation: number
}): TerminalTab {
  return {
    id: args.tabId,
    ptyId: args.ptyId,
    worktreeId: args.worktreeId,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    generation: args.generation,
    ...(args.worktreeId === FLOATING_TERMINAL_WORKTREE_ID
      ? { startupCwd: '/client/floating-cwd' }
      : {})
  }
}

function makeLayout(leafId: string, ptyId: string): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ptyIdsByLeafId: { [leafId]: ptyId }
  }
}

function makeRecoveryAssociation(args: {
  targetId: string
  endpointId: string
  workerId: string
  buildId: string
}): SshLegacyWorkerRecoveryAssociation {
  return {
    ...args,
    recovery: {
      targetId: args.targetId,
      clientInstanceId: `recovery-${args.workerId}`,
      serverBuildId: args.buildId,
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: `lease-${args.workerId}`
    }
  }
}

function makeRelay(args: {
  targetId: string
  endpointId: string
  workerId: string
  buildId: string
  physicalPtyId: string
  ptyIncarnationId: string
  processId: number
  paneKey: string
  tabId: string
  clientWorkspaceId: string
  workspaceKind: 'git' | 'folder' | 'floating'
  relayPath: string
  hostPathFlavor: TerminalAuthorityPathFlavor
}): SshLegacyDiscoveredRelayEvidence {
  const endpoint =
    args.hostPathFlavor === 'windows'
      ? ({
          kind: 'windows-named-pipe' as const,
          pipeName: '\\\\.\\pipe\\orca-legacy',
          processCreationMarker: 'process-created-a'
        } as const)
      : ({ kind: 'unix-socket' as const, device: '1', inode: '2', changedAtNs: '3' } as const)
  const process = Object.freeze({ pid: 9_001, birthMarker: `birth-${args.workerId}` })
  const workspaceReference =
    args.workspaceKind === 'folder'
      ? ({
          kind: 'folder-workspace' as const,
          clientWorkspaceId: args.clientWorkspaceId,
          path: args.relayPath
        } as const)
      : args.workspaceKind === 'floating'
        ? ({
            kind: 'floating' as const,
            clientWorkspaceId: args.clientWorkspaceId,
            path: args.relayPath
          } as const)
        : ({
            kind: 'git-worktree' as const,
            clientWorkspaceId: args.clientWorkspaceId,
            path: args.relayPath
          } as const)
  return {
    targetId: args.targetId,
    endpointId: args.endpointId,
    workerId: args.workerId,
    buildId: args.buildId,
    observedAtMs: 777,
    identityProof: {
      expectedEndpoint: endpoint,
      observedEndpoint: endpoint,
      expectedProcess: process,
      observedProcess: process
    },
    rows: [
      {
        physicalPtyId: args.physicalPtyId,
        ptyIncarnationId: args.ptyIncarnationId,
        processId: args.processId,
        workspaceReference,
        serialized: {
          paneKey: args.paneKey,
          tabId: args.tabId,
          worktreeId: args.clientWorkspaceId,
          cwd: args.relayPath,
          ptyIncarnationId: args.ptyIncarnationId,
          processId: args.processId
        }
      }
    ]
  }
}

function combineScenarios(
  ...scenarios: readonly Scenario[]
): SshLegacyMigrationEvidenceBridgeInput {
  const first = scenarios[0]
  return {
    ...first.input,
    persistedWorkspacePartitions: scenarios.flatMap(
      (scenario) => scenario.input.persistedWorkspacePartitions
    ),
    persistedPtyLeases: scenarios.flatMap((scenario) => scenario.input.persistedPtyLeases),
    workerRecoveries: scenarios.flatMap((scenario) => scenario.input.workerRecoveries),
    remoteSnapshotPanes: scenarios.flatMap((scenario) => scenario.input.remoteSnapshotPanes),
    discoveredRelays: scenarios.flatMap((scenario) => scenario.input.discoveredRelays),
    resolveWorkspace: (request) => {
      const owner = scenarios.find((scenario) => scenario.ownsRequest(request))
      if (!owner) {
        throw new Error('unexpected workspace resolution request')
      }
      return owner.resolution
    }
  }
}

function referencePath(request: SshLegacyWorkspaceResolutionRequest): string | null {
  return request.reference.path
}
