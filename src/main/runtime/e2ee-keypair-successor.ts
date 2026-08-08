import { dirname } from 'node:path'
import nacl from 'tweetnacl'
import { removeFileDurableSync } from '../../shared/durable-file-write'
import type { E2EEKeypair } from './e2ee-keypair'
import {
  type E2EEIdentityStorageInspection,
  type IdentityPaths,
  type ValidatedKeypair,
  identityPaths,
  inspectE2EEIdentityStorage,
  replaceVerifiedKeypairStage,
  requireCurrentKeypair,
  requireCurrentWithMarker,
  requireResetStage,
  writeKeypair,
  writeStageKeypair
} from './e2ee-keypair-storage'
import { requireResetStageLineage } from './e2ee-keypair-backup-lineage'
import { assertCanonicalKeyB64, assertTransactionId } from './e2ee-keypair-record-validation'

/** The sole reset transaction binds the durable stage to its old identity. */
export type E2EEKeypairResetTransaction = Readonly<{
  transactionId: string
  oldPublicKeyB64: string
  phase: 'creating-successor' | 'successor-published' | 'finalizing-successor'
}>

/** Stage exactly once; a durable stage is always reused for this transaction. */
export function stageE2EEKeypairResetSuccessor(
  userDataPath: string,
  transaction: E2EEKeypairResetTransaction
): void {
  assertCreatingSuccessor(transaction)
  const paths = identityPaths(userDataPath)
  const inspection = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  requireCurrentWithMarker(inspection.active, inspection.marker)
  if (inspection.stage) {
    requireResetStage(inspection.stage, transaction.transactionId, transaction.oldPublicKeyB64)
    requireResetStageLineage(inspection)
    return
  }
  assertExpectedOldIdentity(inspection.active, transaction)
  const successor = nacl.box.keyPair()
  writeStageKeypair(
    paths.stage,
    successor,
    inspection.active.installationId,
    'reset',
    transaction.transactionId,
    transaction.oldPublicKeyB64
  )
  requireResetStage(
    inspectE2EEIdentityStorage(userDataPath, { preserveReplacementBackup: true }).stage,
    transaction.transactionId,
    transaction.oldPublicKeyB64
  )
}

/** Publish the exact stage while retaining it for retry and later transaction finalization. */
export function publishE2EEKeypairResetSuccessor(
  userDataPath: string,
  transaction: E2EEKeypairResetTransaction
): E2EEKeypair {
  assertCreatingSuccessor(transaction)
  const paths = identityPaths(userDataPath)
  const inspection = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  requireCurrentWithMarker(inspection.active, inspection.marker)
  requireResetStage(inspection.stage, transaction.transactionId, transaction.oldPublicKeyB64)
  requireResetStageLineage(inspection)
  if (sameKeyMaterial(inspection.active, inspection.stage)) {
    return toE2EEKeypair(inspection.active)
  }
  if (inspection.active.publicKeyB64 !== transaction.oldPublicKeyB64) {
    throw new Error('E2EE reset transaction no longer owns the active identity')
  }
  replaceStageAndVerify(paths, inspection.active.installationId, {
    cleanupStage: false,
    retainReplacementBackup: true
  })
  const published = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  requireCurrentWithMarker(published.active, published.marker)
  requireResetStage(published.stage, transaction.transactionId, transaction.oldPublicKeyB64)
  requireResetStageLineage(published)
  if (!sameKeyMaterial(published.active, published.stage)) {
    throw new Error('E2EE reset successor publication did not preserve the staged keypair')
  }
  return toE2EEKeypair(published.active)
}

/**
 * Validate the later reset phase. The normative reset transaction owns stage cleanup;
 * this storage tranche leaves the exact stage in place until that durable phase commits.
 */
export function finalizeE2EEKeypairResetSuccessor(
  userDataPath: string,
  transaction: E2EEKeypairResetTransaction
): E2EEKeypair {
  assertFinalizingSuccessor(transaction)
  const inspection = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  requireCurrentWithMarker(inspection.active, inspection.marker)
  requireResetStage(inspection.stage, transaction.transactionId, transaction.oldPublicKeyB64)
  requireResetStageLineage(inspection)
  if (!sameKeyMaterial(inspection.active, inspection.stage)) {
    throw new Error('E2EE reset successor is not published')
  }
  return toE2EEKeypair(inspection.active)
}

/** Removes reset residue only after the successor and its predecessor lineage verify. */
export function removeE2EEKeypairResetResidue(
  userDataPath: string,
  transaction: E2EEKeypairResetTransaction
): E2EEKeypair {
  assertFinalizingSuccessor(transaction)
  const paths = identityPaths(userDataPath)
  const inspection = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  requireCurrentWithMarker(inspection.active, inspection.marker)
  requireResetStage(inspection.stage, transaction.transactionId, transaction.oldPublicKeyB64)
  requireResetStageLineage(inspection)
  if (!sameKeyMaterial(inspection.active, inspection.stage)) {
    throw new Error('E2EE reset successor is not published')
  }
  removeFileDurableSync(paths.stage)
  cleanupReplacementBackup(paths)
  return toE2EEKeypair(inspection.active)
}

/** Ordinary startup may observe a published reset stage but never promote a pending one. */
export function isPublishedResetStage(inspection: E2EEIdentityStorageInspection): boolean {
  if (
    inspection.stage?.purpose === 'reset' &&
    inspection.active?.schema === 'current' &&
    inspection.stage.installationId === inspection.active.installationId &&
    inspection.stage.publicKeyB64 !== inspection.stage.predecessorPublicKeyB64 &&
    sameKeyMaterial(inspection.active, inspection.stage)
  ) {
    try {
      requireResetStageLineage(inspection)
      return true
    } catch {
      return false
    }
  }
  return false
}

export function replaceStageAndVerify(
  paths: IdentityPaths,
  installationId: string,
  options: { cleanupStage?: boolean; retainReplacementBackup?: boolean } = {}
): void {
  const userDataPath = dirname(paths.active)
  const before = inspectE2EEIdentityStorage(userDataPath, {
    preserveReplacementBackup: true
  })
  const staged = before.stage
  requireCurrentKeypair(staged)
  if (options.retainReplacementBackup) {
    const active = before.active
    requireCurrentWithMarker(active, before.marker)
    writeKeypair(paths.backup, active, active.installationId)
    const retained = inspectE2EEIdentityStorage(userDataPath, {
      preserveReplacementBackup: true
    }).replacementBackup
    requireCurrentKeypair(retained)
    if (retained.publicKeyB64 !== active.publicKeyB64) {
      throw new Error('E2EE replacement backup did not retain the active predecessor')
    }
  }
  const publicationPath = `${paths.active}.publication`
  removeFileDurableSync(publicationPath)
  writeKeypair(publicationPath, staged, installationId)
  replaceVerifiedKeypairStage(publicationPath, paths.active, {
    retainBackup: options.retainReplacementBackup,
    verify: () => {
      const published = inspectE2EEIdentityStorage(userDataPath, {
        preserveReplacementBackup: true
      })
      requireCurrentWithMarker(published.active, published.marker)
      if (published.active.installationId !== installationId) {
        throw new Error('E2EE identity publication changed installation identity')
      }
    }
  })
  if (options.cleanupStage !== false) {
    removeFileDurableSync(paths.stage)
  }
}

export function cleanupReplacementBackup(paths: IdentityPaths): void {
  removeFileDurableSync(paths.backup)
}

export function sameKeyMaterial(left: ValidatedKeypair, right: ValidatedKeypair): boolean {
  return (
    Buffer.from(left.secretKey).equals(Buffer.from(right.secretKey)) &&
    Buffer.from(left.publicKey).equals(Buffer.from(right.publicKey))
  )
}

export function toE2EEKeypair(keypair: ValidatedKeypair): E2EEKeypair {
  requireCurrentKeypair(keypair)
  return {
    publicKey: Uint8Array.from(keypair.publicKey),
    secretKey: Uint8Array.from(keypair.secretKey),
    publicKeyB64: Buffer.from(keypair.publicKey).toString('base64'),
    installationId: keypair.installationId
  }
}

function assertCreatingSuccessor(transaction: E2EEKeypairResetTransaction): void {
  assertTransaction(transaction)
  if (transaction.phase !== 'creating-successor') {
    throw new Error('E2EE reset successor requires the creating-successor transaction')
  }
}

function assertFinalizingSuccessor(transaction: E2EEKeypairResetTransaction): void {
  assertTransaction(transaction)
  if (transaction.phase !== 'successor-published' && transaction.phase !== 'finalizing-successor') {
    throw new Error('E2EE reset successor requires the later finalization phase')
  }
}

function assertTransaction(transaction: E2EEKeypairResetTransaction): void {
  if (
    !transaction ||
    typeof transaction.transactionId !== 'string' ||
    !transaction.transactionId ||
    typeof transaction.oldPublicKeyB64 !== 'string'
  ) {
    throw new Error('E2EE reset successor requires the complete reset transaction')
  }
  assertTransactionId(transaction.transactionId)
  assertCanonicalKeyB64(transaction.oldPublicKeyB64, 'E2EE reset predecessor public key')
}

function assertExpectedOldIdentity(
  active: ValidatedKeypair & { schema: 'current'; installationId: string },
  transaction: E2EEKeypairResetTransaction
): void {
  if (active.publicKeyB64 !== transaction.oldPublicKeyB64) {
    throw new Error('E2EE reset transaction no longer owns the active identity')
  }
}
