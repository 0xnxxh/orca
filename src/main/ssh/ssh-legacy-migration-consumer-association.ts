import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'
import { failSshLegacyMigrationEvidence } from './ssh-legacy-migration-evidence-capacity'
import type {
  SshLegacyDiscoveredRelayEvidence,
  SshLegacyWorkerRecoveryAssociation
} from './ssh-legacy-migration-evidence-bridge-types'
import type { SshLegacyPersistedConsumerEvidence } from './ssh-legacy-migration-inventory-types'

export function indexSshLegacyDiscoveredRelays(
  relays: readonly SshLegacyDiscoveredRelayEvidence[]
): ReadonlyMap<string, SshLegacyDiscoveredRelayEvidence> {
  const index = new Map<string, SshLegacyDiscoveredRelayEvidence>()
  for (const relay of relays) {
    assertSshLegacyDiscoveredRelayIdentity(relay)
    const key = sshLegacyWorkerAssociationKey(relay)
    if (index.has(key)) {
      failSshLegacyMigrationEvidence('ambiguity', 'discovered relay association')
    }
    index.set(key, relay)
  }
  return index
}

export function collectSshLegacyWorkerRecoveries(
  targetId: string,
  associations: readonly SshLegacyWorkerRecoveryAssociation[],
  relayByAssociation: ReadonlyMap<string, SshLegacyDiscoveredRelayEvidence>
): readonly SshLegacyPersistedConsumerEvidence[] {
  const recoveryOwners = new Map<string, string>()
  const associatedRelays = new Set<string>()
  const consumers: SshLegacyPersistedConsumerEvidence[] = []
  for (const association of associations) {
    assertRecoveryAssociation(association)
    const relayKey = sshLegacyWorkerAssociationKey(association)
    const relay = relayByAssociation.get(relayKey)
    if (!relay || associatedRelays.has(relayKey)) {
      failSshLegacyMigrationEvidence('ambiguity', 'worker recovery association')
    }
    const recoveryKey = JSON.stringify([
      targetId,
      association.recovery.clientInstanceId,
      association.recovery.serverBuildId
    ])
    const existingOwner = recoveryOwners.get(recoveryKey)
    if (existingOwner !== undefined && existingOwner !== relayKey) {
      failSshLegacyMigrationEvidence('ambiguity', 'worker recovery owner')
    }
    recoveryOwners.set(recoveryKey, relayKey)
    associatedRelays.add(relayKey)
    consumers.push(
      Object.freeze({
        targetId,
        workerId: relay.workerId,
        clientInstanceId: association.recovery.clientInstanceId,
        serverBuildId: relay.buildId
      })
    )
  }
  return Object.freeze(consumers)
}

export function assertSshLegacyDiscoveredRelayIdentity(
  relay: SshLegacyDiscoveredRelayEvidence
): void {
  assertAuthorityId(relay.targetId, 'SSH legacy discovered relay targetId')
  assertAuthorityId(relay.endpointId, 'SSH legacy discovered relay endpointId')
  assertAuthorityId(relay.workerId, 'SSH legacy discovered relay workerId')
  assertAuthorityId(relay.buildId, 'SSH legacy discovered relay buildId')
}

function assertRecoveryAssociation(association: SshLegacyWorkerRecoveryAssociation): void {
  assertAuthorityId(association.targetId, 'SSH legacy recovery targetId')
  assertAuthorityId(association.endpointId, 'SSH legacy recovery endpointId')
  assertAuthorityId(association.workerId, 'SSH legacy recovery workerId')
  assertAuthorityId(association.buildId, 'SSH legacy recovery buildId')
  if (
    association.recovery.targetId !== association.targetId ||
    association.recovery.serverBuildId !== association.buildId
  ) {
    failSshLegacyMigrationEvidence('malformed', 'worker recovery provenance')
  }
}

function sshLegacyWorkerAssociationKey(value: {
  targetId: string
  endpointId: string
  workerId: string
  buildId: string
}): string {
  return JSON.stringify([value.targetId, value.endpointId, value.workerId, value.buildId])
}
