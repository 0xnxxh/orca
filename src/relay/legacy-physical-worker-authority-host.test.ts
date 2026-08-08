import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalLegacyCutoverProof,
  TerminalLegacyMigrationReceipt,
  TerminalLegacyUnresolvedCandidate,
  TerminalLegacyWorkerRoute
} from '../shared/terminal-legacy-cutover'
import {
  LegacyPhysicalWorkerAuthorityHost,
  type LegacyPhysicalWorkerAuthorityHostOperations,
  type LegacyPhysicalWorkerMigrationAuthority
} from './legacy-physical-worker-authority-host'
import {
  LegacyPhysicalWorkerClient,
  type LegacyPhysicalWorkerRpc
} from './legacy-physical-worker-client'
import type { LegacyPhysicalWorkerDescriptor } from './legacy-physical-worker-control-protocol'
import type { LegacyPhysicalWorkerCutoverSession } from './legacy-physical-worker-cutover-session'
import type { LegacyPhysicalWorkerRegistration } from './legacy-physical-worker-registration'

describe('legacy physical worker authority host', () => {
  it('retries an authority response loss without repeating physical preservation', async () => {
    const client = workerClient(new WorkerRpc())
    const order: string[] = []
    const preserved = preservation(client)
    const physicalPreservation = vi.fn(async () => {
      order.push('physical-preservation')
      return preserved
    })
    let preservedPromise: ReturnType<typeof physicalPreservation> | null = null
    const cutover = vi.fn(() => (preservedPromise ??= physicalPreservation()))
    const session = cutoverSession(client, cutover)
    const operations: LegacyPhysicalWorkerAuthorityHostOperations = {
      inspect: vi.fn(async () => session),
      restore: vi.fn(async () => preserved.registration)
    }
    const registry = {
      register: vi.fn(async () => {
        order.push('registry-registration')
        return Object.freeze({ status: 'registered' as const, replaced: false })
      })
    }
    let committedReceipt: TerminalLegacyMigrationReceipt | null = null
    const authority = migrationAuthority({
      importMigration: vi.fn(async (request) => {
        order.push('authority-commit')
        if (!committedReceipt) {
          committedReceipt = receipt(request)
          throw new Error('authority response lost')
        }
        return Object.freeze({ receipt: committedReceipt, duplicate: true })
      }),
      activateWorker: vi.fn(async () => {
        order.push('authority-activation')
        return true
      })
    })
    const host = new LegacyPhysicalWorkerAuthorityHost(registry, authority, {}, operations)

    await expect(host.migrate(migrationInput)).rejects.toThrow('authority response lost')
    expect(order).toEqual(['physical-preservation', 'registry-registration', 'authority-commit'])
    expect(host.gcProtection()).toEqual({
      relayDirectories: ['/legacy-relay'],
      evidencePaths: [
        '/authority-state',
        '/authority-state/credential',
        '/authority-state/worker.sock',
        '/legacy-relay/credential',
        '/legacy-relay/relay.sock'
      ]
    })

    await expect(host.migrate(migrationInput)).resolves.toMatchObject({ duplicate: true })
    expect(host.gcProtection()).toEqual(route.gcProtection)
    expect(physicalPreservation).toHaveBeenCalledOnce()
    expect(operations.inspect).toHaveBeenCalledOnce()
    expect(order).toEqual([
      'physical-preservation',
      'registry-registration',
      'authority-commit',
      'registry-registration',
      'authority-commit',
      'authority-activation'
    ])
  })

  it('restores authority preservation as live only while exact process evidence is reachable', async () => {
    const rpc = new WorkerRpc()
    const client = workerClient(rpc)
    const restoredRegistration: LegacyPhysicalWorkerRegistration = Object.freeze({
      ...preservation(client).registration,
      restored: true
    })
    const registry = {
      register: vi.fn(async () => Object.freeze({ status: 'registered' as const, replaced: false }))
    }
    const authority = migrationAuthority({
      physicalWorkerEntries: () => [Object.freeze({ route, cutover: proof })]
    })
    const operations: LegacyPhysicalWorkerAuthorityHostOperations = {
      inspect: vi.fn(async () => cutoverSession(client, async () => preservation(client))),
      restore: vi.fn(async () => restoredRegistration)
    }
    const host = new LegacyPhysicalWorkerAuthorityHost(registry, authority, {}, operations)

    await expect(host.restoreAuthorityWorkers()).resolves.toEqual([
      { routeId: 'route-1', status: 'restored' }
    ])
    expect(authority.activateWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        routeId: 'route-1',
        ownerIncarnationId: 'owner-1',
        endpoint: proof.endpointIdentity
      })
    )
    rpc.disconnect()
    await vi.waitFor(() => expect(authority.deactivateWorker).toHaveBeenCalledOnce())
    expect(host.gcProtection()).toEqual({ relayDirectories: [], evidencePaths: [] })
    expect(host.gcEligible()).toEqual(route.gcProtection)
    host.dispose()
    host.dispose()
  })
})

function migrationAuthority(
  overrides: Partial<LegacyPhysicalWorkerMigrationAuthority> = {}
): LegacyPhysicalWorkerMigrationAuthority {
  return {
    importMigration: vi.fn(async (request) => ({
      receipt: receipt(request),
      duplicate: false
    })),
    activateWorker: vi.fn(async () => true),
    deactivateWorker: vi.fn(async () => true),
    gcProtection: () => ({ relayDirectories: [], evidencePaths: [] }),
    physicalWorkerEntries: () => [],
    projection: () => ({ revision: 3 }),
    ...overrides
  }
}

function receipt(
  request: Parameters<LegacyPhysicalWorkerMigrationAuthority['importMigration']>[0]
): TerminalLegacyMigrationReceipt {
  return Object.freeze({
    version: 1,
    receiptId: 'receipt-1',
    sequence: 4,
    committedAtMs: 5,
    request,
    recoveries: Object.freeze([])
  })
}

function cutoverSession(
  client: LegacyPhysicalWorkerClient,
  cutover: LegacyPhysicalWorkerCutoverSession['cutover']
): LegacyPhysicalWorkerCutoverSession {
  return Object.freeze({
    descriptor,
    client,
    inventory: Object.freeze([
      Object.freeze({
        id: 'pty-1',
        incarnationId: 'incarnation-1',
        processId: 91,
        cwd: '/workspace',
        title: 'shell'
      })
    ]),
    cutover
  })
}

function preservation(client: LegacyPhysicalWorkerClient) {
  const registration: LegacyPhysicalWorkerRegistration = Object.freeze({
    route,
    cutover: proof,
    client,
    processMatches: async () => true
  })
  return Object.freeze({ route, proof, registration })
}

class WorkerRpc implements LegacyPhysicalWorkerRpc {
  private open = true
  private readonly closeListeners = new Set<() => void>()

  request(): Promise<unknown> {
    return Promise.reject(new Error('unexpected request'))
  }

  notify(): void {}

  notifyWithSettlement(
    _method: string,
    _params: Record<string, unknown>,
    onSettled: (result: { ok: true } | { ok: false; error: Error }) => void
  ): void {
    onSettled({ ok: true })
  }

  onNotification(): () => void {
    return () => {}
  }

  isOpen(): boolean {
    return this.open
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close(): void {
    this.disconnect()
  }

  disconnect(): void {
    if (!this.open) {
      return
    }
    this.open = false
    this.closeListeners.forEach((listener) => listener())
    this.closeListeners.clear()
  }
}

function workerClient(rpc: LegacyPhysicalWorkerRpc): LegacyPhysicalWorkerClient {
  return new LegacyPhysicalWorkerClient(
    rpc,
    {
      protocolVersion: 1,
      serverBuildId: 'build-1',
      clientGeneration: 2,
      role: 'session-owner',
      ownerGeneration: 3,
      ownerLease: 'lease-1',
      resumed: false
    },
    {
      consumerSessionVersion: 1,
      outputFlowControlVersion: 1,
      exactOperationsVersion: 1,
      heldProducerPauseVersion: 1,
      mutationMode: 'exact-v1',
      sourceWindowSu: 1024
    },
    'broker-1'
  )
}

const endpoint = Object.freeze({
  kind: 'unix-socket' as const,
  device: '1',
  inode: '2',
  changedAtNs: '3'
})

const route: TerminalLegacyWorkerRoute = Object.freeze({
  routeId: 'route-1',
  workerId: 'worker-1',
  ownerIncarnationId: 'owner-1',
  buildId: 'build-1',
  relayDirectory: '/legacy-relay',
  socketPath: '/authority-state/worker.sock',
  credentialFile: '/authority-state/credential',
  process: Object.freeze({ pid: 90, birthMarker: 'birth-1' }),
  endpoint,
  sourceOwner: Object.freeze({
    clientInstanceId: 'broker-1',
    ownerGeneration: 3,
    ownerLease: 'lease-1',
    outputWindowSourceUnits: 1024
  }),
  gcProtection: Object.freeze({
    relayDirectories: Object.freeze(['/legacy-relay']),
    evidencePaths: Object.freeze(['/authority-state/worker.sock'])
  })
})

const proof: TerminalLegacyCutoverProof = Object.freeze({
  kind: 'posix-relocated',
  publicCredentialFile: '/legacy-relay/credential',
  privateCredentialFile: '/authority-state/credential',
  publicSocketPath: '/legacy-relay/relay.sock',
  privateSocketPath: '/authority-state/worker.sock',
  endpointIdentity: endpoint,
  brokerClientCount: 1,
  acceptedConnectionCount: 1,
  quiescenceSamples: 2,
  connectionProof: Object.freeze({
    method: 'linux-procfs-unix',
    listenerIdentity: 'listener-1',
    brokerConnectionIdentity: 'broker-1:2:3',
    acceptedServerConnections: 1
  }),
  graceConfiguration: Object.freeze({
    capabilityVersion: 1,
    configuredGraceMs: 0,
    acknowledged: true
  }),
  sealedAtMs: 3
})

const descriptor: LegacyPhysicalWorkerDescriptor = Object.freeze({
  version: 1,
  workerId: 'worker-1',
  routeId: 'route-1',
  ownerIncarnationId: 'owner-1',
  buildId: 'build-1',
  clientInstanceId: 'broker-1',
  relayDirectory: '/legacy-relay',
  process: route.process,
  expectedEndpoint: endpoint,
  requestedSourceWindowSu: 1024,
  publicCredentialFile: '/legacy-relay/credential',
  privateCredentialFile: '/authority-state/credential',
  privateStateDirectory: '/authority-state',
  platform: 'linux',
  publicSocketPath: '/legacy-relay/relay.sock',
  privateSocketPath: '/authority-state/worker.sock'
})

const unresolved: TerminalLegacyUnresolvedCandidate = Object.freeze({
  recoveryId: 'recovery-1',
  namespace: Object.freeze({ authorityHostId: 'authority-1', namespaceId: 'namespace-1' }),
  workspace: Object.freeze({
    kind: 'folder',
    locator: Object.freeze({ kind: 'workspace', canonicalPath: '/workspace', pathFlavor: 'posix' })
  }),
  physicalPty: Object.freeze({
    workerId: 'worker-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1',
    processId: 91
  }),
  reason: 'workspace-mismatch',
  evidenceCode: 'evidence-1',
  inventoryEvidence: Object.freeze({
    evidenceDigest: 'digest-1',
    observedAtMs: 1,
    paneKey: 'pane-1',
    tabId: 'tab-1',
    worktreeId: '/workspace',
    cwd: '/workspace',
    serializedPtyIncarnationId: 'incarnation-1',
    serializedProcessId: 91
  }),
  preservation: Object.freeze({
    kind: 'isolated-grace-disabled',
    endpointIdentityRetained: true,
    graceDisabledAcknowledged: true
  })
})

const migrationInput = Object.freeze({
  descriptor,
  catalog: Object.freeze({
    migrationId: 'migration-1',
    authorityHostId: 'authority-1',
    requestedAtMs: 2,
    imports: Object.freeze([]),
    unresolved: Object.freeze([unresolved])
  })
})
