import type { SshRemotePtyLease } from '../../shared/ssh-types'
import {
  compareSshLegacyText,
  sshLegacyPhysicalPtyId
} from './ssh-legacy-migration-evidence-identity'
import {
  projectSshLegacyConsumerEvidence,
  projectSshLegacyLeaseEvidence,
  projectSshLegacyPaneEvidence,
  projectSshLegacyRelayEvidence,
  projectSshLegacySourceEvidence,
  sortSshLegacyEvidence
} from './ssh-legacy-migration-evidence-projection'
import type {
  SshLegacyLayoutPaneEvidence,
  SshLegacyLiveRelayInventory,
  SshLegacyMigrationInventoryInput,
  SshLegacyPersistedConsumerEvidence,
  SshLegacyRelayInventoryRow,
  SshLegacyRemoteSnapshotPaneEvidence
} from './ssh-legacy-migration-inventory-types'

export type SshLegacyInventorySource = Readonly<{
  relay: SshLegacyLiveRelayInventory
  row: SshLegacyRelayInventoryRow
}>

export type SshLegacyInventoryGroup = Readonly<{
  workerId: string
  physicalPtyId: string
  sources: readonly SshLegacyInventorySource[]
}>

export type SshLegacyLeaseWithoutInventory = Readonly<{
  physicalPtyId: string
  leases: readonly SshRemotePtyLease[]
}>

export type SshLegacyInventoryIndexes = Readonly<{
  consumers: readonly SshLegacyPersistedConsumerEvidence[]
  groups: readonly SshLegacyInventoryGroup[]
  leasesWithoutInventory: readonly SshLegacyLeaseWithoutInventory[]
  relayCount: number
  inventoryRowCount: number
  consumersFor: (workerId: string, buildId: string) => readonly SshLegacyPersistedConsumerEvidence[]
  leasesFor: (physicalPtyId: string) => readonly SshRemotePtyLease[]
  localPanesFor: (physicalPtyId: string) => readonly SshLegacyLayoutPaneEvidence[]
  snapshotPanesFor: (physicalPtyId: string) => readonly SshLegacyRemoteSnapshotPaneEvidence[]
  exactRemoteSourcesFor: (
    physicalPtyId: string,
    ptyIncarnationId: string | null
  ) => readonly SshLegacyInventorySource[]
  relaysForBuild: (buildId: string) => readonly SshLegacyLiveRelayInventory[]
}>

export function indexSshLegacyMigrationInventory(
  input: SshLegacyMigrationInventoryInput
): SshLegacyInventoryIndexes {
  const consumers = sortSshLegacyEvidence(
    input.persistedConsumerRecoveries.filter((row) => row.targetId === input.targetId),
    projectSshLegacyConsumerEvidence
  )
  const leases = input.persistedPtyLeases.filter((row) => row.targetId === input.targetId)
  const localPanes = input.localLayoutPanes.filter((row) => row.targetId === input.targetId)
  const snapshotPanes = input.remoteSnapshotPanes.filter((row) => row.targetId === input.targetId)
  const relays = input.liveRelays
  const leasesByPty = indexByPhysicalPty(input.targetId, leases, projectSshLegacyLeaseEvidence)
  const localPanesByPty = indexByPhysicalPty(
    input.targetId,
    localPanes,
    projectSshLegacyPaneEvidence
  )
  const snapshotPanesByPty = indexByPhysicalPty(
    input.targetId,
    snapshotPanes,
    projectSshLegacyPaneEvidence
  )
  const sources = relays.flatMap((relay) => relay.rows.map((row) => ({ relay, row })))
  const sourcesByExactRemote = indexSourcesByExactRemote(sources)
  const groups = groupInventorySources(sources)
  const inventoriedPtyIds = new Set(sources.map((source) => source.row.physicalPtyId))
  const leasesWithoutInventory = [...leasesByPty.entries()]
    .filter(([physicalPtyId]) => !inventoriedPtyIds.has(physicalPtyId))
    .sort(([left], [right]) => compareSshLegacyText(left, right))
    .map(([physicalPtyId, groupedLeases]) =>
      Object.freeze({ physicalPtyId, leases: Object.freeze([...groupedLeases]) })
    )
  const relaysByBuild = indexRelaysByBuild(relays)
  const consumersByWorkerBuild = indexConsumersByWorkerBuild(consumers)

  return Object.freeze({
    consumers: Object.freeze(consumers),
    groups: Object.freeze(groups),
    leasesWithoutInventory: Object.freeze(leasesWithoutInventory),
    relayCount: relays.length,
    inventoryRowCount: sources.length,
    consumersFor: (workerId, buildId) =>
      consumersByWorkerBuild.get(workerBuildKey(workerId, buildId)) ?? [],
    leasesFor: (physicalPtyId) => leasesByPty.get(physicalPtyId) ?? [],
    localPanesFor: (physicalPtyId) => localPanesByPty.get(physicalPtyId) ?? [],
    snapshotPanesFor: (physicalPtyId) => snapshotPanesByPty.get(physicalPtyId) ?? [],
    exactRemoteSourcesFor: (physicalPtyId, ptyIncarnationId) =>
      sourcesByExactRemote.get(exactRemoteKey(physicalPtyId, ptyIncarnationId)) ?? [],
    relaysForBuild: (buildId) => relaysByBuild.get(buildId) ?? []
  })
}

function indexConsumersByWorkerBuild(
  consumers: readonly SshLegacyPersistedConsumerEvidence[]
): Map<string, readonly SshLegacyPersistedConsumerEvidence[]> {
  const index = new Map<string, SshLegacyPersistedConsumerEvidence[]>()
  for (const consumer of consumers) {
    const key = workerBuildKey(consumer.workerId, consumer.serverBuildId)
    const existing = index.get(key) ?? []
    existing.push(consumer)
    index.set(key, existing)
  }
  return index
}

export function sshLegacyScopedEvidence(
  input: SshLegacyMigrationInventoryInput
): Readonly<Record<string, unknown>> {
  const consumers = input.persistedConsumerRecoveries
    .filter((value) => value.targetId === input.targetId)
    .map(projectScopedConsumer)
  const leases = input.persistedPtyLeases
    .filter((value) => value.targetId === input.targetId)
    .map((value) => projectScopedLease(input.targetId, value))
  const localPanes = input.localLayoutPanes
    .filter((value) => value.targetId === input.targetId)
    .map((value) => projectScopedPane(input.targetId, value))
  const snapshotPanes = input.remoteSnapshotPanes
    .filter((value) => value.targetId === input.targetId)
    .map((value) => projectScopedPane(input.targetId, value))
  return Object.freeze({
    version: 1,
    authorityHostId: input.authorityHostId,
    hostPathFlavor: input.hostPathFlavor,
    persistedConsumerRecoveries: sortSshLegacyEvidence(consumers, (value) => value),
    persistedPtyLeases: sortSshLegacyEvidence(leases, (value) => value),
    localLayoutPanes: sortSshLegacyEvidence(localPanes, (value) => value),
    remoteSnapshotPanes: sortSshLegacyEvidence(snapshotPanes, (value) => value),
    liveRelays: sortSshLegacyEvidence(input.liveRelays, (relay) =>
      projectSshLegacyRelayEvidence(relay, true)
    ).map((relay) => projectSshLegacyRelayEvidence(relay, true))
  })
}

function projectScopedConsumer(
  value: SshLegacyPersistedConsumerEvidence
): Readonly<Record<string, unknown>> {
  const { targetId: _targetId, ...evidence } = projectSshLegacyConsumerEvidence(value)
  return evidence
}

function projectScopedLease(
  targetId: string,
  value: SshRemotePtyLease
): Readonly<Record<string, unknown>> {
  const { targetId: _targetId, ptyId: _ptyId, ...evidence } = projectSshLegacyLeaseEvidence(value)
  return { ...evidence, physicalPtyId: sshLegacyPhysicalPtyId(targetId, value.ptyId) }
}

function projectScopedPane(
  targetId: string,
  value: SshLegacyLayoutPaneEvidence
): Readonly<Record<string, unknown>> {
  const { targetId: _targetId, ptyId: _ptyId, ...evidence } = projectSshLegacyPaneEvidence(value)
  return { ...evidence, physicalPtyId: sshLegacyPhysicalPtyId(targetId, value.ptyId) }
}

function indexByPhysicalPty<T extends { ptyId: string }>(
  targetId: string,
  rows: readonly T[],
  project: (value: T) => unknown
): Map<string, readonly T[]> {
  const index = new Map<string, T[]>()
  for (const row of rows) {
    const physicalPtyId = sshLegacyPhysicalPtyId(targetId, row.ptyId)
    if (physicalPtyId === null) {
      continue
    }
    const existing = index.get(physicalPtyId) ?? []
    existing.push(row)
    index.set(physicalPtyId, existing)
  }
  for (const [key, values] of index) {
    index.set(key, sortSshLegacyEvidence(values, project))
  }
  return index
}

function indexSourcesByExactRemote(
  sources: readonly SshLegacyInventorySource[]
): Map<string, readonly SshLegacyInventorySource[]> {
  const index = new Map<string, SshLegacyInventorySource[]>()
  for (const source of sources) {
    const key = exactRemoteKey(source.row.physicalPtyId, source.row.ptyIncarnationId)
    const existing = index.get(key) ?? []
    existing.push(source)
    index.set(key, existing)
  }
  for (const [key, values] of index) {
    index.set(key, sortInventorySources(values))
  }
  return index
}

function indexRelaysByBuild(
  relays: readonly SshLegacyLiveRelayInventory[]
): Map<string, readonly SshLegacyLiveRelayInventory[]> {
  const index = new Map<string, SshLegacyLiveRelayInventory[]>()
  for (const relay of relays) {
    const existing = index.get(relay.buildId) ?? []
    existing.push(relay)
    index.set(relay.buildId, existing)
  }
  for (const [key, values] of index) {
    index.set(
      key,
      sortSshLegacyEvidence(values, (relay) => projectSshLegacyRelayEvidence(relay, true))
    )
  }
  return index
}

function groupInventorySources(
  sources: readonly SshLegacyInventorySource[]
): SshLegacyInventoryGroup[] {
  const grouped = new Map<string, SshLegacyInventorySource[]>()
  for (const source of sources) {
    const key = JSON.stringify([source.relay.workerId, source.row.physicalPtyId])
    const existing = grouped.get(key) ?? []
    existing.push(source)
    grouped.set(key, existing)
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => compareSshLegacyText(left, right))
    .map(([, values]) => {
      const sourcesForPty = sortInventorySources(values)
      const first = sourcesForPty[0]
      return Object.freeze({
        workerId: first.relay.workerId,
        physicalPtyId: first.row.physicalPtyId,
        sources: Object.freeze(sourcesForPty)
      })
    })
}

function sortInventorySources(
  sources: readonly SshLegacyInventorySource[]
): SshLegacyInventorySource[] {
  return sortSshLegacyEvidence(sources, projectSshLegacySourceEvidence)
}

function exactRemoteKey(physicalPtyId: string, ptyIncarnationId: string | null): string {
  return JSON.stringify([physicalPtyId, ptyIncarnationId])
}

function workerBuildKey(workerId: string, buildId: string): string {
  return JSON.stringify([workerId, buildId])
}
