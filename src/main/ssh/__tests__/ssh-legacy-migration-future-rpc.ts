import type {
  TerminalLegacyEndpointIdentity,
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyMigrationReceipt,
  TerminalLegacyUnresolvedCandidate,
  TerminalLegacyWorkerRoute
} from '../../../shared/terminal-legacy-cutover'
import type { SshMultiplexerRequestOptions } from '../ssh-channel-multiplexer'
import type {
  LegacyPhysicalWorkerDescriptor,
  SshLegacyInspectedWorker,
  SshLegacyPhysicalWorkerInspection
} from '../ssh-legacy-migration-coordinator-types'
import type { SshLegacyWorkerCatalog } from '../ssh-legacy-migration-rpc'

type FutureRpcOptions = Readonly<{
  committedInitially?: boolean
  loseMigrationResponseOnce?: boolean
  barrierError?: Error
  gcError?: Error
}>

export class FutureSshLegacyMigrationRpc {
  readonly calls: {
    method: string
    params: Record<string, unknown>
    signal: AbortSignal | undefined
  }[] = []
  private readonly inspections = new Map<string, SshLegacyPhysicalWorkerInspection>()
  private readonly commits = new Map<string, unknown>()
  private revision = 0
  private responseLost = false

  constructor(
    prepared: readonly SshLegacyInspectedWorker[],
    private readonly options: FutureRpcOptions = {}
  ) {
    prepared.forEach(({ descriptor, inspection }) =>
      this.inspections.set(descriptor.routeId, inspection)
    )
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    options?: SshMultiplexerRequestOptions
  ): Promise<unknown> {
    options?.signal?.throwIfAborted()
    this.calls.push({ method, params, signal: options?.signal })
    if (method.endsWith('.inspect')) {
      return this.inspection(params)
    }
    if (method.endsWith('.migrate')) {
      return this.migrate(params)
    }
    if (method.endsWith('.gcProtection')) {
      return { catalogRevision: this.revision, protection: emptyProtection() }
    }
    if (method.endsWith('.migrationBarrier')) {
      if (this.options.barrierError) {
        throw this.options.barrierError
      }
      return {
        version: 1,
        barrierId: params.barrierId,
        catalogRevision: params.expectedCatalogRevision,
        committedAtMs: 9
      }
    }
    if (method.endsWith('.gc')) {
      if (this.options.gcError) {
        throw this.options.gcError
      }
      return { removed: ['/old/relay'], protected: emptyProtection() }
    }
    throw new Error(`unexpected test RPC: ${method}`)
  }

  private inspection(params: Record<string, unknown>): SshLegacyPhysicalWorkerInspection {
    const routeId = (params.worker as LegacyPhysicalWorkerDescriptor).routeId
    const inspection = this.inspections.get(routeId)
    if (!inspection) {
      throw new Error('test inspection is missing')
    }
    return inspection
  }

  private migrate(params: Record<string, unknown>): unknown {
    if (this.options.committedInitially && !this.commits.has(String(params.operationId))) {
      return this.commit(params, true)
    }
    const result = this.commit(params, false)
    if (this.options.loseMigrationResponseOnce && !this.responseLost) {
      this.responseLost = true
      throw new Error('connection lost after durable commit')
    }
    return result
  }

  private commit(params: Record<string, unknown>, duplicate: boolean): unknown {
    const operationId = String(params.operationId)
    const existing = this.commits.get(operationId)
    if (existing) {
      return { ...(existing as Record<string, unknown>), duplicate: true }
    }
    const worker = params.worker as LegacyPhysicalWorkerDescriptor
    const catalog = params.catalog as SshLegacyWorkerCatalog
    const receipt = migrationReceipt(worker, catalog, ++this.revision)
    const result = {
      operationId,
      inspectionToken: params.inspectionToken,
      duplicate,
      receipt
    }
    this.commits.set(operationId, result)
    return result
  }
}

function migrationReceipt(
  worker: LegacyPhysicalWorkerDescriptor,
  catalog: SshLegacyWorkerCatalog,
  sequence: number
): TerminalLegacyMigrationReceipt {
  const route = workerRoute(worker)
  const request: TerminalLegacyMigrationImportRequest = Object.freeze({
    version: 1,
    mode: 'cutover',
    migrationId: catalog.migrationId,
    authorityHostId: catalog.authorityHostId,
    requestedAtMs: catalog.requestedAtMs,
    workerRoute: route,
    cutover: cutoverProof(worker, route.endpoint),
    imports: catalog.imports,
    unresolved: Object.freeze(catalog.unresolved.map((candidate) => isolatedCandidate(candidate)))
  })
  return Object.freeze({
    version: 1,
    receiptId: catalog.migrationId,
    sequence,
    committedAtMs: 8,
    request,
    recoveries: Object.freeze([])
  })
}

function workerRoute(worker: LegacyPhysicalWorkerDescriptor): TerminalLegacyWorkerRoute {
  const socketPath = worker.platform === 'win32' ? worker.pipeName : worker.privateSocketPath
  return Object.freeze({
    routeId: worker.routeId,
    workerId: worker.workerId,
    ownerIncarnationId: worker.ownerIncarnationId,
    buildId: worker.buildId,
    relayDirectory: worker.relayDirectory,
    socketPath,
    credentialFile: worker.privateCredentialFile,
    process: worker.process,
    endpoint: worker.expectedEndpoint,
    sourceOwner: Object.freeze({
      clientInstanceId: worker.clientInstanceId,
      ownerGeneration: 1,
      ownerLease: `lease-${worker.workerId}`,
      outputWindowSourceUnits: worker.requestedSourceWindowSu
    }),
    gcProtection: Object.freeze({
      relayDirectories: Object.freeze([worker.relayDirectory]),
      evidencePaths: Object.freeze([socketPath, worker.privateCredentialFile])
    })
  })
}

function cutoverProof(
  worker: LegacyPhysicalWorkerDescriptor,
  endpoint: TerminalLegacyEndpointIdentity
): Extract<TerminalLegacyMigrationImportRequest, { mode: 'cutover' }>['cutover'] {
  const base = {
    publicCredentialFile: worker.publicCredentialFile,
    privateCredentialFile: worker.privateCredentialFile,
    brokerClientCount: 1 as const,
    acceptedConnectionCount: 1,
    quiescenceSamples: 2,
    connectionProof: Object.freeze({
      method:
        worker.platform === 'win32'
          ? ('windows-pipe-process' as const)
          : ('linux-procfs-unix' as const),
      listenerIdentity: `listener-${worker.workerId}`,
      brokerConnectionIdentity: `broker-${worker.workerId}`,
      acceptedServerConnections: 1 as const
    }),
    graceConfiguration: Object.freeze({
      capabilityVersion: 1 as const,
      configuredGraceMs: 0 as const,
      acknowledged: true as const
    }),
    sealedAtMs: 7
  }
  if (worker.platform === 'win32' && endpoint.kind === 'windows-named-pipe') {
    return Object.freeze({
      ...base,
      kind: 'windows-sealed' as const,
      originalPipeName: worker.pipeName,
      activePipeMarkerIgnored: true as const,
      endpointIdentity: endpoint
    })
  }
  const posixWorker = worker as Extract<
    LegacyPhysicalWorkerDescriptor,
    { platform: 'linux' | 'darwin' }
  >
  return Object.freeze({
    ...base,
    kind: 'posix-relocated' as const,
    publicSocketPath: posixWorker.publicSocketPath,
    privateSocketPath: posixWorker.privateSocketPath,
    endpointIdentity: endpoint as Extract<TerminalLegacyEndpointIdentity, { kind: 'unix-socket' }>
  })
}

function isolatedCandidate(
  candidate: TerminalLegacyUnresolvedCandidate
): TerminalLegacyUnresolvedCandidate {
  return Object.freeze({
    ...candidate,
    preservation: Object.freeze({
      kind: 'isolated-grace-disabled',
      endpointIdentityRetained: true,
      graceDisabledAcknowledged: true
    })
  })
}

function emptyProtection() {
  return { relayDirectories: [], evidencePaths: [] }
}
