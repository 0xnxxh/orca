import { randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { removeFileDurableSync } from '../../shared/durable-file-write'
import { assertSecureRegularFile, writeSecureJsonFileDurable } from '../../shared/secure-file'
import {
  assertAuthorityId,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import {
  assertCanonicalKeyB64,
  assertTransactionId,
  hasExactKeys,
  isRecord,
  readSecureRecord
} from './e2ee-keypair-record-validation'
import { E2EE_IDENTITY_RESET_FILENAME } from './mobile-pairing-files'

export const E2EE_IDENTITY_RESET_VERSION = 1
export const E2EE_IDENTITY_RESET_MAX_HOSTS = 256
export const E2EE_IDENTITY_RESET_MAX_NAMESPACES = 4_096

export type E2EEIdentityResetPhase =
  | 'retiring-hosts'
  | 'revoking-relay'
  | 'closing-transports'
  | 'removing-local-credentials'
  | 'creating-successor'
  | 'successor-published'
  | 'finalizing-successor'
  | 're-enrollment'

export type E2EEIdentityResetTarget = Readonly<{
  authorityHostId: string
  namespaceIds: readonly string[]
}>

export type E2EEIdentityResetRecord = Readonly<{
  v: typeof E2EE_IDENTITY_RESET_VERSION
  transactionId: string
  oldPublicKeyB64: string
  requestedAt: number
  phase: E2EEIdentityResetPhase
  targets: readonly E2EEIdentityResetTarget[]
}>

const PHASE_ORDER: readonly E2EEIdentityResetPhase[] = [
  'retiring-hosts',
  'revoking-relay',
  'closing-transports',
  'removing-local-credentials',
  'creating-successor',
  'successor-published',
  'finalizing-successor',
  're-enrollment'
]
const MAX_RESET_FILE_BYTES = 256 * 1024

export class E2EEIdentityResetRecordStore {
  private readonly path: string

  constructor(userDataPath: string) {
    this.path = join(userDataPath, E2EE_IDENTITY_RESET_FILENAME)
  }

  read(): E2EEIdentityResetRecord | null {
    try {
      lstatSync(this.path)
      assertSecureRegularFile(this.path, 'E2EE identity reset transaction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      if (error instanceof Error && error.message.endsWith('is unavailable')) {
        throw error
      }
      throw new Error('E2EE identity reset transaction is invalid')
    }
    return decodeResetRecord(
      readSecureRecord(this.path, 'E2EE identity reset transaction', MAX_RESET_FILE_BYTES)
    )
  }

  create(
    oldPublicKeyB64: string,
    targets: readonly E2EEIdentityResetTarget[],
    requestedAt = Date.now()
  ): E2EEIdentityResetRecord {
    assertCanonicalKeyB64(oldPublicKeyB64, 'E2EE reset predecessor public key')
    const record = makeRecord({
      transactionId: `identity-reset:${randomUUID()}`,
      oldPublicKeyB64,
      requestedAt,
      phase: 'retiring-hosts',
      targets
    })
    this.write(record)
    return record
  }

  advance(
    current: E2EEIdentityResetRecord,
    phase: E2EEIdentityResetPhase
  ): E2EEIdentityResetRecord {
    const loaded = this.read()
    if (!loaded || loaded.transactionId !== current.transactionId) {
      throw new Error('E2EE identity reset transaction changed')
    }
    if (loaded.phase !== current.phase) {
      throw new Error('E2EE identity reset transaction phase changed')
    }
    if (phaseIndex(phase) < phaseIndex(current.phase)) {
      throw new Error('E2EE identity reset transaction phase regressed')
    }
    if (phaseIndex(phase) === phaseIndex(current.phase)) {
      return loaded
    }
    const next = Object.freeze({ ...loaded, phase })
    this.write(next)
    return next
  }

  remove(current: E2EEIdentityResetRecord): void {
    const loaded = this.read()
    if (!loaded || loaded.transactionId !== current.transactionId) {
      throw new Error('E2EE identity reset transaction changed')
    }
    if (loaded.phase !== 're-enrollment') {
      throw new Error('E2EE identity reset transaction is not ready to remove')
    }
    removeFileDurableSync(this.path)
  }

  get filePath(): string {
    return this.path
  }

  private write(record: E2EEIdentityResetRecord): void {
    validateResetRecord(record)
    writeSecureJsonFileDurable(this.path, record)
  }
}

export function phaseIndex(phase: E2EEIdentityResetPhase): number {
  const index = PHASE_ORDER.indexOf(phase)
  if (index < 0) {
    throw new Error('E2EE identity reset phase is invalid')
  }
  return index
}

export function validateResetRecord(value: unknown): asserts value is E2EEIdentityResetRecord {
  if (!isRecord(value) || !hasExactKeys(value, ['v', 'transactionId', 'oldPublicKeyB64', 'requestedAt', 'phase', 'targets'])) {
    throw new Error('E2EE identity reset transaction is invalid')
  }
  if (value.v !== E2EE_IDENTITY_RESET_VERSION) {
    throw new Error('E2EE identity reset transaction version is invalid')
  }
  assertTransactionId(value.transactionId as string)
  assertCanonicalKeyB64(value.oldPublicKeyB64, 'E2EE reset predecessor public key')
  if (
    typeof value.requestedAt !== 'number' ||
    !Number.isSafeInteger(value.requestedAt) ||
    value.requestedAt < 0
  ) {
    throw new Error('E2EE identity reset request time is invalid')
  }
  if (typeof value.phase !== 'string' || !PHASE_ORDER.includes(value.phase as E2EEIdentityResetPhase)) {
    throw new Error('E2EE identity reset phase is invalid')
  }
  validateTargets(value.targets)
}

export function resetTargetsFromNamespaces(
  namespaces: readonly TerminalAuthorityNamespace[]
): readonly E2EEIdentityResetTarget[] {
  const byHost = new Map<string, Set<string>>()
  for (const namespace of namespaces) {
    assertAuthorityId(namespace.authorityHostId, 'authorityHostId')
    assertAuthorityId(namespace.namespaceId, 'namespaceId')
    const hostNamespaces = byHost.get(namespace.authorityHostId) ?? new Set<string>()
    hostNamespaces.add(namespace.namespaceId)
    byHost.set(namespace.authorityHostId, hostNamespaces)
  }
  const targets = [...byHost.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([authorityHostId, namespaceIds]) => ({
      authorityHostId,
      namespaceIds: [...namespaceIds].sort()
    }))
  validateTargets(targets)
  return Object.freeze(targets.map((target) => Object.freeze({
    authorityHostId: target.authorityHostId,
    namespaceIds: Object.freeze([...target.namespaceIds])
  })))
}

/** Canonicalizes the bounded host inventory without creating a second transaction ledger. */
export function resetTargetsFromAuthorityTargets(
  targets: readonly E2EEIdentityResetTarget[]
): readonly E2EEIdentityResetTarget[] {
  const byHost = new Map<string, Set<string>>()
  for (const target of targets) {
    assertAuthorityId(target.authorityHostId, 'authorityHostId')
    const namespaceIds = byHost.get(target.authorityHostId) ?? new Set<string>()
    for (const namespaceId of target.namespaceIds) {
      assertAuthorityId(namespaceId, 'namespaceId')
      namespaceIds.add(namespaceId)
    }
    byHost.set(target.authorityHostId, namespaceIds)
  }
  const canonical = [...byHost.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([authorityHostId, namespaceIds]) => ({
      authorityHostId,
      namespaceIds: [...namespaceIds].sort()
    }))
  validateTargets(canonical)
  return Object.freeze(
    canonical.map((target) =>
      Object.freeze({
        authorityHostId: target.authorityHostId,
        namespaceIds: Object.freeze([...target.namespaceIds])
      })
    )
  )
}

function makeRecord(input: {
  transactionId: string
  oldPublicKeyB64: string
  requestedAt: number
  phase: E2EEIdentityResetPhase
  targets: readonly E2EEIdentityResetTarget[]
}): E2EEIdentityResetRecord {
  const record = Object.freeze({
    v: E2EE_IDENTITY_RESET_VERSION,
    transactionId: input.transactionId,
    oldPublicKeyB64: input.oldPublicKeyB64,
    requestedAt: input.requestedAt,
    phase: input.phase,
    targets: input.targets.map((target) =>
      Object.freeze({
        authorityHostId: target.authorityHostId,
        namespaceIds: Object.freeze([...target.namespaceIds])
      })
    )
  })
  validateResetRecord(record)
  return record
}

function decodeResetRecord(raw: Record<string, unknown>): E2EEIdentityResetRecord {
  validateResetRecord(raw)
  return makeRecord(raw)
}

function validateTargets(value: unknown): asserts value is readonly E2EEIdentityResetTarget[] {
  if (!Array.isArray(value) || value.length > E2EE_IDENTITY_RESET_MAX_HOSTS) {
    throw new Error('E2EE identity reset targets are invalid')
  }
  const hosts = new Set<string>()
  let namespaceCount = 0
  for (const target of value) {
    if (!isRecord(target) || !hasExactKeys(target, ['authorityHostId', 'namespaceIds'])) {
      throw new Error('E2EE identity reset targets are invalid')
    }
    assertAuthorityId(target.authorityHostId, 'authorityHostId')
    if (hosts.has(target.authorityHostId)) {
      throw new Error('E2EE identity reset targets are invalid')
    }
    hosts.add(target.authorityHostId)
    if (
      !Array.isArray(target.namespaceIds) ||
      target.namespaceIds.length > E2EE_IDENTITY_RESET_MAX_NAMESPACES
    ) {
      throw new Error('E2EE identity reset targets are invalid')
    }
    const namespaces = new Set<string>()
    for (const namespaceId of target.namespaceIds) {
      assertAuthorityId(namespaceId, 'namespaceId')
      if (namespaces.has(namespaceId)) {
        throw new Error('E2EE identity reset targets are invalid')
      }
      namespaces.add(namespaceId)
      namespaceCount += 1
    }
  }
  if (namespaceCount > E2EE_IDENTITY_RESET_MAX_NAMESPACES) {
    throw new Error('E2EE identity reset targets are invalid')
  }
}
