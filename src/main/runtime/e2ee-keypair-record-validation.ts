import { timingSafeEqual } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import nacl from 'tweetnacl'
import { assertSecureRegularFile, hardenExistingSecureFile } from '../../shared/secure-file'
import type { ValidatedKeypair } from './e2ee-keypair-storage'

export const KEYPAIR_VERSION = 2
export const LEGACY_KEYPAIR_VERSION = 1
export const MAX_KEYPAIR_FILE_BYTES = 8 * 1024
export const IDENTITY_MARKER_VERSION = 1
export const MAX_IDENTITY_MARKER_FILE_BYTES = 8 * 1024
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/

export function readSecureRecord(
  path: string,
  field: string,
  maxBytes: number
): Record<string, unknown> {
  assertSecureRegularFile(path, field)
  hardenExistingSecureFile(path)
  assertBoundedFile(path, maxBytes, field)
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (isRecord(raw)) {
      return raw
    }
  } catch {
    // Normalize parse and read failures at the storage boundary.
  }
  throw new Error(`${field} is invalid`)
}

export function decodeKeypair(
  raw: Record<string, unknown>,
  schema: ValidatedKeypair['schema']
): ValidatedKeypair {
  const publicKey = decodeKey(raw.publicKeyB64, 'E2EE public key')
  const secretKey = decodeKey(raw.secretKeyB64, 'E2EE secret key')
  const derivedPublicKey = nacl.box.keyPair.fromSecretKey(secretKey).publicKey
  if (!timingSafeEqual(Buffer.from(publicKey), Buffer.from(derivedPublicKey))) {
    throw new Error('E2EE public key does not match the secret key')
  }
  return {
    schema,
    publicKey,
    secretKey,
    publicKeyB64: Buffer.from(publicKey).toString('base64')
  }
}

export function assertInstallationId(value: string): void {
  if (!isInstallationId(value)) {
    throw new Error('E2EE installation identity is invalid')
  }
}

export function assertTransactionId(value: string): void {
  if (!isTransactionId(value)) {
    throw new Error('E2EE reset transaction is invalid')
  }
}

export function assertCanonicalKeyB64(value: unknown, field: string): asserts value is string {
  if (!isCanonicalKeyB64(value)) {
    throw new Error(`${field} is invalid`)
  }
}

export function isCanonicalKeyB64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 44 || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    return false
  }
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 && decoded.toString('base64') === value
}

export function isInstallationId(value: unknown): value is string {
  return typeof value === 'string' && INSTALLATION_ID_PATTERN.test(value)
}

export function isTransactionId(value: unknown): value is string {
  return typeof value === 'string' && TRANSACTION_ID_PATTERN.test(value)
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeKey(value: unknown, field: string): Uint8Array {
  if (!isCanonicalKeyB64(value)) {
    throw new Error(`${field} is invalid`)
  }
  const decoded = Buffer.from(value, 'base64')
  return Uint8Array.from(decoded)
}

function assertBoundedFile(path: string, maxBytes: number, field: string): void {
  try {
    if (statSync(path).size > maxBytes) {
      throw new Error(`${field} is too large`)
    }
  } catch (error) {
    if (error instanceof Error && error.message === `${field} is too large`) {
      throw error
    }
    throw new Error(`${field} is unavailable`)
  }
}
