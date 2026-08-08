import { isDeepStrictEqual } from 'node:util'
import {
  assertAuthorityId,
  assertAuthorityStoragePath
} from '../../shared/terminal-session-authority-identity'
import type {
  SshLegacyMigrationInventoryInput,
  SshLegacyMigrationInventoryPlan
} from './ssh-legacy-migration-inventory-types'
import type {
  SshLegacyInspectedWorker,
  SshLegacyPhysicalWorkerInspection,
  LegacyPhysicalWorkerDescriptor
} from './ssh-legacy-migration-coordinator-types'
import {
  compareSshLegacyText,
  sshLegacyEvidenceDigest,
  sshLegacyEvidenceId
} from './ssh-legacy-migration-evidence-identity'
import { SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY } from './ssh-legacy-migration-inventory-capacity'
import type {
  SshLegacyWorkerCatalog,
  SshLegacyWorkerMigrationOperation
} from './ssh-legacy-migration-rpc'

export function validatedWorkers(
  workers: readonly LegacyPhysicalWorkerDescriptor[]
): readonly LegacyPhysicalWorkerDescriptor[] {
  if (
    !Array.isArray(workers) ||
    workers.length > SSH_LEGACY_MIGRATION_INVENTORY_CAPACITY.liveRelays
  ) {
    throw new Error('legacy physical worker discovery exceeds capacity')
  }
  const workerIds = new Set<string>()
  const routeIds = new Set<string>()
  const ownerIds = new Set<string>()
  for (const worker of workers) {
    assertWorkerDescriptor(worker)
    if (
      workerIds.has(worker.workerId) ||
      routeIds.has(worker.routeId) ||
      ownerIds.has(worker.ownerIncarnationId)
    ) {
      throw new Error('legacy physical worker discovery is ambiguous')
    }
    workerIds.add(worker.workerId)
    routeIds.add(worker.routeId)
    ownerIds.add(worker.ownerIncarnationId)
  }
  return Object.freeze(
    [...workers].sort(
      (left, right) =>
        compareSshLegacyText(left.routeId, right.routeId) ||
        compareSshLegacyText(left.workerId, right.workerId)
    )
  )
}

export function assertInspectionDigest(
  worker: LegacyPhysicalWorkerDescriptor,
  inspection: SshLegacyPhysicalWorkerInspection
): void {
  const expected = sshLegacyEvidenceDigest({
    protocolVersion: inspection.protocolVersion,
    workerId: inspection.workerId,
    routeId: inspection.routeId,
    buildId: inspection.buildId,
    identityProof: inspection.identityProof,
    ptys: inspection.ptys
  })
  if (inspection.preparation.evidenceDigest !== expected) {
    throw new Error('legacy physical worker inspection digest is invalid')
  }
  if (
    !isDeepStrictEqual(inspection.identityProof.expectedEndpoint, worker.expectedEndpoint) ||
    !isDeepStrictEqual(inspection.identityProof.expectedProcess, worker.process)
  ) {
    throw new Error('legacy physical worker inspection changed expected identity')
  }
}

export function assertInventoryIdentity(
  input: Pick<SshLegacyMigrationInventoryInput, 'targetId' | 'authorityHostId' | 'hostPathFlavor'>,
  inventory: SshLegacyMigrationInventoryInput
): void {
  if (
    inventory.targetId !== input.targetId ||
    inventory.authorityHostId !== input.authorityHostId ||
    inventory.hostPathFlavor !== input.hostPathFlavor
  ) {
    throw new Error('legacy migration inventory changed its authority identity')
  }
}

export function assertInventoryMatchesInspections(
  relays: SshLegacyMigrationInventoryInput['liveRelays'],
  inspected: readonly SshLegacyInspectedWorker[]
): void {
  if (relays.length !== inspected.length) {
    throw new Error('legacy migration inventory omitted an inspected worker')
  }
  const relaysByWorker = new Map(relays.map((relay) => [relay.workerId, relay]))
  if (relaysByWorker.size !== relays.length) {
    throw new Error('legacy migration inventory duplicated a worker')
  }
  for (const prepared of inspected) {
    const relay = relaysByWorker.get(prepared.descriptor.workerId)
    if (!relay || relay.buildId !== prepared.descriptor.buildId) {
      throw new Error('legacy migration inventory changed a worker identity')
    }
    assertExactIdentityProof(relay.identityProof)
    if (!isDeepStrictEqual(relay.identityProof, prepared.inspection.identityProof)) {
      throw new Error('legacy migration inventory changed endpoint or process proof')
    }
    const rows = new Map(relay.rows.map((row) => [row.physicalPtyId, row]))
    if (rows.size !== relay.rows.length || rows.size !== prepared.inspection.ptys.length) {
      throw new Error('legacy migration inventory changed PTY membership')
    }
    for (const pty of prepared.inspection.ptys) {
      const row = rows.get(pty.id)
      if (
        !row ||
        row.workerId !== prepared.descriptor.workerId ||
        row.buildId !== prepared.descriptor.buildId ||
        row.ptyIncarnationId !== pty.incarnationId ||
        row.processId !== pty.processId ||
        !isDeepStrictEqual(row.serialized, pty.serialized)
      ) {
        throw new Error('legacy migration inventory changed exact PTY evidence')
      }
    }
  }
}

export function assertPlanCoverage(
  plan: SshLegacyMigrationInventoryPlan,
  inspected: readonly SshLegacyInspectedWorker[]
): void {
  const workers = new Map(inspected.map((entry) => [entry.descriptor.workerId, entry]))
  const candidateKeys = new Set<string>()
  for (const candidate of [...plan.imports, ...plan.unresolved]) {
    const workerId = candidate.physicalPty.workerId
    if (!workers.has(workerId)) {
      throw new Error('legacy migration plan references an unprepared worker')
    }
    const key = JSON.stringify([workerId, candidate.physicalPty.physicalPtyId])
    if (candidateKeys.has(key)) {
      throw new Error('legacy migration plan is not one-to-one')
    }
    candidateKeys.add(key)
  }
  for (const prepared of inspected) {
    for (const pty of prepared.inspection.ptys) {
      if (!candidateKeys.has(JSON.stringify([prepared.descriptor.workerId, pty.id]))) {
        throw new Error('legacy migration plan omitted a prepared PTY')
      }
    }
  }
  for (const candidate of plan.unresolved) {
    if (candidate.preservation.kind !== 'evidence-gc-retained') {
      throw new Error('legacy migration unresolved preservation is not pre-cutover evidence')
    }
  }
}

export function workerCatalog(
  plan: SshLegacyMigrationInventoryPlan,
  workerId: string
): SshLegacyWorkerCatalog {
  const imports = plan.imports.filter((candidate) => candidate.physicalPty.workerId === workerId)
  const unresolved = plan.unresolved.filter(
    (candidate) => candidate.physicalPty.workerId === workerId
  )
  const first = imports[0] ?? unresolved[0]
  if (!first) {
    throw new Error('legacy worker catalog has no candidates')
  }
  const requestedAtMs = Math.max(
    ...imports.map((candidate) => candidate.inventoryEvidence.observedAtMs),
    ...unresolved.map((candidate) => candidate.inventoryEvidence.observedAtMs)
  )
  return Object.freeze({
    migrationId: sshLegacyEvidenceId('ssh-legacy-worker-migration', [plan.migrationId, workerId]),
    authorityHostId: first.namespace.authorityHostId,
    requestedAtMs,
    imports: Object.freeze(imports),
    unresolved: Object.freeze(unresolved)
  })
}

export function workerOperation(
  plan: SshLegacyMigrationInventoryPlan,
  prepared: SshLegacyInspectedWorker,
  catalog: SshLegacyWorkerCatalog
): SshLegacyWorkerMigrationOperation {
  return Object.freeze({
    operationId: sshLegacyEvidenceId('ssh-legacy-worker-operation', [
      plan.migrationId,
      prepared.descriptor.routeId,
      prepared.inspection.preparation.evidenceDigest
    ]),
    inspectionToken: prepared.inspection.preparation.token,
    evidenceDigest: prepared.inspection.preparation.evidenceDigest,
    catalog
  })
}

function assertWorkerDescriptor(worker: LegacyPhysicalWorkerDescriptor): void {
  if (worker.version !== 1 || !Number.isSafeInteger(worker.requestedSourceWindowSu)) {
    throw new Error('legacy physical worker descriptor is invalid')
  }
  for (const [field, value] of [
    ['workerId', worker.workerId],
    ['routeId', worker.routeId],
    ['ownerIncarnationId', worker.ownerIncarnationId],
    ['buildId', worker.buildId],
    ['clientInstanceId', worker.clientInstanceId]
  ] as const) {
    assertAuthorityId(value, `legacy physical worker ${field}`)
  }
  assertAuthorityStoragePath(worker.relayDirectory, 'legacy worker relay directory')
}

function assertExactIdentityProof(
  proof: SshLegacyMigrationInventoryInput['liveRelays'][number]['identityProof']
): void {
  if (
    proof.expectedEndpoint === null ||
    proof.observedEndpoint === null ||
    proof.expectedProcess === null ||
    proof.observedProcess === null ||
    !isDeepStrictEqual(proof.expectedEndpoint, proof.observedEndpoint) ||
    !isDeepStrictEqual(proof.expectedProcess, proof.observedProcess)
  ) {
    throw new Error('legacy migration requires exact endpoint and process proof')
  }
}
