import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadDeviceRegistryForReset } from './device-registry'
import {
  DEVICE_REGISTRY_FILENAME,
  E2EE_IDENTITY_MARKER_FILENAME,
  E2EE_KEYPAIR_BACKUP_FILENAME,
  E2EE_KEYPAIR_FILENAME,
  E2EE_KEYPAIR_STAGE_FILENAME,
  RELAY_REVOKE_OUTBOX_FILENAME
} from './mobile-pairing-files'
import {
  readAndValidateKeypair,
  readAndValidateStage,
  readIdentityMarker
} from './e2ee-keypair-storage'
import type { IdentityMarker, ValidatedKeypair, ValidatedStage } from './e2ee-keypair-storage'
import { loadRelayRevokeOutboxForReset } from './relay/relay-revoke-outbox'

export function isValidStagedArtifact(
  fileName: string,
  stagedPath: string,
  stagingDir: string
): boolean {
  try {
    switch (fileName) {
      case DEVICE_REGISTRY_FILENAME:
        loadDeviceRegistryForReset(stagingDir)
        break
      case E2EE_KEYPAIR_FILENAME:
      case E2EE_KEYPAIR_BACKUP_FILENAME:
        readAndValidateKeypair(stagedPath)
        break
      case E2EE_IDENTITY_MARKER_FILENAME:
        readIdentityMarker(stagedPath)
        break
      case E2EE_KEYPAIR_STAGE_FILENAME: {
        const stage = readAndValidateStage(stagedPath)
        return stage.purpose !== 'reset' || stage.publicKeyB64 !== stage.predecessorPublicKeyB64
      }
      case RELAY_REVOKE_OUTBOX_FILENAME:
        loadRelayRevokeOutboxForReset(stagingDir)
        break
      default:
        return false
    }
    return true
  } catch {
    return false
  }
}

export function areEquivalentStagedArtifacts(
  fileName: string,
  leftPath: string,
  leftDir: string,
  rightPath: string,
  rightDir: string
): boolean {
  try {
    switch (fileName) {
      case E2EE_KEYPAIR_FILENAME:
      case E2EE_KEYPAIR_BACKUP_FILENAME:
        return sameKeypairLineage(
          readAndValidateKeypair(leftPath),
          readAndValidateKeypair(rightPath)
        )
      case E2EE_IDENTITY_MARKER_FILENAME:
        return (
          readIdentityMarker(leftPath).installationId ===
          readIdentityMarker(rightPath).installationId
        )
      case E2EE_KEYPAIR_STAGE_FILENAME:
        return sameStageLineage(readAndValidateStage(leftPath), readAndValidateStage(rightPath))
      case DEVICE_REGISTRY_FILENAME:
        loadDeviceRegistryForReset(leftDir)
        loadDeviceRegistryForReset(rightDir)
        return sameJsonRecord(leftPath, rightPath)
      case RELAY_REVOKE_OUTBOX_FILENAME:
        loadRelayRevokeOutboxForReset(leftDir)
        loadRelayRevokeOutboxForReset(rightDir)
        return sameJsonRecord(leftPath, rightPath)
      default:
        return false
    }
  } catch {
    return false
  }
}

/** Rejects valid target identity residue that cannot coexist with the complete staged candidate. */
export function assertCompatibleIdentityResidue(targetDir: string, stagingDir: string): void {
  const target = readIdentityResidue(targetDir)
  const staged = readIdentityResidue(stagingDir)
  assertIdentityBindings(target, 'canonical mobile pairing target')
  assertIdentityBindings(staged, 'canonical mobile pairing staging')

  if (target.active && staged.active && !sameKeypairLineage(target.active, staged.active)) {
    throw new Error(
      'Source and canonical mobile pairing data have different E2EE identity ownership'
    )
  }
  if (
    target.marker &&
    staged.marker &&
    target.marker.installationId !== staged.marker.installationId
  ) {
    throw new Error(
      'Source and canonical mobile pairing data have different installation ownership'
    )
  }
  if (target.stage && staged.stage && !sameStageLineage(target.stage, staged.stage)) {
    throw new Error('Source and canonical mobile pairing data have different reset lineage')
  }
  assertCrossArtifactBindings(target, staged)
}

export function isMutableArtifact(fileName: string): boolean {
  return fileName === DEVICE_REGISTRY_FILENAME || fileName === RELAY_REVOKE_OUTBOX_FILENAME
}

type IdentityResidue = {
  active: ValidatedKeypair | null
  marker: IdentityMarker | null
  stage: ValidatedStage | null
}

function readIdentityResidue(userDataDir: string): IdentityResidue {
  return {
    active: readOptionalKeypair(userDataDir, E2EE_KEYPAIR_FILENAME),
    marker: readOptionalMarker(userDataDir),
    stage: readOptionalStage(userDataDir)
  }
}

function readOptionalKeypair(userDataDir: string, fileName: string): ValidatedKeypair | null {
  const filePath = join(userDataDir, fileName)
  return pathExists(filePath) && isValidStagedArtifact(fileName, filePath, userDataDir)
    ? readAndValidateKeypair(filePath)
    : null
}

function readOptionalMarker(userDataDir: string): IdentityMarker | null {
  const filePath = join(userDataDir, E2EE_IDENTITY_MARKER_FILENAME)
  return pathExists(filePath) &&
    isValidStagedArtifact(E2EE_IDENTITY_MARKER_FILENAME, filePath, userDataDir)
    ? readIdentityMarker(filePath)
    : null
}

function readOptionalStage(userDataDir: string): ValidatedStage | null {
  const filePath = join(userDataDir, E2EE_KEYPAIR_STAGE_FILENAME)
  return pathExists(filePath) &&
    isValidStagedArtifact(E2EE_KEYPAIR_STAGE_FILENAME, filePath, userDataDir)
    ? readAndValidateStage(filePath)
    : null
}

function assertIdentityBindings(identity: IdentityResidue, label: string): void {
  if (
    identity.active?.schema === 'current' &&
    identity.marker &&
    identity.active.installationId !== identity.marker.installationId
  ) {
    throw new Error(`${label} has a divergent installation binding`)
  }
  if (
    identity.active?.schema === 'current' &&
    identity.stage &&
    identity.active.installationId !== identity.stage.installationId
  ) {
    throw new Error(`${label} has a divergent stage installation binding`)
  }
  if (
    identity.marker &&
    identity.stage &&
    identity.marker.installationId !== identity.stage.installationId
  ) {
    throw new Error(`${label} has a divergent marker installation binding`)
  }
}

function assertCrossArtifactBindings(target: IdentityResidue, staged: IdentityResidue): void {
  if (
    target.active?.schema === 'current' &&
    staged.marker &&
    target.active.installationId !== staged.marker.installationId
  ) {
    throw new Error(
      'Source and canonical mobile pairing data have different installation ownership'
    )
  }
  if (
    target.marker &&
    staged.active?.schema === 'current' &&
    target.marker.installationId !== staged.active.installationId
  ) {
    throw new Error(
      'Source and canonical mobile pairing data have different installation ownership'
    )
  }
  if (
    target.active?.schema === 'current' &&
    staged.stage &&
    target.active.installationId !== staged.stage.installationId
  ) {
    throw new Error(
      'Source and canonical mobile pairing data have different installation ownership'
    )
  }
  if (
    target.marker &&
    staged.stage &&
    target.marker.installationId !== staged.stage.installationId
  ) {
    throw new Error(
      'Source and canonical mobile pairing data have different installation ownership'
    )
  }
  if (
    staged.active?.schema === 'current' &&
    target.stage &&
    staged.active.installationId !== target.stage.installationId
  ) {
    throw new Error(
      'Source and canonical mobile pairing data have different installation ownership'
    )
  }
  if (
    staged.marker &&
    target.stage &&
    staged.marker.installationId !== target.stage.installationId
  ) {
    throw new Error(
      'Source and canonical mobile pairing data have different installation ownership'
    )
  }
}

function sameKeypairLineage(left: ValidatedKeypair, right: ValidatedKeypair): boolean {
  return (
    Buffer.from(left.publicKey).equals(Buffer.from(right.publicKey)) &&
    Buffer.from(left.secretKey).equals(Buffer.from(right.secretKey)) &&
    left.installationId === right.installationId
  )
}

function sameStageLineage(left: ValidatedStage, right: ValidatedStage): boolean {
  return (
    sameKeypairLineage(left, right) &&
    left.installationId === right.installationId &&
    left.purpose === right.purpose &&
    left.transactionId === right.transactionId &&
    left.predecessorPublicKeyB64 === right.predecessorPublicKeyB64
  )
}

function sameJsonRecord(leftPath: string, rightPath: string): boolean {
  return (
    JSON.stringify(sortJson(JSON.parse(readFileSync(leftPath, 'utf8')))) ===
    JSON.stringify(sortJson(JSON.parse(readFileSync(rightPath, 'utf8'))))
  )
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    )
  }
  return value
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}
