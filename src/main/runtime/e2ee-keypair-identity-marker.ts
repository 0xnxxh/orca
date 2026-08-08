import { writeSecureJsonFileDurable } from '../../shared/secure-file'
import {
  IDENTITY_MARKER_VERSION,
  MAX_IDENTITY_MARKER_FILE_BYTES,
  assertInstallationId,
  hasExactKeys,
  isInstallationId,
  readSecureRecord
} from './e2ee-keypair-record-validation'

export type IdentityMarker = {
  v: number
  installationId: string
}

export function readIdentityMarker(markerPath: string): IdentityMarker {
  const raw = readSecureRecord(markerPath, 'E2EE identity marker', MAX_IDENTITY_MARKER_FILE_BYTES)
  if (Object.hasOwn(raw, 'consumerId') && !Object.hasOwn(raw, 'installationId')) {
    throw new Error('E2EE identity marker does not match the keypair')
  }
  if (
    raw.v !== IDENTITY_MARKER_VERSION ||
    !hasExactKeys(raw, ['v', 'installationId']) ||
    !isInstallationId(raw.installationId)
  ) {
    throw new Error('E2EE identity marker is invalid')
  }
  return { v: IDENTITY_MARKER_VERSION, installationId: raw.installationId }
}

export function writeIdentityMarker(markerPath: string, installationId: string): void {
  assertInstallationId(installationId)
  writeSecureJsonFileDurable(markerPath, {
    v: IDENTITY_MARKER_VERSION,
    installationId
  } satisfies IdentityMarker)
}
