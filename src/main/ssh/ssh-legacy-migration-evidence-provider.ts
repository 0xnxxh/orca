import type { TerminalAuthorityPathFlavor } from '../../shared/terminal-session-authority-locator'
import type { SshConnection } from './ssh-connection'
import { buildSshLegacyMigrationInventoryInput } from './ssh-legacy-migration-evidence-bridge'
import { SshLegacyMigrationEvidenceError } from './ssh-legacy-migration-evidence-capacity'
import type {
  SshLegacyInspectedWorker,
  SshLegacyInventoryEvidence,
  SshLegacyMigrationEvidenceProvider,
  SshLegacyWorkerDiscovery,
  LegacyPhysicalWorkerDescriptor
} from './ssh-legacy-migration-coordinator-types'
import type { SshLegacyWorkspaceReference } from './ssh-legacy-migration-evidence-bridge-types'
import { createSshLegacyHostLocatorResolver } from './ssh-legacy-migration-host-locator'
import { collectSshLegacyLocalMigrationEvidence } from './ssh-legacy-migration-local-evidence'
import { readSshLegacyPriorRelayEndpoint } from './ssh-legacy-migration-prior-relay-endpoint'
import {
  sshLegacyPriorRelayWorkerDescriptor,
  type SshLegacyPriorRelayStatus
} from './ssh-legacy-migration-prior-relay-status'
import { parseSshLegacyRemoteWorkspaceSnapshotEvidence } from './ssh-legacy-migration-remote-workspace-snapshot'
import {
  sshLegacyDiscoveredRelayEvidence,
  sshLegacyFolderPathById,
  sshLegacyPersistedWorkspacePartitions,
  sshLegacyReferenceByPaneKey,
  sshLegacyWorkerRecoveryAssociations,
  type SshLegacyMigrationEvidenceStore
} from './ssh-legacy-migration-store-evidence'
import type { RemoteHostPlatform } from './ssh-remote-platform'

export type SshLegacyMigrationEvidenceProviderInput = Readonly<{
  targetId: string
  partitionId: string
  clientInstanceId: string
  hostPlatform: RemoteHostPlatform | null
  nodePath: string | null
  priorRelayStatus: SshLegacyPriorRelayStatus
  store: SshLegacyMigrationEvidenceStore
  connection: () => SshConnection | null
  remoteWorkspaceSnapshot: () => unknown
  isAttemptCurrent: () => boolean
  now?: () => number
}>

/**
 * The production legacy-migration evidence provider. Every branch that cannot prove what it read
 * resolves to `unresolved`, which stops the cutover before any mutation instead of guessing.
 */
export function createSshLegacyMigrationEvidenceProvider(
  input: SshLegacyMigrationEvidenceProviderInput
): SshLegacyMigrationEvidenceProvider {
  let descriptor: LegacyPhysicalWorkerDescriptor | null = null
  return Object.freeze({
    discoverWorkers: async (context) => {
      const discovery = await discoverPriorRelayWorker(input, context.signal)
      descriptor = discovery.kind === 'ready' ? (discovery.workers[0] ?? null) : null
      return discovery
    },
    buildInventory: async (context) =>
      buildPriorRelayInventory(input, {
        authorityHostId: context.authorityHostId,
        hostPathFlavor: context.hostPathFlavor,
        signal: context.signal,
        workers: context.workers,
        descriptor
      })
  })
}

async function discoverPriorRelayWorker(
  input: SshLegacyMigrationEvidenceProviderInput,
  signal: AbortSignal
): Promise<SshLegacyWorkerDiscovery> {
  const status = input.priorRelayStatus
  if (status.kind === 'unknown') {
    return unresolved(status.reason)
  }
  if (status.kind !== 'superseded') {
    // Why leases matter here: an absent prior owner beside retained leases is missing evidence,
    // and a "nothing to import" cutover would silently strand those PTYs.
    return input.store.getSshRemotePtyLeases(input.targetId).length > 0
      ? unresolved('recorded prior relay status is missing for retained PTY leases')
      : Object.freeze({ kind: 'ready', workers: Object.freeze([]) })
  }
  const connection = input.connection()
  const hostPlatform = input.hostPlatform
  const nodePath = input.nodePath
  if (!connection || !hostPlatform || !nodePath) {
    return unresolved('the host environment for the prior relay observation is unavailable')
  }
  const endpoint = await readSshLegacyPriorRelayEndpoint({
    connection,
    hostPlatform,
    nodePath,
    marker: status.marker,
    signal
  })
  if (!input.isAttemptCurrent() || signal.aborted) {
    return unresolved('the migration attempt was superseded during prior relay observation')
  }
  if (endpoint.kind === 'unknown') {
    return unresolved(endpoint.reason)
  }
  try {
    return Object.freeze({
      kind: 'ready',
      workers: Object.freeze([
        sshLegacyPriorRelayWorkerDescriptor({
          marker: status.marker,
          hostPlatform,
          clientInstanceId: input.clientInstanceId,
          expectedEndpoint: endpoint.endpoint
        })
      ])
    })
  } catch (error) {
    return unresolved(evidenceReason(error))
  }
}

async function buildPriorRelayInventory(
  input: SshLegacyMigrationEvidenceProviderInput,
  context: Readonly<{
    authorityHostId: string
    hostPathFlavor: TerminalAuthorityPathFlavor
    signal: AbortSignal
    workers: readonly SshLegacyInspectedWorker[]
    descriptor: LegacyPhysicalWorkerDescriptor | null
  }>
): Promise<SshLegacyInventoryEvidence> {
  if (context.workers.length === 0) {
    return await emptyInventory(input, context)
  }
  if (
    !context.descriptor ||
    context.workers.some((worker) => !matches(context.descriptor, worker))
  ) {
    return unresolved('inspected workers do not match the recorded prior relay')
  }
  try {
    const folderPathById = sshLegacyFolderPathById(input.store)
    const persistedWorkspacePartitions = sshLegacyPersistedWorkspacePartitions(
      input.store,
      input.targetId
    )
    const persistedPtyLeases = input.store.getSshRemotePtyLeases(input.targetId)
    const workerRecoveries = sshLegacyWorkerRecoveryAssociations({
      store: input.store,
      targetId: input.targetId,
      endpointId: context.descriptor.publicCredentialFile,
      workerId: context.descriptor.workerId,
      buildId: context.descriptor.buildId
    })
    const remoteSnapshotPanes = parseSshLegacyRemoteWorkspaceSnapshotEvidence({
      targetId: input.targetId,
      partitionId: input.partitionId,
      snapshot: input.remoteWorkspaceSnapshot()
    })
    const local = collectSshLegacyLocalMigrationEvidence({
      targetId: input.targetId,
      persistedWorkspacePartitions,
      persistedPtyLeases,
      workerRecoveries
    })
    const discoveredRelays = sshLegacyDiscoveredRelayEvidence({
      targetId: input.targetId,
      endpointId: context.descriptor.publicCredentialFile,
      observedAtMs: (input.now ?? Date.now)(),
      folderPathById,
      referenceByPaneKey: sshLegacyReferenceByPaneKey(local.panes),
      workers: context.workers
    })
    if (!input.isAttemptCurrent() || context.signal.aborted) {
      return unresolved('the migration attempt was superseded while reading evidence')
    }
    const inventory = await buildSshLegacyMigrationInventoryInput({
      targetId: input.targetId,
      authorityHostId: context.authorityHostId,
      hostPathFlavor: context.hostPathFlavor,
      persistedWorkspacePartitions,
      persistedPtyLeases,
      workerRecoveries,
      remoteSnapshotPanes,
      discoveredRelays,
      resolveWorkspace: createSshLegacyHostLocatorResolver({
        authorityHostId: context.authorityHostId,
        hostPathFlavor: context.hostPathFlavor,
        references: workspaceReferences(local.panes, remoteSnapshotPanes, discoveredRelays)
      })
    })
    return Object.freeze({ kind: 'ready', inventory })
  } catch (error) {
    return unresolved(evidenceReason(error))
  }
}

async function emptyInventory(
  input: SshLegacyMigrationEvidenceProviderInput,
  context: Readonly<{ authorityHostId: string; hostPathFlavor: TerminalAuthorityPathFlavor }>
): Promise<SshLegacyInventoryEvidence> {
  try {
    return Object.freeze({
      kind: 'ready',
      inventory: await buildSshLegacyMigrationInventoryInput({
        targetId: input.targetId,
        authorityHostId: context.authorityHostId,
        hostPathFlavor: context.hostPathFlavor,
        persistedWorkspacePartitions: [],
        persistedPtyLeases: [],
        workerRecoveries: [],
        remoteSnapshotPanes: [],
        discoveredRelays: [],
        resolveWorkspace: createSshLegacyHostLocatorResolver({
          authorityHostId: context.authorityHostId,
          hostPathFlavor: context.hostPathFlavor,
          references: []
        })
      })
    })
  } catch (error) {
    return unresolved(evidenceReason(error))
  }
}

function matches(
  descriptor: LegacyPhysicalWorkerDescriptor | null,
  worker: SshLegacyInspectedWorker
): boolean {
  return (
    descriptor !== null &&
    worker.descriptor.workerId === descriptor.workerId &&
    worker.descriptor.routeId === descriptor.routeId &&
    worker.descriptor.buildId === descriptor.buildId
  )
}

type ReferencedPane = Readonly<{ workspaceReference: SshLegacyWorkspaceReference }>

function workspaceReferences(
  panes: readonly ReferencedPane[],
  snapshots: readonly ReferencedPane[],
  relays: readonly Readonly<{ rows: readonly ReferencedPane[] }>[]
): readonly SshLegacyWorkspaceReference[] {
  return Object.freeze([
    ...panes.map((pane) => pane.workspaceReference),
    ...snapshots.map((pane) => pane.workspaceReference),
    ...relays.flatMap((relay) => relay.rows.map((row) => row.workspaceReference))
  ])
}

function evidenceReason(error: unknown): string {
  if (error instanceof SshLegacyMigrationEvidenceError) {
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

function unresolved(reason: string): Readonly<{ kind: 'unresolved'; reason: string }> {
  return Object.freeze({ kind: 'unresolved', reason })
}
