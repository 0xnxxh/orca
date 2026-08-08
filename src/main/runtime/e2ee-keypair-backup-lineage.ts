import type { IdentityMarker } from './e2ee-keypair-identity-marker'
import type {
  E2EEIdentityStorageInspection,
  ValidatedKeypair,
  ValidatedStage
} from './e2ee-keypair-storage'

export function assertReplacementBackupLineage(
  backup: ValidatedKeypair,
  active: ValidatedKeypair | null,
  marker: IdentityMarker | null,
  stage: ValidatedStage | null
): void {
  if (!marker || !stage || stage.installationId !== marker.installationId) {
    throw new Error('E2EE keypair backup does not match the active lifecycle')
  }

  if (stage.purpose === 'first-install') {
    if (!sameKeyMaterial(backup, stage)) {
      throw new Error('E2EE keypair backup does not match the active lifecycle')
    }
    if (backup.schema === 'current' && backup.installationId !== marker.installationId) {
      throw new Error('E2EE keypair backup does not match the active lifecycle')
    }
    if (active && !sameKeyMaterial(active, stage)) {
      throw new Error('E2EE keypair backup does not match the active lifecycle')
    }
    return
  }

  if (
    backup.schema !== 'current' ||
    backup.installationId !== marker.installationId ||
    backup.publicKeyB64 !== stage.predecessorPublicKeyB64 ||
    stage.publicKeyB64 === backup.publicKeyB64
  ) {
    throw new Error('E2EE keypair backup does not match the reset predecessor')
  }
  if (active && active.schema !== 'current') {
    throw new Error('E2EE keypair backup does not match the active lifecycle')
  }
  if (active && !sameKeyMaterial(active, stage) && active.publicKeyB64 !== backup.publicKeyB64) {
    throw new Error('E2EE keypair backup does not match the active lifecycle')
  }
}

/** Check reset lineage before and after the active path contains the successor. */
export function requireResetStageLineage(
  inspection: E2EEIdentityStorageInspection,
  options: { requirePublishedBackup?: boolean } = {}
): void {
  const { active, stage, marker, replacementBackup } = inspection
  if (!active || active.schema !== 'current' || !active.installationId) {
    throw new Error('E2EE keypair is not a current-schema record')
  }
  if (!marker || marker.installationId !== active.installationId) {
    throw new Error('E2EE identity marker does not match the keypair')
  }
  if (
    !stage ||
    stage.purpose !== 'reset' ||
    !stage.transactionId ||
    !stage.predecessorPublicKeyB64 ||
    stage.publicKeyB64 === stage.predecessorPublicKeyB64 ||
    stage.installationId !== active.installationId
  ) {
    throw new Error('E2EE reset stage does not preserve its original predecessor binding')
  }
  if (replacementBackup) {
    assertReplacementBackupLineage(replacementBackup, active, marker, stage)
  }
  if (sameKeyMaterial(active, stage)) {
    if (options.requirePublishedBackup !== false && !replacementBackup) {
      throw new Error('E2EE published reset stage is missing its predecessor binding')
    }
    return
  }
  if (active.publicKeyB64 !== stage.predecessorPublicKeyB64) {
    throw new Error('E2EE reset stage does not belong to the active predecessor')
  }
}

export function sameKeyMaterial(left: ValidatedKeypair, right: ValidatedKeypair): boolean {
  return (
    Buffer.from(left.secretKey).equals(Buffer.from(right.secretKey)) &&
    Buffer.from(left.publicKey).equals(Buffer.from(right.publicKey))
  )
}
