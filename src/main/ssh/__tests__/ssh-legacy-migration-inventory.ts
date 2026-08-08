import type { TerminalLegacyWorkspaceEvidence } from '../../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityPathFlavor } from '../../../shared/terminal-session-authority-locator'
import { toAppSshPtyId } from '../../../shared/ssh-pty-id'
import type { SshLegacyMigrationInventoryInput } from '../ssh-legacy-migration-inventory-types'

export const SSH_LEGACY_SCENARIO_TARGET = 'target-a'

export type SshLegacyInventoryScenarioOptions = Readonly<{
  targetId?: string
  authorityHostId?: string
  workerId?: string
  buildId?: string
  physicalPtyId?: string
  ptyIncarnationId?: string
  processId?: number
  tabId?: string
  leafId?: string
  rendererGeneration?: number
  namespaceId?: string
  localPartitionId?: string
  snapshotPartitionId?: string
  hostPathFlavor?: TerminalAuthorityPathFlavor
  workspace?: TerminalLegacyWorkspaceEvidence
}>

export function makeSshLegacyInventoryScenario(
  options: SshLegacyInventoryScenarioOptions = {}
): SshLegacyMigrationInventoryInput {
  const targetId = options.targetId ?? SSH_LEGACY_SCENARIO_TARGET
  const authorityHostId = options.authorityHostId ?? 'authority-host-a'
  const workerId = options.workerId ?? 'worker-a'
  const buildId = options.buildId ?? 'build-a'
  const physicalPtyId = options.physicalPtyId ?? 'pty-1'
  const ptyIncarnationId = options.ptyIncarnationId ?? 'incarnation-1'
  const processId = options.processId ?? 4_201
  const tabId = options.tabId ?? 'tab-a'
  const leafId = options.leafId ?? 'leaf-a'
  const rendererGeneration = options.rendererGeneration ?? 0
  const hostPathFlavor = options.hostPathFlavor ?? 'posix'
  const workspace = options.workspace ?? gitWorkspace('/srv/private/repo-a', 'repo-a::worktree-a')
  const namespace = Object.freeze({
    authorityHostId,
    namespaceId: options.namespaceId ?? 'namespace-a'
  })
  const appPtyId = toAppSshPtyId(targetId, physicalPtyId)
  const paneKey = `${tabId}:${leafId}`
  const worktreeId = workspace.kind === 'git-worktree' ? workspace.worktreeId : undefined
  const serializedWorktreeId = worktreeId ?? null
  const cwd = workspace.locator.kind === 'workspace' ? workspace.locator.canonicalPath : '/tmp'
  const pane = Object.freeze({
    targetId,
    partitionId: options.localPartitionId ?? 'local-partition-a',
    ptyId: appPtyId,
    paneKey,
    tabId,
    leafId,
    rendererGeneration,
    namespace,
    workspace
  })
  const endpoint = Object.freeze({
    kind: 'unix-socket' as const,
    device: '11',
    inode: '22',
    changedAtNs: '33'
  })
  const relayProcess = Object.freeze({ pid: 9_001, birthMarker: 'relay-birth-a' })

  return Object.freeze({
    targetId,
    authorityHostId,
    hostPathFlavor,
    persistedConsumerRecoveries: Object.freeze([
      Object.freeze({
        targetId,
        workerId,
        clientInstanceId: 'consumer-recovery-a',
        serverBuildId: buildId
      })
    ]),
    persistedPtyLeases: Object.freeze([
      Object.freeze({
        targetId,
        ptyId: appPtyId,
        incarnationId: ptyIncarnationId,
        ...(worktreeId ? { worktreeId } : {}),
        tabId,
        leafId,
        paneGeneration: rendererGeneration,
        state: 'expired' as const,
        createdAt: 1,
        updatedAt: 2
      })
    ]),
    localLayoutPanes: Object.freeze([pane]),
    remoteSnapshotPanes: Object.freeze([
      Object.freeze({
        ...pane,
        partitionId: options.snapshotPartitionId ?? 'remote-partition-a'
      })
    ]),
    liveRelays: Object.freeze([
      Object.freeze({
        workerId,
        buildId,
        observedAtMs: 123,
        identityProof: Object.freeze({
          expectedEndpoint: endpoint,
          observedEndpoint: endpoint,
          expectedProcess: relayProcess,
          observedProcess: relayProcess
        }),
        rows: Object.freeze([
          Object.freeze({
            workerId,
            buildId,
            physicalPtyId,
            ptyIncarnationId,
            processId,
            namespace,
            workspace,
            serialized: Object.freeze({
              paneKey,
              tabId,
              worktreeId: serializedWorktreeId,
              cwd,
              ptyIncarnationId,
              processId
            })
          })
        ])
      })
    ])
  })
}

export function gitWorkspace(
  canonicalPath: string,
  worktreeId: string,
  pathFlavor: TerminalAuthorityPathFlavor = 'posix'
): TerminalLegacyWorkspaceEvidence {
  return Object.freeze({
    kind: 'git-worktree',
    locator: Object.freeze({ kind: 'workspace', canonicalPath, pathFlavor }),
    worktreeId
  })
}

export function folderWorkspace(
  canonicalPath: string,
  pathFlavor: TerminalAuthorityPathFlavor = 'posix'
): TerminalLegacyWorkspaceEvidence {
  return Object.freeze({
    kind: 'folder',
    locator: Object.freeze({ kind: 'workspace', canonicalPath, pathFlavor })
  })
}

export function floatingWorkspace(): TerminalLegacyWorkspaceEvidence {
  return Object.freeze({ kind: 'floating', locator: Object.freeze({ kind: 'floating' }) })
}
