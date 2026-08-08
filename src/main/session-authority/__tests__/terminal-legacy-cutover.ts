import type {
  TerminalLegacyImportCandidate,
  TerminalLegacyImportMatchEvidence,
  TerminalLegacyInventoryEvidence,
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyUnresolvedCandidate,
  TerminalLegacyWorkerRoute
} from '../../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../../../shared/terminal-session-authority-identity'

export const LEGACY_TEST_NAMESPACE = Object.freeze({
  authorityHostId: 'host-a',
  namespaceId: 'namespace-a'
})

type LegacyRequestOptions = Readonly<{
  migrationNumber: number
  workerNumber?: number
  recoveryNumbers?: readonly number[]
  namespace?: TerminalAuthorityNamespace
  unresolvedPaneKey?: string
}>

export function legacyRecoveryOnlyRequest(
  options: LegacyRequestOptions
): TerminalLegacyMigrationImportRequest {
  const workerNumber = options.workerNumber ?? options.migrationNumber
  const recoveries = options.recoveryNumbers ?? [options.migrationNumber]
  return Object.freeze({
    version: 1,
    mode: 'recovery-only',
    migrationId: `migration-${options.migrationNumber}`,
    authorityHostId: 'host-a',
    requestedAtMs: options.migrationNumber * 10,
    workerEvidence: Object.freeze({
      workerId: workerId(workerNumber),
      buildId: `build-${workerNumber}`,
      relayDirectory: relayDirectory(workerNumber),
      endpointPath: `${relayDirectory(workerNumber)}/relay.sock`,
      credentialFile: `${relayDirectory(workerNumber)}/credential`,
      process: processIdentity(workerNumber),
      inventoryDigest: `inventory-worker-${workerNumber}`,
      gcProtection: Object.freeze({
        relayDirectories: Object.freeze([relayDirectory(workerNumber)]),
        evidencePaths: Object.freeze([
          `${relayDirectory(workerNumber)}/relay.sock`,
          `${relayDirectory(workerNumber)}/credential`
        ])
      })
    }),
    imports: Object.freeze([] as const),
    unresolved: Object.freeze(
      recoveries.map((recoveryNumber) =>
        unresolvedCandidate(
          workerNumber,
          recoveryNumber,
          options.namespace,
          false,
          options.unresolvedPaneKey
        )
      )
    )
  })
}

export function legacyCutoverRequest(
  options: LegacyRequestOptions &
    Readonly<{
      importedRecoveryNumbers?: readonly number[]
      unresolvedRecoveryNumbers?: readonly number[]
    }>
): TerminalLegacyMigrationImportRequest {
  const workerNumber = options.workerNumber ?? options.migrationNumber
  return Object.freeze({
    version: 1,
    mode: 'cutover',
    migrationId: `migration-${options.migrationNumber}`,
    authorityHostId: 'host-a',
    requestedAtMs: options.migrationNumber * 10,
    workerRoute: workerRoute(workerNumber),
    cutover: cutoverProof(workerNumber, options.migrationNumber),
    imports: Object.freeze(
      (options.importedRecoveryNumbers ?? []).map((recoveryNumber) =>
        importCandidate(workerNumber, recoveryNumber, options.namespace)
      )
    ),
    unresolved: Object.freeze(
      (options.unresolvedRecoveryNumbers ?? []).map((recoveryNumber) =>
        unresolvedCandidate(workerNumber, recoveryNumber, options.namespace, true)
      )
    )
  })
}

export function legacyAcknowledgementRequest(
  migrationNumber: number,
  recoveryNumber: number,
  expectedCatalogReceiptId: string
): TerminalLegacyMigrationImportRequest {
  return Object.freeze({
    version: 1,
    mode: 'acknowledge',
    migrationId: `migration-${migrationNumber}`,
    authorityHostId: 'host-a',
    requestedAtMs: migrationNumber * 10,
    recoveryId: recoveryId(recoveryNumber),
    expectedCatalogReceiptId,
    acknowledgementCode: `acknowledgement-${recoveryNumber}`,
    imports: Object.freeze([] as const),
    unresolved: Object.freeze([] as const)
  })
}

export function legacyWorkerRoute(workerNumber: number): TerminalLegacyWorkerRoute {
  return workerRoute(workerNumber)
}

function importCandidate(
  workerNumber: number,
  recoveryNumber: number,
  namespace: TerminalAuthorityNamespace = LEGACY_TEST_NAMESPACE
): TerminalLegacyImportCandidate {
  const paneKey = `pane-${recoveryNumber}`
  const tabId = `tab-${recoveryNumber}`
  const incarnationId = `pty-incarnation-${recoveryNumber}`
  const processId = 2_000 + recoveryNumber
  const inventory = Object.freeze({
    ...inventoryEvidence(recoveryNumber),
    paneKey,
    tabId,
    serializedPtyIncarnationId: incarnationId,
    serializedProcessId: processId
  }) satisfies TerminalLegacyImportMatchEvidence['remoteInventory']
  return Object.freeze({
    recoveryId: recoveryId(recoveryNumber),
    namespace,
    workspace: workspaceEvidence(recoveryNumber),
    physicalPty: Object.freeze({
      workerId: workerId(workerNumber),
      physicalPtyId: physicalPtyId(recoveryNumber),
      ptyIncarnationId: incarnationId,
      processId
    }),
    pane: Object.freeze({ paneKey, paneGenerationId: `generation-${recoveryNumber}` }),
    allocationId: `allocation-${recoveryNumber}`,
    spawnFingerprint: `spawn-${recoveryNumber}`,
    inventoryEvidence: inventory,
    matchEvidence: Object.freeze({
      localLease: Object.freeze({
        leaseId: `lease-${recoveryNumber}`,
        paneKey,
        paneGenerationId: `generation-${recoveryNumber}`,
        rendererGeneration: recoveryNumber,
        tabId,
        worktreeId: `/repo/${recoveryNumber}`
      }),
      remoteInventory: inventory,
      uniqueness: Object.freeze({
        localCandidates: 1,
        remoteCandidates: 1,
        endpointIdentityMatched: true,
        processIdentityMatched: true
      })
    })
  })
}

function unresolvedCandidate(
  workerNumber: number,
  recoveryNumber: number,
  namespace: TerminalAuthorityNamespace = LEGACY_TEST_NAMESPACE,
  isolated: boolean,
  paneKey: string | undefined = undefined
): TerminalLegacyUnresolvedCandidate {
  return Object.freeze({
    recoveryId: recoveryId(recoveryNumber),
    namespace,
    workspace: workspaceEvidence(recoveryNumber),
    physicalPty: Object.freeze({
      workerId: workerId(workerNumber),
      physicalPtyId: physicalPtyId(recoveryNumber),
      ptyIncarnationId: null,
      processId: null
    }),
    reason: 'physical-pty-incarnation-unproved',
    evidenceCode: `evidence-${recoveryNumber}`,
    inventoryEvidence: Object.freeze({
      ...inventoryEvidence(recoveryNumber),
      paneKey: paneKey ?? null
    }),
    preservation: isolated
      ? Object.freeze({
          kind: 'isolated-grace-disabled' as const,
          endpointIdentityRetained: true as const,
          graceDisabledAcknowledged: true as const
        })
      : Object.freeze({
          kind: 'evidence-gc-retained' as const,
          processPreservationUnproved: true as const
        })
  })
}

function workerRoute(workerNumber: number): TerminalLegacyWorkerRoute {
  const directory = relayDirectory(workerNumber)
  return Object.freeze({
    routeId: `route-${workerNumber}`,
    workerId: workerId(workerNumber),
    ownerIncarnationId: `legacy-owner-${workerNumber}`,
    buildId: `build-${workerNumber}`,
    relayDirectory: directory,
    socketPath: `${directory}/relay.private.sock`,
    credentialFile: `${directory}/credential.private`,
    process: processIdentity(workerNumber),
    endpoint: endpointIdentity(workerNumber),
    sourceOwner: Object.freeze({
      clientInstanceId: `legacy-client-${workerNumber}`,
      ownerGeneration: 1,
      ownerLease: `owner-lease-${workerNumber}`,
      outputWindowSourceUnits: 4_096
    }),
    gcProtection: Object.freeze({
      relayDirectories: Object.freeze([directory]),
      evidencePaths: Object.freeze([
        `${directory}/relay.private.sock`,
        `${directory}/credential.private`
      ])
    })
  })
}

function cutoverProof(workerNumber: number, migrationNumber: number) {
  const directory = relayDirectory(workerNumber)
  return Object.freeze({
    kind: 'posix-relocated' as const,
    publicCredentialFile: `${directory}/credential`,
    privateCredentialFile: `${directory}/credential.private`,
    publicSocketPath: `${directory}/relay.sock`,
    privateSocketPath: `${directory}/relay.private.sock`,
    endpointIdentity: endpointIdentity(workerNumber),
    brokerClientCount: 1 as const,
    acceptedConnectionCount: 1,
    quiescenceSamples: 2,
    connectionProof: Object.freeze({
      method: 'linux-procfs-unix' as const,
      listenerIdentity: `listener-${workerNumber}`,
      brokerConnectionIdentity: `broker-${migrationNumber}`,
      acceptedServerConnections: 1 as const
    }),
    graceConfiguration: Object.freeze({
      capabilityVersion: 1 as const,
      configuredGraceMs: 0 as const,
      acknowledged: true as const
    }),
    sealedAtMs: migrationNumber * 10
  })
}

function inventoryEvidence(recoveryNumber: number): TerminalLegacyInventoryEvidence {
  return Object.freeze({
    evidenceDigest: `inventory-${recoveryNumber}`,
    observedAtMs: recoveryNumber,
    paneKey: null,
    tabId: null,
    worktreeId: `/repo/${recoveryNumber}`,
    cwd: `/repo/${recoveryNumber}`,
    serializedPtyIncarnationId: null,
    serializedProcessId: null
  })
}

function workspaceEvidence(recoveryNumber: number) {
  return Object.freeze({
    kind: 'folder' as const,
    locator: Object.freeze({
      kind: 'workspace' as const,
      canonicalPath: `/repo/${recoveryNumber}`,
      pathFlavor: 'posix' as const
    })
  })
}

function processIdentity(workerNumber: number) {
  return Object.freeze({ pid: 1_000 + workerNumber, birthMarker: `birth-${workerNumber}` })
}

function endpointIdentity(workerNumber: number) {
  return Object.freeze({
    kind: 'unix-socket' as const,
    device: '1',
    inode: String(10_000 + workerNumber),
    changedAtNs: String(20_000 + workerNumber)
  })
}

function relayDirectory(workerNumber: number): string {
  return `/relay/${workerNumber}`
}

function workerId(workerNumber: number): string {
  return `worker-${workerNumber}`
}

function recoveryId(recoveryNumber: number): string {
  return `recovery-${recoveryNumber}`
}

function physicalPtyId(recoveryNumber: number): string {
  return `pty-${recoveryNumber}`
}
