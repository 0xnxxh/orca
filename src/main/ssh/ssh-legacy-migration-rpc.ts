import { isDeepStrictEqual } from 'node:util'
import { assertTerminalLegacyMigrationReceipt } from '../../shared/terminal-legacy-cutover-request-validation'
import type {
  TerminalLegacyImportCandidate,
  TerminalLegacyMigrationReceipt,
  TerminalLegacyUnresolvedCandidate
} from '../../shared/terminal-legacy-cutover'
import {
  assertAuthorityId,
  assertAuthorityStoragePath,
  isRecord
} from '../../shared/terminal-session-authority-identity'
import type {
  LegacyPhysicalWorkerDescriptor,
  SshLegacyMigrationRpc,
  SshLegacyPhysicalWorkerInspection
} from './ssh-legacy-migration-coordinator-types'
import { SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY } from './ssh-legacy-migration-inventory-capacity'

const INSPECT_METHOD = 'terminalAuthority.legacyPhysicalWorker.inspect'
const MIGRATE_METHOD = 'terminalAuthority.legacyPhysicalWorker.migrate'
const GC_PROTECTION_METHOD = 'terminalAuthority.legacyPhysicalWorker.gcProtection'
const MIGRATION_BARRIER_METHOD = 'terminalAuthority.legacyPhysicalWorker.migrationBarrier'
const GC_METHOD = 'terminalAuthority.legacyPhysicalWorker.gc'

export type SshLegacyWorkerCatalog = Readonly<{
  migrationId: string
  authorityHostId: string
  requestedAtMs: number
  imports: readonly TerminalLegacyImportCandidate[]
  unresolved: readonly TerminalLegacyUnresolvedCandidate[]
}>

export type SshLegacyWorkerMigrationOperation = Readonly<{
  operationId: string
  inspectionToken: string
  evidenceDigest: string
  catalog: SshLegacyWorkerCatalog
}>

export type SshLegacyWorkerMigrationCommit = Readonly<{
  receipt: TerminalLegacyMigrationReceipt
  duplicate: boolean
}>

export async function inspectSshLegacyWorker(input: {
  rpc: SshLegacyMigrationRpc
  worker: LegacyPhysicalWorkerDescriptor
  signal: AbortSignal
}): Promise<SshLegacyPhysicalWorkerInspection> {
  const value = await input.rpc.request(
    INSPECT_METHOD,
    {
      version: 1,
      worker: input.worker,
      requirements: {
        inspectionMode: 'observational',
        catalogValidation: 'before-isolation',
        replay: 'durable-operation-id'
      }
    },
    { signal: input.signal }
  )
  return parseInspection(value, input.worker)
}

export async function migrateSshLegacyWorker(input: {
  rpc: SshLegacyMigrationRpc
  worker: LegacyPhysicalWorkerDescriptor
  operation: SshLegacyWorkerMigrationOperation
  signal: AbortSignal
}): Promise<SshLegacyWorkerMigrationCommit> {
  const value = await input.rpc.request(
    MIGRATE_METHOD,
    operationParams(input.worker, input.operation),
    { signal: input.signal }
  )
  return parseCommit(value, input.worker, input.operation)
}

export async function readSshLegacyGcProtection(input: {
  rpc: SshLegacyMigrationRpc
  signal: AbortSignal
}): Promise<number> {
  const value = await input.rpc.request(
    GC_PROTECTION_METHOD,
    { version: 1 },
    { signal: input.signal }
  )
  if (!isRecord(value) || !nonNegativeInteger(value.catalogRevision)) {
    throw new Error('legacy GC protection response is invalid')
  }
  assertProtection(value.protection)
  return Number(value.catalogRevision)
}

export async function commitSshLegacyMigrationBarrier(input: {
  rpc: SshLegacyMigrationRpc
  barrierId: string
  catalogRevision: number
  signal: AbortSignal
}): Promise<void> {
  const value = await input.rpc.request(
    MIGRATION_BARRIER_METHOD,
    {
      version: 1,
      barrierId: input.barrierId,
      expectedCatalogRevision: input.catalogRevision
    },
    { signal: input.signal }
  )
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.barrierId !== input.barrierId ||
    value.catalogRevision !== input.catalogRevision ||
    !nonNegativeInteger(value.committedAtMs)
  ) {
    throw new Error('legacy migration barrier response is invalid')
  }
}

export async function collectSshLegacyGc(input: {
  rpc: SshLegacyMigrationRpc
  barrierId: string
  signal: AbortSignal
}): Promise<readonly string[]> {
  const value = await input.rpc.request(
    GC_METHOD,
    { version: 1, barrierId: input.barrierId },
    { signal: input.signal }
  )
  if (!isRecord(value) || !Array.isArray(value.removed) || value.removed.length > 256) {
    throw new Error('legacy GC response is invalid')
  }
  value.removed.forEach((path) => assertAuthorityStoragePath(path, 'legacy GC removed path'))
  assertProtection(value.protected)
  return Object.freeze([...new Set(value.removed as string[])].sort())
}

function operationParams(
  worker: LegacyPhysicalWorkerDescriptor,
  operation: SshLegacyWorkerMigrationOperation
): Record<string, unknown> {
  return {
    version: 1,
    worker,
    operationId: operation.operationId,
    inspectionToken: operation.inspectionToken,
    evidenceDigest: operation.evidenceDigest,
    catalog: operation.catalog
  }
}

function parseInspection(
  value: unknown,
  worker: LegacyPhysicalWorkerDescriptor
): SshLegacyPhysicalWorkerInspection {
  if (
    !isRecord(value) ||
    value.protocolVersion !== 1 ||
    value.workerId !== worker.workerId ||
    value.routeId !== worker.routeId ||
    value.buildId !== worker.buildId ||
    !isRecord(value.preparation) ||
    value.preparation.mode !== 'observational' ||
    value.preparation.catalogValidation !== 'before-isolation' ||
    value.preparation.replay !== 'durable-operation-id' ||
    !isRecord(value.identityProof) ||
    !Array.isArray(value.ptys) ||
    value.ptys.length > SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.rowsPerRelay
  ) {
    throw new Error('legacy physical worker inspection is not migration-safe')
  }
  assertAuthorityId(value.preparation.token, 'legacy inspection token')
  assertAuthorityId(value.preparation.evidenceDigest, 'legacy inspection evidence digest')
  for (const pty of value.ptys) {
    assertPreparedPty(pty)
  }
  return Object.freeze(structuredClone(value)) as SshLegacyPhysicalWorkerInspection
}

function assertPreparedPty(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.serialized)) {
    throw new Error('legacy prepared PTY evidence is invalid')
  }
  for (const field of ['id', 'incarnationId', 'cwd', 'title'] as const) {
    if (typeof value[field] !== 'string') {
      throw new Error('legacy prepared PTY identity is invalid')
    }
  }
  if (value.processId !== null && !positiveInteger(value.processId)) {
    throw new Error('legacy prepared PTY process is invalid')
  }
  const serialized = value.serialized
  for (const field of ['paneKey', 'tabId', 'worktreeId', 'cwd', 'ptyIncarnationId'] as const) {
    if (serialized[field] !== null && typeof serialized[field] !== 'string') {
      throw new Error('legacy prepared PTY serialized evidence is invalid')
    }
  }
  if (serialized.processId !== null && !positiveInteger(serialized.processId)) {
    throw new Error('legacy prepared PTY serialized process is invalid')
  }
}

function parseCommit(
  value: unknown,
  worker: LegacyPhysicalWorkerDescriptor,
  operation: SshLegacyWorkerMigrationOperation
): SshLegacyWorkerMigrationCommit {
  if (
    !isRecord(value) ||
    value.operationId !== operation.operationId ||
    value.inspectionToken !== operation.inspectionToken ||
    typeof value.duplicate !== 'boolean' ||
    !isRecord(value.receipt)
  ) {
    throw new Error('legacy migration commit response is invalid')
  }
  const receipt = value.receipt as TerminalLegacyMigrationReceipt
  assertTerminalLegacyMigrationReceipt(receipt)
  const request = receipt.request
  if (
    request.mode !== 'cutover' ||
    request.migrationId !== operation.catalog.migrationId ||
    request.authorityHostId !== operation.catalog.authorityHostId ||
    request.requestedAtMs !== operation.catalog.requestedAtMs ||
    request.workerRoute.workerId !== worker.workerId ||
    request.workerRoute.routeId !== worker.routeId ||
    request.workerRoute.buildId !== worker.buildId ||
    !isDeepStrictEqual(request.imports, operation.catalog.imports) ||
    !sameRecoveryIds(request.unresolved, operation.catalog.unresolved)
  ) {
    throw new Error('legacy migration receipt does not match the prepared operation')
  }
  return Object.freeze({ receipt: structuredClone(receipt), duplicate: value.duplicate })
}

function sameRecoveryIds(
  committed: readonly TerminalLegacyUnresolvedCandidate[],
  planned: readonly TerminalLegacyUnresolvedCandidate[]
): boolean {
  const ids = (values: readonly TerminalLegacyUnresolvedCandidate[]) =>
    values.map((candidate) => candidate.recoveryId).sort()
  return isDeepStrictEqual(ids(committed), ids(planned))
}

function assertProtection(value: unknown): void {
  if (
    !isRecord(value) ||
    !Array.isArray(value.relayDirectories) ||
    !Array.isArray(value.evidencePaths)
  ) {
    throw new Error('legacy GC protection is invalid')
  }
  if (value.relayDirectories.length > 256 || value.evidencePaths.length > 1_024) {
    throw new Error('legacy GC protection exceeds capacity')
  }
  ;[...value.relayDirectories, ...value.evidencePaths].forEach((path) =>
    assertAuthorityStoragePath(path, 'legacy GC protection path')
  )
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
