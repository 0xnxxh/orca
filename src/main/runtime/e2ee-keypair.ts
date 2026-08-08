// Why: the E2EE keypair enables application-layer encryption between mobile
// and desktop over plain ws://. The public key is embedded in the QR pairing
// offer so the mobile client can derive a shared secret via ECDH.
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import nacl from 'tweetnacl'
import { removeFileDurableSync } from '../../shared/durable-file-write'
import {
  type E2EEIdentityStorageInspection,
  type IdentityMarker,
  type IdentityPaths,
  type ValidatedKeypair,
  identityPaths,
  inspectE2EEIdentityStorage,
  pathExists,
  readIdentityMarker,
  requireCurrentKeypair,
  requireCurrentWithMarker,
  requireFirstInstallStage,
  requireResetStage,
  writeIdentityMarker,
  writeStageKeypair
} from './e2ee-keypair-storage'
import { requireResetStageLineage } from './e2ee-keypair-backup-lineage'
import { DEVICE_REGISTRY_FILENAME, RELAY_REVOKE_OUTBOX_FILENAME } from './mobile-pairing-files'
import {
  cleanupReplacementBackup,
  finalizeE2EEKeypairResetSuccessor,
  isPublishedResetStage,
  removeE2EEKeypairResetResidue,
  replaceStageAndVerify,
  sameKeyMaterial,
  stageE2EEKeypairResetSuccessor,
  publishE2EEKeypairResetSuccessor,
  toE2EEKeypair,
  type E2EEKeypairResetTransaction
} from './e2ee-keypair-successor'

export type E2EEKeypair = {
  publicKey: Uint8Array
  secretKey: Uint8Array
  publicKeyB64: string
  installationId: string
}

export type { E2EEKeypairResetTransaction }
export {
  finalizeE2EEKeypairResetSuccessor,
  removeE2EEKeypairResetResidue,
  publishE2EEKeypairResetSuccessor,
  stageE2EEKeypairResetSuccessor
}

/** Loads the predecessor while a reset-owned stage is still pending. */
export function loadE2EEKeypairForIdentityReset(
  userDataPath: string,
  transaction: E2EEKeypairResetTransaction
): E2EEKeypair {
  const inspection = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  requireCurrentWithMarker(inspection.active, inspection.marker)
  if (transaction.phase === 'creating-successor') {
    if (inspection.stage) {
      requireResetStage(inspection.stage, transaction.transactionId, transaction.oldPublicKeyB64)
      requireResetStageLineage(inspection)
    } else if (inspection.active.publicKeyB64 !== transaction.oldPublicKeyB64) {
      throw new Error('E2EE reset transaction no longer owns the active identity')
    }
    return toE2EEKeypair(inspection.active)
  }
  requireResetStage(inspection.stage, transaction.transactionId, transaction.oldPublicKeyB64)
  requireResetStageLineage(inspection)
  if (!sameKeyMaterial(inspection.active, inspection.stage)) {
    throw new Error('E2EE reset successor is not published')
  }
  return toE2EEKeypair(inspection.active)
}

/** Recognizes the durable post-cleanup boundary for a retry cut between cleanup and phase advance. */
export function isE2EEKeypairResetResidueAbsent(
  userDataPath: string,
  transaction: E2EEKeypairResetTransaction
): boolean {
  const inspection = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  try {
    requireCurrentWithMarker(inspection.active, inspection.marker)
  } catch {
    return false
  }
  return (
    inspection.stage === null &&
    inspection.replacementBackup === null &&
    inspection.active.publicKeyB64 !== transaction.oldPublicKeyB64
  )
}

export type { E2EEIdentityStorageInspection }

/** Creates or recovers the one explicitly allowed first-install publication. */
export function loadOrCreateE2EEKeypair(userDataPath: string): E2EEKeypair {
  const paths = identityPaths(userDataPath)
  if (
    pathExists(paths.active, 'E2EE keypair') ||
    pathExists(paths.marker, 'E2EE identity marker') ||
    pathExists(paths.stage, 'E2EE keypair stage') ||
    pathExists(paths.backup, 'E2EE keypair backup') ||
    pathExists(join(userDataPath, RELAY_REVOKE_OUTBOX_FILENAME), 'relay revoke outbox')
  ) {
    return loadE2EEKeypair(userDataPath)
  }
  if (pathExists(join(userDataPath, DEVICE_REGISTRY_FILENAME), 'mobile pairing registry')) {
    throw new Error('Established E2EE identity is missing')
  }
  return createFirstInstallKeypair(paths)
}

/** Strict ordinary startup loader; reset stages are never activated here. */
export function loadE2EEKeypair(userDataPath: string): E2EEKeypair {
  const paths = identityPaths(userDataPath)
  let inspection = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  if (inspection.active?.schema === 'legacy') {
    return migrateLegacyKeypair(paths, inspection.active, inspection.marker, inspection.stage)
  }
  if (inspection.stage) {
    if (inspection.active) {
      requireCurrentWithMarker(inspection.active, inspection.marker)
      if (
        inspection.stage.purpose === 'first-install' &&
        sameKeyMaterial(inspection.stage, inspection.active) &&
        inspection.stage.installationId === inspection.active.installationId
      ) {
        removeFileDurableSync(paths.stage)
        cleanupReplacementBackup(paths)
        return toE2EEKeypair(inspection.active)
      }
      if (inspection.stage.purpose === 'reset') {
        requireResetStageLineage(inspection)
      }
      if (isPublishedResetStage(inspection)) {
        return toE2EEKeypair(inspection.active)
      }
      throw new Error('E2EE keypair stage cannot replace an active identity during startup')
    }
    requireFirstInstallStage(inspection.stage)
    if (inspection.marker && inspection.marker.installationId !== inspection.stage.installationId) {
      throw new Error('E2EE identity marker does not match the staged keypair')
    }
    if (!inspection.marker) {
      writeIdentityMarker(paths.marker, inspection.stage.installationId)
    }
    replaceStageAndVerify(paths, inspection.stage.installationId)
    inspection = inspectE2EEIdentityStorage(userDataPath, {
      preserveReplacementBackup: true
    })
  }
  if (!inspection.active) {
    throw new Error('Established E2EE identity is missing')
  }
  requireCurrentWithMarker(inspection.active, inspection.marker)
  cleanupReplacementBackup(paths)
  return toE2EEKeypair(inspection.active)
}

/** Validates a lifecycle unit without activating a stage or rewriting any file. */
export function validateE2EEIdentityStorage(
  userDataPath: string,
  options: { preserveReplacementBackup?: boolean } = {}
): void {
  const inspection = inspectE2EEIdentityStorage(userDataPath, {
    ...options,
    preserveReplacementBackup: true
  })
  if (inspection.stage) {
    requireCurrentKeypair(inspection.stage)
    if (inspection.stage.purpose === 'reset' && !inspection.stage.transactionId) {
      throw new Error('E2EE reset stage requires a reset transaction')
    }
    if (inspection.active) {
      if (inspection.active.schema === 'legacy') {
        if (
          inspection.stage.purpose !== 'first-install' ||
          (inspection.marker &&
            inspection.stage.installationId !== inspection.marker.installationId) ||
          !sameKeyMaterial(inspection.stage, inspection.active)
        ) {
          throw new Error(
            'E2EE identity marker does not match the keypair or exact migration stage'
          )
        }
        return
      }
      requireCurrentWithMarker(inspection.active, inspection.marker)
      const marker = inspection.marker
      if (!marker || inspection.stage.installationId !== marker.installationId) {
        throw new Error('E2EE identity marker does not match the staged keypair')
      }
      if (
        inspection.stage.purpose === 'reset' &&
        inspection.stage.publicKeyB64 === inspection.stage.predecessorPublicKeyB64
      ) {
        throw new Error('E2EE reset successor must differ from its predecessor')
      }
      if (inspection.stage.purpose === 'reset') {
        requireResetStageLineage(inspection)
      }
      if (
        inspection.stage.purpose === 'first-install' &&
        !sameKeyMaterial(inspection.stage, inspection.active)
      ) {
        throw new Error('E2EE first-install stage does not preserve the active keypair')
      }
    } else if (
      inspection.marker &&
      inspection.marker.installationId !== inspection.stage.installationId
    ) {
      throw new Error('E2EE identity marker does not match the staged keypair')
    } else if (inspection.stage.purpose === 'reset') {
      throw new Error('E2EE reset stage requires an active identity')
    }
    return
  }
  if (!inspection.active) {
    if (inspection.marker) {
      throw new Error('E2EE identity marker exists without a keypair')
    }
    return
  }
  if (inspection.active.schema === 'legacy') {
    if (inspection.marker) {
      throw new Error('E2EE identity marker does not match the keypair or exact migration stage')
    }
    return
  }
  requireCurrentWithMarker(inspection.active, inspection.marker)
}

function createFirstInstallKeypair(paths: IdentityPaths): E2EEKeypair {
  const installationId = randomUUID()
  const keypair = nacl.box.keyPair()
  writeStageKeypair(paths.stage, keypair, installationId, 'first-install')
  const staged = inspectE2EEIdentityStorage(dirname(paths.active)).stage
  requireFirstInstallStage(staged)
  if (staged.installationId !== installationId) {
    throw new Error('E2EE first-install stage validation failed')
  }
  writeIdentityMarker(paths.marker, installationId)
  readIdentityMarker(paths.marker)
  replaceStageAndVerify(paths, installationId)
  const published = inspectE2EEIdentityStorage(dirname(paths.active))
  requireCurrentWithMarker(published.active, published.marker)
  return toE2EEKeypair(published.active)
}

function migrateLegacyKeypair(
  paths: IdentityPaths,
  legacy: ValidatedKeypair,
  marker: IdentityMarker | null,
  stage: E2EEIdentityStorageInspection['stage']
): E2EEKeypair {
  let installationId = marker?.installationId
  if (stage) {
    requireFirstInstallStage(stage)
    if (stage.publicKeyB64 !== legacy.publicKeyB64 || !sameKeyMaterial(stage, legacy)) {
      throw new Error('E2EE marker-before-v2 stage does not preserve the legacy keypair')
    }
    if (installationId && stage.installationId !== installationId) {
      throw new Error('E2EE identity marker does not match the staged keypair')
    }
    installationId = stage.installationId
  } else {
    if (marker) {
      throw new Error('E2EE identity marker does not match the keypair or exact migration stage')
    }
    installationId = randomUUID()
    writeStageKeypair(
      paths.stage,
      { publicKey: legacy.publicKey, secretKey: legacy.secretKey },
      installationId,
      'first-install'
    )
  }
  if (!installationId) {
    throw new Error('E2EE legacy migration installation identity is missing')
  }
  const staged = inspectE2EEIdentityStorage(dirname(paths.active), {
    preserveReplacementBackup: true
  }).stage
  requireFirstInstallStage(staged)
  if (staged.installationId !== installationId || !sameKeyMaterial(staged, legacy)) {
    throw new Error('E2EE legacy migration stage does not preserve the legacy keypair')
  }
  if (!marker) {
    writeIdentityMarker(paths.marker, installationId)
  }
  readIdentityMarker(paths.marker)
  replaceStageAndVerify(paths, installationId)
  const current = inspectE2EEIdentityStorage(dirname(paths.active), {
    preserveReplacementBackup: true
  })
  requireCurrentWithMarker(current.active, current.marker)
  cleanupReplacementBackup(paths)
  return toE2EEKeypair(current.active)
}
