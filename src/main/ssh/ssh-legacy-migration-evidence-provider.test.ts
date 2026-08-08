import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { TERMINAL_LEGACY_CUTOVER_CAPABILITY } from '../../shared/terminal-legacy-cutover'
import { toAppSshPtyId } from '../../shared/ssh-pty-id'
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
import { getRemoteHostPlatform } from './ssh-remote-platform'

const execCommand = vi.hoisted(() => vi.fn())
vi.mock('./ssh-relay-exec-command', () => ({ execCommand }))

const TARGET_ID = 'target-a'
const HOST_ID = 'authority-host-a'
const PARTITION_ID = 'ssh:target-a'
const WORKTREE_PATH = '/srv/repos/repo-a'
const WORKTREE_ID = `repo-a::${WORKTREE_PATH}`
const TAB_ID = 'tab-a'
const LEAF_ID = randomUUID()
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const PHYSICAL_PTY_ID = 'pty-1'
const APP_PTY_ID = toAppSshPtyId(TARGET_ID, PHYSICAL_PTY_ID)
const PTY_INCARNATION_ID = 'incarnation-1'
const PROCESS_ID = 4_201
const BUILD_ID = '0.1.0+abc'
const CLIENT_INSTANCE_ID = 'client-a'
const ENDPOINT = Object.freeze({
  kind: 'unix-socket' as const,
  device: '2049',
  inode: '77',
  changedAtNs: '1700000000000000000'
})

execCommand.mockResolvedValue(
  `ORCA_LEGACY_PRIOR_RELAY ${JSON.stringify({
    endpoint: { device: '2049', inode: '77', changedAtNs: '1700000000000000000' },
    liveness: 'alive'
  })}`
)

const MARKER = Object.freeze({
  markerVersion: 1,
  authorityHostId: HOST_ID,
  ownerInstanceId: 'owner-prior',
  ownerPid: 9_001,
  ownerProcessToken: 'prior-process-token',
  ownerBuildId: BUILD_ID,
  ownerRelayDir: '/home/u/.orca-relay/relay-0.1.0+abc',
  socketPath: '/home/u/.orca-relay/terminal-authority/authority.sock',
  credentialFile: '/home/u/.orca-relay/terminal-authority/endpoint.credential',
  compatibility: { major: 1, minMinor: 0, maxMinor: 0, capabilities: [], requiredCapabilities: [] },
  revision: 6
})

function layout(): Record<string, unknown> {
  return {
    root: { type: 'leaf', leafId: LEAF_ID },
    ptyIdsByLeafId: { [LEAF_ID]: APP_PTY_ID }
  }
}

function storeDouble(
  overrides: Partial<SshLegacyMigrationEvidenceStore> = {}
): SshLegacyMigrationEvidenceStore {
  return {
    getSshRemotePtyLeases: () => [
      {
        targetId: TARGET_ID,
        ptyId: APP_PTY_ID,
        incarnationId: PTY_INCARNATION_ID,
        worktreeId: WORKTREE_ID,
        tabId: TAB_ID,
        leafId: LEAF_ID,
        paneGeneration: 3,
        state: 'attached',
        createdAt: 1,
        updatedAt: 1
      }
    ],
    getSshPtyConsumerRecovery: () => ({
      targetId: TARGET_ID,
      clientInstanceId: CLIENT_INSTANCE_ID,
      serverBuildId: BUILD_ID,
      clientGeneration: 1,
      ownerGeneration: 1,
      ownerLease: 'lease-a'
    }),
    getWorkspaceSessionHostIds: () => [PARTITION_ID],
    getWorkspaceSession: () => ({
      tabsByWorktree: { [WORKTREE_ID]: [{ id: TAB_ID, ptyId: null, generation: 3 }] },
      terminalLayoutsByTabId: { [TAB_ID]: layout() }
    }),
    getFolderWorkspaces: () => [],
    ...overrides
  }
}

function remoteSnapshot(): unknown {
  return {
    session: {
      tabsByWorktreePath: {
        [WORKTREE_PATH]: [{ id: TAB_ID, ptyId: null, worktreePath: WORKTREE_PATH, generation: 3 }]
      },
      terminalLayoutsByTabId: { [TAB_ID]: layout() }
    }
  }
}

function providerInput(overrides: Record<string, unknown> = {}) {
  return {
    targetId: TARGET_ID,
    partitionId: PARTITION_ID,
    clientInstanceId: CLIENT_INSTANCE_ID,
    hostPlatform: getRemoteHostPlatform('linux-x64'),
    nodePath: '/usr/bin/node',
    priorRelayStatus: { kind: 'superseded' as const, marker: MARKER },
    store: storeDouble(),
    connection: () => ({}) as SshConnection,
    remoteWorkspaceSnapshot: remoteSnapshot,
    isAttemptCurrent: () => true,
    now: () => 1_700,
    ...overrides
  } as Parameters<typeof createSshLegacyMigrationEvidenceProvider>[0]
}

function inspection(
  descriptor: LegacyPhysicalWorkerDescriptor,
  identityProof?: SshLegacyPhysicalWorkerInspection['identityProof']
): SshLegacyPhysicalWorkerInspection {
  const evidence = {
    protocolVersion: 1 as const,
    workerId: descriptor.workerId,
    routeId: descriptor.routeId,
    buildId: descriptor.buildId,
    identityProof: identityProof ?? {
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
        cwd: WORKTREE_PATH,
        title: 'shell',
        worktreeId: WORKTREE_ID,
        serialized: {
          paneKey: PANE_KEY,
          tabId: TAB_ID,
          worktreeId: WORKTREE_ID,
          cwd: WORKTREE_PATH,
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

async function discovered(
  input = providerInput()
): Promise<Readonly<{ provider: ReturnType<typeof createSshLegacyMigrationEvidenceProvider> }>> {
  return { provider: createSshLegacyMigrationEvidenceProvider(input) }
}

const CONTEXT = Object.freeze({
  targetId: TARGET_ID,
  authorityHostId: HOST_ID,
  hostPathFlavor: 'posix' as const,
  attemptId: 'attempt-a'
})

async function runMigration(
  options: Readonly<{
    input?: Parameters<typeof createSshLegacyMigrationEvidenceProvider>[0]
    rpcOptions?: ConstructorParameters<typeof FutureSshLegacyMigrationRpc>[1]
    signal?: AbortSignal
    isAttemptCurrent?: () => boolean
    identityProof?: SshLegacyPhysicalWorkerInspection['identityProof']
    rpc?: FutureSshLegacyMigrationRpc
  }> = {}
) {
  const input = options.input ?? providerInput()
  const provider = createSshLegacyMigrationEvidenceProvider(input)
  const signal = options.signal ?? new AbortController().signal
  const discovery = await provider.discoverWorkers({ ...CONTEXT, signal })
  const workers: SshLegacyInspectedWorker[] =
    discovery.kind === 'ready'
      ? discovery.workers.map((descriptor) => ({
          descriptor,
          inspection: inspection(descriptor, options.identityProof)
        }))
      : []
  const rpc = options.rpc ?? new FutureSshLegacyMigrationRpc(workers, options.rpcOptions)
  const outcome = await coordinateSshLegacyMigration({
    ...CONTEXT,
    authorityCapabilities: [TERMINAL_LEGACY_CUTOVER_CAPABILITY],
    attemptId: 'attempt-a',
    signal,
    isAttemptCurrent: options.isAttemptCurrent ?? (() => true),
    rpc,
    evidenceProvider: provider
  })
  return { outcome, rpc, workers }
}

describe('production legacy migration evidence provider', () => {
  it('discovers exactly the recorded prior relay as one bounded worker', async () => {
    const { provider } = await discovered()
    const discovery = await provider.discoverWorkers({
      ...CONTEXT,
      signal: new AbortController().signal
    })
    expect(discovery.kind).toBe('ready')
    expect(discovery.kind === 'ready' && discovery.workers).toHaveLength(1)
    expect(discovery.kind === 'ready' && discovery.workers[0].workerId).toBe('owner-prior')
  })

  it('runs capability, snapshot, inventory, plan, commit, and receipt in order on establish', async () => {
    const { outcome, rpc } = await runMigration()
    expect(outcome.kind).toBe('committed')
    expect(outcome.kind === 'committed' && outcome.summary.importCount).toBe(1)
    expect(outcome.kind === 'committed' && outcome.summary.unresolvedCount).toBe(0)
    expect(rpc.calls.map((call) => call.method.split('.').pop())).toEqual([
      'inspect',
      'migrate',
      'gcProtection',
      'migrationBarrier',
      'gc'
    ])
  })

  it('replays a durable authority operation without committing twice on reconnect', async () => {
    const { outcome } = await runMigration({
      rpcOptions: { committedInitially: true }
    })
    expect(outcome.kind === 'committed' && outcome.receipts[0].duplicate).toBe(true)
  })

  it('reports commit-uncertain when the authority response is lost', async () => {
    const { outcome } = await runMigration({ rpcOptions: { loseMigrationResponseOnce: true } })
    expect(outcome).toMatchObject({ kind: 'unresolved', mutationState: 'commit-uncertain' })
  })

  it('keeps a failed barrier non-destructive after the catalog committed', async () => {
    const { outcome } = await runMigration({
      rpcOptions: { barrierError: new Error('barrier unavailable') }
    })
    expect(outcome).toMatchObject({
      kind: 'unresolved',
      phase: 'barrier',
      mutationState: 'catalog-committed'
    })
  })

  it('reports a pending collection rather than losing the committed cutover', async () => {
    const { outcome } = await runMigration({ rpcOptions: { gcError: new Error('gc deferred') } })
    expect(outcome.kind === 'committed' && outcome.gc.kind).toBe('pending')
  })

  it('stops before mutation when the attempt is superseded', async () => {
    const controller = new AbortController()
    controller.abort()
    const rpc = new FutureSshLegacyMigrationRpc([])
    await expect(runMigration({ signal: controller.signal, rpc })).rejects.toThrow()
    expect(rpc.calls).toHaveLength(0)
  })

  it('stops before mutation when a newer attempt took over mid-discovery', async () => {
    const { outcome, rpc } = await runMigration({
      input: providerInput({ isAttemptCurrent: () => false })
    })
    expect(outcome).toMatchObject({
      kind: 'unresolved',
      phase: 'worker-discovery',
      mutationState: 'none'
    })
    expect(rpc.calls).toHaveLength(0)
  })

  it('never cuts over when the recorded prior relay status is unknown', async () => {
    const { outcome, rpc } = await runMigration({
      input: providerInput({
        priorRelayStatus: { kind: 'unknown', reason: 'recorded prior relay status is invalid' }
      })
    })
    expect(outcome).toMatchObject({
      kind: 'unresolved',
      phase: 'worker-discovery',
      mutationState: 'none'
    })
    expect(rpc.calls).toHaveLength(0)
  })

  it('never cuts over when leases are retained but no prior relay was recorded', async () => {
    const { outcome } = await runMigration({
      input: providerInput({ priorRelayStatus: { kind: 'none' } })
    })
    expect(outcome).toMatchObject({ kind: 'unresolved', phase: 'worker-discovery' })
  })

  it('completes an empty cutover on a host with neither a prior relay nor leases', async () => {
    const { outcome } = await runMigration({
      input: providerInput({
        priorRelayStatus: { kind: 'adopted' },
        store: storeDouble({ getSshRemotePtyLeases: () => [] })
      })
    })
    expect(outcome.kind).toBe('committed')
    expect(outcome.kind === 'committed' && outcome.summary.importCount).toBe(0)
  })

  it('leaves an ambiguous pane generation in recovery instead of importing it', async () => {
    const { outcome } = await runMigration({
      input: providerInput({
        store: storeDouble({
          getWorkspaceSession: () => ({
            tabsByWorktree: { [WORKTREE_ID]: [{ id: TAB_ID, ptyId: null, generation: 4 }] },
            terminalLayoutsByTabId: { [TAB_ID]: layout() }
          })
        })
      })
    })
    expect(outcome.kind === 'committed' && outcome.summary.importCount).toBe(0)
    expect(outcome.kind === 'committed' && outcome.summary.unresolvedReasons).toEqual([
      { reason: 'ambiguous-pane-generation', count: 1 }
    ])
  })

  it('fails closed before mutation when the host cannot prove the endpoint identity', async () => {
    const { outcome } = await runMigration({
      identityProof: {
        expectedEndpoint: ENDPOINT,
        observedEndpoint: null,
        expectedProcess: { pid: 9_001, birthMarker: 'prior-process-token' },
        observedProcess: { pid: 9_001, birthMarker: 'prior-process-token' }
      }
    })
    expect(outcome).toMatchObject({
      kind: 'unresolved',
      phase: 'planning',
      mutationState: 'none'
    })
  })

  it('fails closed against a host that cannot answer the exact inspection contract', async () => {
    const provider = createSshLegacyMigrationEvidenceProvider(providerInput())
    const rpc = new FutureSshLegacyMigrationRpc([])
    const outcome = await coordinateSshLegacyMigration({
      ...CONTEXT,
      authorityCapabilities: [TERMINAL_LEGACY_CUTOVER_CAPABILITY],
      attemptId: 'attempt-a',
      signal: new AbortController().signal,
      isAttemptCurrent: () => true,
      rpc,
      evidenceProvider: provider
    })
    expect(outcome).toMatchObject({
      kind: 'unresolved',
      phase: 'inspection',
      mutationState: 'none'
    })
  })

  it('stays read-only against a host that never negotiated the cutover capability', async () => {
    const outcome = await coordinateSshLegacyMigration({
      ...CONTEXT,
      authorityCapabilities: [],
      attemptId: 'attempt-a',
      signal: new AbortController().signal,
      isAttemptCurrent: () => true,
      rpc: new FutureSshLegacyMigrationRpc([]),
      evidenceProvider: createSshLegacyMigrationEvidenceProvider(providerInput())
    })
    expect(outcome).toEqual({ kind: 'read-only', reason: 'capability-not-negotiated' })
  })
})
