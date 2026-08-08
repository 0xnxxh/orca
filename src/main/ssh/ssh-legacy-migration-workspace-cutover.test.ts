import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import { TERMINAL_LEGACY_CUTOVER_CAPABILITY } from '../../shared/terminal-legacy-cutover'
import { toAppSshPtyId } from '../../shared/ssh-pty-id'
import type { SshTerminalAuthorityMarker } from '../../shared/ssh-terminal-authority-marker'
import type { TerminalAuthorityPathFlavor } from '../../shared/terminal-session-authority-locator'
import type { SshConnection } from './ssh-connection'
import { coordinateSshLegacyMigration } from './ssh-legacy-migration-coordinator'
import type {
  LegacyPhysicalWorkerDescriptor,
  SshLegacyInspectedWorker,
  SshLegacyPhysicalWorkerInspection
} from './ssh-legacy-migration-coordinator-types'
import { createSshLegacyMigrationEvidenceProvider } from './ssh-legacy-migration-evidence-provider'
import { sshLegacyEvidenceDigest } from './ssh-legacy-migration-evidence-identity'
import { FutureSshLegacyMigrationRpc } from './__tests__/ssh-legacy-migration-future-rpc'
import type { SshLegacyMigrationEvidenceStore } from './ssh-legacy-migration-store-evidence'
import type { RelayPlatform } from './relay-protocol'
import { getRemoteHostPlatform } from './ssh-remote-platform'

const execCommand = vi.hoisted(() => vi.fn())
vi.mock('./ssh-relay-exec-command', () => ({ execCommand }))

execCommand.mockResolvedValue(
  `ORCA_LEGACY_PRIOR_RELAY ${JSON.stringify({
    endpoint: { device: '2049', inode: '77', changedAtNs: '1700000000000000000' },
    liveness: 'alive'
  })}`
)

const TARGET_ID = 'target-a'
const HOST_ID = 'authority-host-a'
const PARTITION_ID = 'ssh:target-a'
const TAB_ID = 'tab-a'
const PHYSICAL_PTY_ID = 'pty-1'
const APP_PTY_ID = toAppSshPtyId(TARGET_ID, PHYSICAL_PTY_ID)
const PTY_INCARNATION_ID = 'incarnation-1'
const PROCESS_ID = 4_201
const BUILD_ID = '0.1.0+abc'
const GENERATION = 3

type Scenario = Readonly<{
  label: string
  flavor: TerminalAuthorityPathFlavor
  platform: RelayPlatform
  ownerKey: string
  hostPath: string
  worktreeId: string | null
  folderWorkspaces: readonly Readonly<{ id: string; folderPath: string }>[]
  remoteKey: string
  startupCwd?: string
}>

const SCENARIOS: readonly Scenario[] = [
  {
    label: 'a POSIX git worktree',
    flavor: 'posix',
    platform: 'linux-x64',
    ownerKey: 'repo-a::/srv/repos/repo-a',
    hostPath: '/srv/repos/repo-a',
    worktreeId: 'repo-a::/srv/repos/repo-a',
    folderWorkspaces: [],
    remoteKey: '/srv/repos/repo-a'
  },
  {
    label: 'a POSIX folder workspace',
    flavor: 'posix',
    platform: 'linux-x64',
    ownerKey: 'folder:folder-a',
    hostPath: '/srv/folders/a',
    worktreeId: null,
    folderWorkspaces: [{ id: 'folder-a', folderPath: '/srv/folders/a' }],
    remoteKey: '/srv/folders/a'
  },
  {
    label: 'a floating workspace',
    flavor: 'posix',
    platform: 'linux-x64',
    ownerKey: FLOATING_TERMINAL_WORKTREE_ID,
    hostPath: '/srv/float',
    worktreeId: null,
    folderWorkspaces: [],
    remoteKey: FLOATING_TERMINAL_WORKTREE_ID,
    startupCwd: '/srv/float'
  },
  {
    label: 'a Windows git worktree',
    flavor: 'windows',
    platform: 'win32-x64',
    ownerKey: 'repo-a::C:/repos/repo-a',
    hostPath: 'C:/repos/repo-a',
    worktreeId: 'repo-a::C:/repos/repo-a',
    folderWorkspaces: [],
    remoteKey: 'C:/repos/repo-a'
  }
]

function marker(scenario: Scenario): SshTerminalAuthorityMarker {
  const windows = scenario.flavor === 'windows'
  return {
    markerVersion: 1,
    authorityHostId: HOST_ID,
    ownerInstanceId: 'owner-prior',
    ownerPid: 9_001,
    ownerProcessToken: 'prior-process-token',
    ownerBuildId: BUILD_ID,
    ownerRelayDir: windows
      ? 'C:/Users/u/.orca-relay/relay-0.1.0+abc'
      : '/home/u/.orca-relay/relay-0.1.0+abc',
    socketPath: windows
      ? '\\\\.\\pipe\\orca-relay-0123456789abcdef0123'
      : '/home/u/.orca-relay/terminal-authority/authority.sock',
    credentialFile: windows
      ? 'C:/Users/u/.orca-relay/terminal-authority/endpoint.credential'
      : '/home/u/.orca-relay/terminal-authority/endpoint.credential',
    compatibility: {
      major: 1,
      minMinor: 0,
      maxMinor: 0,
      capabilities: [],
      requiredCapabilities: []
    },
    revision: 6
  }
}

function inspection(
  scenario: Scenario,
  descriptor: LegacyPhysicalWorkerDescriptor,
  paneKey: string
): SshLegacyPhysicalWorkerInspection {
  const evidence = {
    protocolVersion: 1 as const,
    workerId: descriptor.workerId,
    routeId: descriptor.routeId,
    buildId: descriptor.buildId,
    identityProof: {
      expectedEndpoint: descriptor.expectedEndpoint,
      observedEndpoint: descriptor.expectedEndpoint,
      expectedProcess: descriptor.process,
      observedProcess: descriptor.process
    },
    ptys: [
      {
        id: PHYSICAL_PTY_ID,
        incarnationId: PTY_INCARNATION_ID,
        processId: PROCESS_ID,
        cwd: scenario.hostPath,
        title: 'shell',
        serialized: {
          paneKey,
          tabId: TAB_ID,
          worktreeId: scenario.worktreeId,
          cwd: scenario.hostPath,
          ptyIncarnationId: PTY_INCARNATION_ID,
          processId: PROCESS_ID
        }
      }
    ]
  }
  return Object.freeze({
    ...evidence,
    preparation: {
      mode: 'observational' as const,
      token: 'token-a',
      evidenceDigest: sshLegacyEvidenceDigest(evidence),
      catalogValidation: 'before-isolation' as const,
      replay: 'durable-operation-id' as const
    }
  }) as SshLegacyPhysicalWorkerInspection
}

function store(scenario: Scenario, leafId: string): SshLegacyMigrationEvidenceStore {
  const layout = {
    root: { type: 'leaf', leafId },
    ptyIdsByLeafId: { [leafId]: APP_PTY_ID }
  }
  return {
    getSshRemotePtyLeases: () => [
      {
        targetId: TARGET_ID,
        ptyId: APP_PTY_ID,
        incarnationId: PTY_INCARNATION_ID,
        ...(scenario.worktreeId ? { worktreeId: scenario.worktreeId } : {}),
        tabId: TAB_ID,
        leafId,
        paneGeneration: GENERATION,
        state: 'attached',
        createdAt: 1,
        updatedAt: 1
      }
    ],
    getSshPtyConsumerRecovery: () => ({
      targetId: TARGET_ID,
      clientInstanceId: 'client-a',
      serverBuildId: BUILD_ID,
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: 'lease-a'
    }),
    getWorkspaceSessionHostIds: () => [PARTITION_ID],
    getWorkspaceSession: () => ({
      tabsByWorktree: {
        [scenario.ownerKey]: [
          {
            id: TAB_ID,
            ptyId: null,
            generation: GENERATION,
            ...(scenario.startupCwd ? { startupCwd: scenario.startupCwd } : {})
          }
        ]
      },
      terminalLayoutsByTabId: { [TAB_ID]: layout }
    }),
    getFolderWorkspaces: () => scenario.folderWorkspaces as never
  }
}

function remoteSnapshot(scenario: Scenario, leafId: string): unknown {
  return {
    session: {
      tabsByWorktreePath: {
        [scenario.remoteKey]: [
          {
            id: TAB_ID,
            ptyId: null,
            worktreePath: scenario.remoteKey,
            generation: GENERATION,
            ...(scenario.startupCwd ? { startupCwd: scenario.startupCwd } : {})
          }
        ]
      },
      terminalLayoutsByTabId: {
        [TAB_ID]: { root: { type: 'leaf', leafId }, ptyIdsByLeafId: { [leafId]: APP_PTY_ID } }
      }
    }
  }
}

describe('legacy cutover across workspace kinds and host path flavors', () => {
  it.each(SCENARIOS)('imports one exact binding for $label', async (scenario) => {
    const leafId = randomUUID()
    const paneKey = `${TAB_ID}:${leafId}`
    const provider = createSshLegacyMigrationEvidenceProvider({
      targetId: TARGET_ID,
      partitionId: PARTITION_ID,
      clientInstanceId: 'client-a',
      hostPlatform: getRemoteHostPlatform(scenario.platform),
      nodePath: '/usr/bin/node',
      priorRelayStatus: { kind: 'superseded', marker: marker(scenario) },
      store: store(scenario, leafId),
      connection: () => ({}) as SshConnection,
      remoteWorkspaceSnapshot: () => remoteSnapshot(scenario, leafId),
      isAttemptCurrent: () => true,
      now: () => 1_700
    })
    const context = {
      targetId: TARGET_ID,
      authorityHostId: HOST_ID,
      hostPathFlavor: scenario.flavor,
      attemptId: 'attempt-a'
    }
    const signal = new AbortController().signal
    const discovery = await provider.discoverWorkers({ ...context, signal })
    expect(discovery.kind).toBe('ready')
    const workers: SshLegacyInspectedWorker[] =
      discovery.kind === 'ready'
        ? discovery.workers.map((descriptor) => ({
            descriptor,
            inspection: inspection(scenario, descriptor, paneKey)
          }))
        : []
    const outcome = await coordinateSshLegacyMigration({
      ...context,
      authorityCapabilities: [TERMINAL_LEGACY_CUTOVER_CAPABILITY],
      signal,
      isAttemptCurrent: () => true,
      rpc: new FutureSshLegacyMigrationRpc(workers),
      evidenceProvider: provider
    })
    expect(outcome.kind).toBe('committed')
    expect(outcome.kind === 'committed' && outcome.summary).toMatchObject({
      importCount: 1,
      unresolvedCount: 0,
      relayCount: 1
    })
  })
})
