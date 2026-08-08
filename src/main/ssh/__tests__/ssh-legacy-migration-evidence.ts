import { TERMINAL_LEGACY_CUTOVER_CAPABILITY } from '../../../shared/terminal-legacy-cutover'
import type {
  LegacyPhysicalWorkerDescriptor,
  SshLegacyMigrationEvidenceProvider,
  SshLegacyPhysicalWorkerInspection
} from '../ssh-legacy-migration-coordinator-types'
import { sshLegacyEvidenceDigest } from '../ssh-legacy-migration-evidence-identity'
import type { SshLegacyMigrationInventoryInput } from '../ssh-legacy-migration-inventory-types'

export const SSH_LEGACY_TEST_CAPABILITIES = Object.freeze([TERMINAL_LEGACY_CUTOVER_CAPABILITY])

export function descriptorForInventory(
  inventory: SshLegacyMigrationInventoryInput,
  workerIndex = 0
): LegacyPhysicalWorkerDescriptor {
  const relay = inventory.liveRelays[workerIndex]
  const endpoint = relay.identityProof.expectedEndpoint
  const process = relay.identityProof.expectedProcess
  if (!endpoint || !process) {
    throw new Error('test inventory requires exact worker identity')
  }
  const base = {
    version: 1 as const,
    workerId: relay.workerId,
    routeId: `route-${relay.workerId}`,
    ownerIncarnationId: `owner-${relay.workerId}`,
    buildId: relay.buildId,
    clientInstanceId: `client-${relay.workerId}`,
    relayDirectory: `/relay/${relay.workerId}`,
    process,
    expectedEndpoint: endpoint,
    requestedSourceWindowSu: 1024,
    publicCredentialFile: `/relay/${relay.workerId}/credential`,
    privateCredentialFile: `/authority/${relay.workerId}/credential`,
    privateStateDirectory: `/authority/${relay.workerId}`
  }
  return endpoint.kind === 'windows-named-pipe'
    ? Object.freeze({
        ...base,
        platform: 'win32' as const,
        pipeName: endpoint.pipeName,
        activePipeMarkerPath: `C:/relay/${relay.workerId}/active-pipe`,
        privateActivePipeMarkerPath: `C:/authority/${relay.workerId}/active-pipe`
      })
    : Object.freeze({
        ...base,
        platform: 'linux' as const,
        publicSocketPath: `/relay/${relay.workerId}/relay.sock`,
        privateSocketPath: `/authority/${relay.workerId}/relay.sock`
      })
}

export function inspectionForWorker(
  inventory: SshLegacyMigrationInventoryInput,
  descriptor: LegacyPhysicalWorkerDescriptor
): SshLegacyPhysicalWorkerInspection {
  const relay = inventory.liveRelays.find((entry) => entry.workerId === descriptor.workerId)
  if (!relay) {
    throw new Error('test worker is missing from inventory')
  }
  const ptys = relay.rows.map((row) =>
    Object.freeze({
      id: row.physicalPtyId,
      incarnationId: row.ptyIncarnationId ?? '',
      processId: row.processId,
      cwd: row.serialized.cwd ?? '',
      title: 'shell',
      ...(row.serialized.worktreeId ? { worktreeId: row.serialized.worktreeId } : {}),
      serialized: row.serialized
    })
  )
  const evidence = {
    protocolVersion: 1 as const,
    workerId: descriptor.workerId,
    routeId: descriptor.routeId,
    buildId: descriptor.buildId,
    identityProof: relay.identityProof,
    ptys: Object.freeze(ptys)
  }
  return Object.freeze({
    ...evidence,
    preparation: Object.freeze({
      mode: 'observational' as const,
      token: `token-${descriptor.workerId}`,
      evidenceDigest: sshLegacyEvidenceDigest(evidence),
      catalogValidation: 'before-isolation' as const,
      replay: 'durable-operation-id' as const
    })
  })
}

export function evidenceProviderForInventory(
  inventory: SshLegacyMigrationInventoryInput,
  workers: readonly LegacyPhysicalWorkerDescriptor[]
): SshLegacyMigrationEvidenceProvider {
  return Object.freeze({
    discoverWorkers: async () => Object.freeze({ kind: 'ready' as const, workers }),
    buildInventory: async () => Object.freeze({ kind: 'ready' as const, inventory })
  })
}

export function combineSshLegacyInventories(
  first: SshLegacyMigrationInventoryInput,
  second: SshLegacyMigrationInventoryInput
): SshLegacyMigrationInventoryInput {
  return Object.freeze({
    ...first,
    persistedConsumerRecoveries: Object.freeze([
      ...first.persistedConsumerRecoveries,
      ...second.persistedConsumerRecoveries
    ]),
    persistedPtyLeases: Object.freeze([...first.persistedPtyLeases, ...second.persistedPtyLeases]),
    localLayoutPanes: Object.freeze([...first.localLayoutPanes, ...second.localLayoutPanes]),
    remoteSnapshotPanes: Object.freeze([
      ...first.remoteSnapshotPanes,
      ...second.remoteSnapshotPanes
    ]),
    liveRelays: Object.freeze([...first.liveRelays, ...second.liveRelays])
  })
}
