import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  TerminalLegacyImportedRecovery,
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyMigrationReceipt,
  TerminalLegacyRecoveryProjection,
  TerminalLegacyWorkerRoute,
  TerminalLegacyWorkerRouteProjection
} from './terminal-legacy-cutover'
import {
  assertTerminalLegacyMigrationImportRequest,
  assertTerminalLegacyMigrationReceipt
} from './terminal-legacy-cutover-request-validation'
import {
  assertAuthorityId,
  assertAuthorityNamespace,
  terminalPaneGenerationKey,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalSessionAuthorityLegacyMigration
} from './terminal-session-authority-mutation'
import { assertSafeInteger } from './terminal-session-authority-record-validation'

export function terminalLegacyMigrationRequestDigest(
  request: TerminalLegacyMigrationImportRequest
): string {
  assertTerminalLegacyMigrationImportRequest(request)
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

export function deriveTerminalAuthorityLegacyMigration(
  request: TerminalLegacyMigrationImportRequest,
  namespace: TerminalAuthorityNamespace,
  requestDigest: string,
  authorityRevision: number,
  migrationSequence: number,
  committedAtMs: number,
  previousRecovery: (recoveryId: string) => TerminalLegacyRecoveryProjection | undefined
): TerminalSessionAuthorityLegacyMigration {
  const acknowledged =
    request.mode === 'acknowledge' ? previousRecovery(request.recoveryId) : undefined
  const receipt: TerminalLegacyMigrationReceipt = Object.freeze({
    version: 1,
    receiptId: request.migrationId,
    sequence: migrationSequence,
    committedAtMs,
    request: Object.freeze(structuredClone(request)),
    recoveries: Object.freeze(
      request.mode === 'acknowledge'
        ? deriveAcknowledgement(request, committedAtMs, acknowledged)
        : deriveCandidateRecoveries(request, committedAtMs, previousRecovery)
    )
  })
  return Object.freeze({
    version: 1,
    namespace: Object.freeze({ ...namespace }),
    requestDigest,
    authorityRevision,
    receipt
  })
}

export function assertTerminalAuthorityLegacyMigrationEnvelope(
  migration: TerminalSessionAuthorityLegacyMigration
): void {
  if (migration.version !== 1) {
    failTerminalSessionAuthority('record-corrupt', 'legacy authority migration version is invalid')
  }
  assertAuthorityNamespace(migration.namespace)
  assertAuthorityId(migration.requestDigest, 'legacy migration requestDigest')
  assertSafeInteger(migration.authorityRevision, 'legacy migration authority revision', 1)
  assertTerminalLegacyMigrationReceipt(migration.receipt)
  for (const row of migration.receipt.recoveries) {
    if (!sameNamespace(row.namespace, migration.namespace)) {
      failTerminalSessionAuthority('record-corrupt', 'legacy migration namespace changed')
    }
  }
}

export function legacyPhysicalPtyKey(value: {
  namespace: TerminalAuthorityNamespace
  physicalPty: { workerId: string; physicalPtyId: string }
}): string {
  return JSON.stringify([
    value.namespace.authorityHostId,
    value.physicalPty.workerId,
    value.physicalPty.physicalPtyId
  ])
}

export function legacyImportedPaneKey(value: {
  namespace: TerminalAuthorityNamespace
  pane: { paneKey: string; paneGenerationId: string }
}): string {
  return JSON.stringify([
    value.namespace.authorityHostId,
    value.namespace.namespaceId,
    terminalPaneGenerationKey(value.pane)
  ])
}

export function legacyRouteMatchesCutover(
  route: TerminalLegacyWorkerRoute,
  request: Extract<TerminalLegacyMigrationImportRequest, { mode: 'cutover' }>
): boolean {
  const proof = request.cutover
  const endpointPath =
    proof.kind === 'posix-relocated' ? proof.privateSocketPath : proof.originalPipeName
  return (
    route.socketPath === endpointPath &&
    route.credentialFile === proof.privateCredentialFile &&
    isDeepStrictEqual(route.endpoint, proof.endpointIdentity) &&
    route.gcProtection.relayDirectories.includes(route.relayDirectory) &&
    route.gcProtection.evidencePaths.includes(route.socketPath) &&
    route.gcProtection.evidencePaths.includes(route.credentialFile)
  )
}

export function projectLegacyWorkerRoute(
  route: TerminalLegacyWorkerRoute
): TerminalLegacyWorkerRouteProjection {
  const { ownerLease: _ownerLease, ...sourceOwner } = route.sourceOwner
  const endpoint =
    route.endpoint.kind === 'unix-socket'
      ? Object.freeze({ ...route.endpoint })
      : Object.freeze({
          kind: route.endpoint.kind,
          processCreationMarker: route.endpoint.processCreationMarker
        })
  return Object.freeze({
    routeId: route.routeId,
    workerId: route.workerId,
    ownerIncarnationId: route.ownerIncarnationId,
    buildId: route.buildId,
    process: Object.freeze({ ...route.process }),
    endpoint,
    sourceOwner: Object.freeze(sourceOwner)
  })
}

function deriveAcknowledgement(
  request: Extract<TerminalLegacyMigrationImportRequest, { mode: 'acknowledge' }>,
  committedAtMs: number,
  acknowledged: TerminalLegacyRecoveryProjection | undefined
): TerminalLegacyRecoveryProjection[] {
  if (acknowledged?.status !== 'unresolved') {
    failTerminalSessionAuthority('expectation-mismatch', 'legacy recovery is not unresolved')
  }
  return [
    Object.freeze({
      ...acknowledged,
      status: 'acknowledged' as const,
      catalogReceiptId: request.migrationId,
      previousCatalogReceiptId: acknowledged.catalogReceiptId,
      acknowledgementCode: request.acknowledgementCode,
      acknowledgedAtMs: committedAtMs,
      updatedAtMs: committedAtMs
    })
  ]
}

function deriveCandidateRecoveries(
  request: Exclude<TerminalLegacyMigrationImportRequest, { mode: 'acknowledge' }>,
  committedAtMs: number,
  previousRecovery: (recoveryId: string) => TerminalLegacyRecoveryProjection | undefined
): TerminalLegacyRecoveryProjection[] {
  const imports =
    request.mode === 'cutover'
      ? request.imports.map((candidate) =>
          deriveImportedRecovery(request, candidate, committedAtMs, previousRecovery)
        )
      : []
  const unresolved = request.unresolved.map((candidate) => {
    const previous = previousRecovery(candidate.recoveryId)
    return Object.freeze({
      ...structuredClone(candidate),
      status: 'unresolved' as const,
      catalogReceiptId: request.migrationId,
      discoveredAtMs: previous?.discoveredAtMs ?? request.requestedAtMs,
      updatedAtMs: committedAtMs
    })
  })
  return [...imports, ...unresolved].sort((left, right) =>
    left.recoveryId.localeCompare(right.recoveryId)
  )
}

function deriveImportedRecovery(
  request: Extract<TerminalLegacyMigrationImportRequest, { mode: 'cutover' }>,
  candidate: (typeof request.imports)[number],
  committedAtMs: number,
  previousRecovery: (recoveryId: string) => TerminalLegacyRecoveryProjection | undefined
): TerminalLegacyImportedRecovery {
  const previous = previousRecovery(candidate.recoveryId)
  return Object.freeze({
    ...structuredClone(candidate),
    status: 'imported' as const,
    routeId: request.workerRoute.routeId,
    binding: Object.freeze({
      ownerIncarnationId: request.workerRoute.ownerIncarnationId,
      physicalPtyId: candidate.physicalPty.physicalPtyId,
      ptyIncarnationId: candidate.physicalPty.ptyIncarnationId
    }),
    catalogReceiptId: request.migrationId,
    resolvedFrom:
      previous?.status === 'unresolved'
        ? Object.freeze({
            catalogReceiptId: previous.catalogReceiptId,
            reason: previous.reason,
            evidenceCode: previous.evidenceCode
          })
        : null,
    discoveredAtMs: previous?.discoveredAtMs ?? request.requestedAtMs,
    updatedAtMs: committedAtMs
  })
}

function sameNamespace(
  left: TerminalAuthorityNamespace,
  right: TerminalAuthorityNamespace
): boolean {
  return left.authorityHostId === right.authorityHostId && left.namespaceId === right.namespaceId
}
