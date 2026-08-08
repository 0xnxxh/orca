import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import type nacl from 'tweetnacl'
import { removeFileDurableSync, renameFileDurableSync } from '../../shared/durable-file-write'
import { writeSecureJsonFileDurable } from '../../shared/secure-file'
import {
  E2EE_IDENTITY_MARKER_FILENAME,
  E2EE_KEYPAIR_FILENAME,
  E2EE_KEYPAIR_STAGE_FILENAME
} from './mobile-pairing-files'
import {
  type IdentityMarker,
  readIdentityMarker,
  writeIdentityMarker
} from './e2ee-keypair-identity-marker'

import {
  KEYPAIR_VERSION,
  LEGACY_KEYPAIR_VERSION,
  MAX_KEYPAIR_FILE_BYTES,
  assertInstallationId,
  assertCanonicalKeyB64,
  assertTransactionId,
  decodeKeypair,
  hasExactKeys,
  isInstallationId,
  isCanonicalKeyB64,
  isTransactionId,
  readSecureRecord
} from './e2ee-keypair-record-validation'
import { verifiedReplacementBackupPath } from './e2ee-keypair-replacement'
import { assertReplacementBackupLineage } from './e2ee-keypair-backup-lineage'

export type E2EEKeypairStagePurpose = 'first-install' | 'reset'

type KeypairFile = {
  v: number
  publicKeyB64: string
  secretKeyB64: string
  installationId?: string
}

type StageFile = KeypairFile & {
  purpose: E2EEKeypairStagePurpose
  transactionId?: string
  predecessorPublicKeyB64?: string
}

export type ValidatedKeypair = {
  schema: 'legacy' | 'current'
  publicKey: Uint8Array
  secretKey: Uint8Array
  publicKeyB64: string
  installationId?: string
}

export type ValidatedStage = ValidatedKeypair & {
  schema: 'current'
  installationId: string
  purpose: E2EEKeypairStagePurpose
  transactionId?: string
  predecessorPublicKeyB64?: string
}

export type E2EEIdentityStorageInspection = Readonly<{
  active: ValidatedKeypair | null
  stage: ValidatedStage | null
  marker: IdentityMarker | null
  replacementBackup: ValidatedKeypair | null
}>

export type IdentityPaths = {
  active: string
  stage: string
  marker: string
  backup: string
}

type IdentityInspectionOptions = {
  preserveReplacementBackup?: boolean
}

export { replaceVerifiedKeypairStage } from './e2ee-keypair-replacement'
export { readIdentityMarker, writeIdentityMarker }
export type { IdentityMarker }

export function identityPaths(userDataPath: string): IdentityPaths {
  const active = join(userDataPath, E2EE_KEYPAIR_FILENAME)
  return {
    active,
    stage: join(userDataPath, E2EE_KEYPAIR_STAGE_FILENAME),
    marker: join(userDataPath, E2EE_IDENTITY_MARKER_FILENAME),
    backup: verifiedReplacementBackupPath(active)
  }
}

export function pathExists(path: string, field: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw new Error(`${field} is unavailable`)
  }
}

export function inspectE2EEIdentityStorage(
  userDataPath: string,
  options: IdentityInspectionOptions = {}
): E2EEIdentityStorageInspection {
  const paths = identityPaths(userDataPath)
  recoverInterruptedReplacement(paths, options.preserveReplacementBackup === true)
  return {
    active: pathExists(paths.active, 'E2EE keypair') ? readAndValidateKeypair(paths.active) : null,
    stage: pathExists(paths.stage, 'E2EE keypair stage') ? readAndValidateStage(paths.stage) : null,
    marker: pathExists(paths.marker, 'E2EE identity marker')
      ? readIdentityMarker(paths.marker)
      : null,
    replacementBackup: pathExists(paths.backup, 'E2EE keypair backup')
      ? readAndValidateKeypair(paths.backup)
      : null
  }
}

/** Recovers or retires the deterministic backup before identity inspection. */
function recoverInterruptedReplacement(paths: IdentityPaths, preserveBackup: boolean): void {
  if (!pathExists(paths.backup, 'E2EE keypair backup')) {
    return
  }
  const backup = readAndValidateKeypair(paths.backup)
  const marker = pathExists(paths.marker, 'E2EE identity marker')
    ? readIdentityMarker(paths.marker)
    : null
  const stage = pathExists(paths.stage, 'E2EE keypair stage')
    ? readAndValidateStage(paths.stage)
    : null
  if (!pathExists(paths.active, 'E2EE keypair')) {
    assertReplacementBackupLineage(backup, null, marker, stage)
    renameFileDurableSync(paths.backup, paths.active)
    return
  }

  const active = readAndValidateKeypair(paths.active)
  assertReplacementBackupLineage(backup, active, marker, stage)
  if (!preserveBackup) {
    removeFileDurableSync(paths.backup)
  }
}

export function requireCurrentWithMarker(
  keypair: ValidatedKeypair | null,
  marker: IdentityMarker | null
): asserts keypair is ValidatedKeypair & { schema: 'current'; installationId: string } {
  requireCurrentKeypair(keypair)
  if (!marker || keypair.installationId !== marker.installationId) {
    throw new Error('E2EE identity marker does not match the keypair')
  }
}

export function requireCurrentKeypair(
  keypair: ValidatedKeypair | null
): asserts keypair is ValidatedKeypair & { schema: 'current'; installationId: string } {
  if (!keypair || keypair.schema !== 'current' || !keypair.installationId) {
    throw new Error('E2EE keypair is not a current-schema record')
  }
}

export function requireFirstInstallStage(
  stage: ValidatedStage | null
): asserts stage is ValidatedStage & { purpose: 'first-install'; transactionId?: never } {
  if (!stage || stage.purpose !== 'first-install' || stage.transactionId !== undefined) {
    throw new Error('E2EE stage is not a first-install publication')
  }
}

export function requireResetStage(
  stage: ValidatedStage | null,
  transactionId: string,
  predecessorPublicKeyB64: string
): asserts stage is ValidatedStage & {
  purpose: 'reset'
  transactionId: string
  predecessorPublicKeyB64: string
} {
  assertTransactionId(transactionId)
  assertCanonicalKeyB64(predecessorPublicKeyB64, 'E2EE reset predecessor public key')
  if (
    !stage ||
    stage.purpose !== 'reset' ||
    stage.transactionId === undefined ||
    stage.transactionId !== transactionId ||
    stage.predecessorPublicKeyB64 !== predecessorPublicKeyB64 ||
    stage.publicKeyB64 === predecessorPublicKeyB64
  ) {
    throw new Error('E2EE reset stage does not match the reset transaction')
  }
}

export function readAndValidateKeypair(filePath: string): ValidatedKeypair {
  const raw = readSecureRecord(filePath, 'E2EE keypair', MAX_KEYPAIR_FILE_BYTES)
  if (
    raw.v === LEGACY_KEYPAIR_VERSION &&
    hasExactKeys(raw, ['v', 'publicKeyB64', 'secretKeyB64'])
  ) {
    return decodeKeypair(raw, 'legacy')
  }
  if (
    raw.v === KEYPAIR_VERSION &&
    hasExactKeys(raw, ['v', 'publicKeyB64', 'secretKeyB64', 'installationId']) &&
    isInstallationId(raw.installationId)
  ) {
    return { ...decodeKeypair(raw, 'current'), installationId: raw.installationId }
  }
  throw new Error('E2EE keypair is invalid')
}

export function readAndValidateStage(filePath: string): ValidatedStage {
  const raw = readSecureRecord(filePath, 'E2EE keypair stage', MAX_KEYPAIR_FILE_BYTES)
  if (raw.v !== KEYPAIR_VERSION || !isInstallationId(raw.installationId)) {
    throw new Error('E2EE keypair stage is invalid')
  }
  const firstInstallKeys = ['v', 'publicKeyB64', 'secretKeyB64', 'installationId', 'purpose']
  if (raw.purpose === 'first-install' && hasExactKeys(raw, firstInstallKeys)) {
    return {
      ...decodeKeypair(raw, 'current'),
      schema: 'current',
      installationId: raw.installationId,
      purpose: raw.purpose
    }
  }
  const resetKeys = [...firstInstallKeys, 'transactionId', 'predecessorPublicKeyB64']
  if (
    raw.purpose === 'reset' &&
    hasExactKeys(raw, resetKeys) &&
    isTransactionId(raw.transactionId) &&
    isCanonicalKeyB64(raw.predecessorPublicKeyB64)
  ) {
    return {
      ...decodeKeypair(raw, 'current'),
      schema: 'current',
      installationId: raw.installationId,
      purpose: raw.purpose,
      transactionId: raw.transactionId,
      predecessorPublicKeyB64: raw.predecessorPublicKeyB64
    }
  }
  throw new Error('E2EE keypair stage is invalid')
}

export function writeKeypair(
  filePath: string,
  keypair: Pick<nacl.BoxKeyPair, 'publicKey' | 'secretKey'>,
  installationId: string
): void {
  assertInstallationId(installationId)
  writeSecureJsonFileDurable(filePath, {
    v: KEYPAIR_VERSION,
    publicKeyB64: Buffer.from(keypair.publicKey).toString('base64'),
    secretKeyB64: Buffer.from(keypair.secretKey).toString('base64'),
    installationId
  } satisfies KeypairFile)
}

export function writeStageKeypair(
  filePath: string,
  keypair: Pick<nacl.BoxKeyPair, 'publicKey' | 'secretKey'>,
  installationId: string,
  purpose: E2EEKeypairStagePurpose,
  transactionId?: string,
  predecessorPublicKeyB64?: string
): void {
  assertInstallationId(installationId)
  if (purpose === 'reset') {
    if (transactionId === undefined) {
      throw new Error('E2EE reset stage requires a reset transaction')
    }
    assertTransactionId(transactionId)
    assertCanonicalKeyB64(predecessorPublicKeyB64, 'E2EE reset predecessor public key')
    if (Buffer.from(keypair.publicKey).toString('base64') === predecessorPublicKeyB64) {
      throw new Error('E2EE reset successor must differ from its predecessor')
    }
  } else if (transactionId !== undefined) {
    throw new Error('E2EE first-install stage cannot carry a reset transaction')
  } else if (predecessorPublicKeyB64 !== undefined) {
    throw new Error('E2EE first-install stage cannot carry a reset predecessor')
  }
  const stage: StageFile = {
    v: KEYPAIR_VERSION,
    publicKeyB64: Buffer.from(keypair.publicKey).toString('base64'),
    secretKeyB64: Buffer.from(keypair.secretKey).toString('base64'),
    installationId,
    purpose,
    ...(transactionId === undefined ? {} : { transactionId }),
    ...(predecessorPublicKeyB64 === undefined ? {} : { predecessorPublicKeyB64 })
  }
  writeSecureJsonFileDurable(filePath, stage)
}
