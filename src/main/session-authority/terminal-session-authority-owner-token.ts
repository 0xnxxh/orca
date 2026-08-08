import { Buffer } from 'node:buffer'
import { assertAuthorityId, isRecord } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityOwnerProcessIdentity } from './terminal-session-authority-owner-process'

const OWNER_TOKEN_PREFIX = 'terminal-authority-owner-v1.'

export type TerminalAuthorityOwnerProof = Readonly<{
  ownerIncarnationId: string
  process: TerminalAuthorityOwnerProcessIdentity
}>

export function encodeTerminalAuthorityOwnerToken(
  ownerNonce: string,
  proof: TerminalAuthorityOwnerProof
): string {
  assertAuthorityId(ownerNonce, 'authority owner nonce')
  assertAuthorityId(proof.ownerIncarnationId, 'ownerIncarnationId')
  assertTerminalAuthorityOwnerProcessIdentity(proof.process)
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      ownerNonce,
      ownerIncarnationId: proof.ownerIncarnationId,
      process: proof.process
    }),
    'utf8'
  ).toString('base64url')
  const ownerToken = `${OWNER_TOKEN_PREFIX}${payload}`
  assertAuthorityId(ownerToken, 'authority owner token')
  return ownerToken
}

export function parseTerminalAuthorityOwnerToken(
  ownerToken: string | null
): TerminalAuthorityOwnerProof | null {
  if (!ownerToken?.startsWith(OWNER_TOKEN_PREFIX)) {
    return null
  }
  let value: unknown
  try {
    assertAuthorityId(ownerToken, 'authority owner token')
    value = JSON.parse(
      Buffer.from(ownerToken.slice(OWNER_TOKEN_PREFIX.length), 'base64url').toString('utf8')
    ) as unknown
  } catch {
    return null
  }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.process)) {
    return null
  }
  try {
    assertAuthorityId(value.ownerNonce, 'authority owner nonce')
    assertAuthorityId(value.ownerIncarnationId, 'ownerIncarnationId')
  } catch {
    return null
  }
  const processIdentity = normalizeTerminalAuthorityOwnerProcessIdentity(value.process)
  if (!processIdentity) {
    return null
  }
  return Object.freeze({
    ownerIncarnationId: value.ownerIncarnationId,
    process: processIdentity
  })
}

export function assertTerminalAuthorityOwnerProcessIdentity(
  value: unknown
): asserts value is TerminalAuthorityOwnerProcessIdentity {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) <= 0 ||
    !isOwnerProcessPlatform(value.platform)
  ) {
    throw new Error('authority owner process identity is invalid')
  }
  if (
    value.startedAtMs !== undefined &&
    (typeof value.startedAtMs !== 'number' ||
      !Number.isFinite(value.startedAtMs) ||
      value.startedAtMs <= 0)
  ) {
    throw new Error('authority owner process start identity is invalid')
  }
  const hasLinuxStartTicks = value.linuxStartTicks !== undefined
  const hasBootId = value.bootId !== undefined
  const hasLinuxPidNamespace = value.linuxPidNamespace !== undefined
  if (hasLinuxStartTicks !== hasBootId) {
    throw new Error('authority owner process identity is incomplete')
  }
  if (hasLinuxPidNamespace && !hasLinuxStartTicks) {
    throw new Error('authority owner process namespace identity is incomplete')
  }
  if (hasLinuxStartTicks) {
    assertAuthorityId(value.linuxStartTicks, 'linuxStartTicks')
    assertAuthorityId(value.bootId, 'bootId')
  }
  if (hasLinuxPidNamespace) {
    assertAuthorityId(value.linuxPidNamespace, 'linuxPidNamespace')
  }
  if (value.executionScope !== undefined) {
    assertAuthorityId(value.executionScope, 'executionScope')
  }
}

function normalizeTerminalAuthorityOwnerProcessIdentity(
  value: Record<string, unknown>
): TerminalAuthorityOwnerProcessIdentity | null {
  const normalized = Object.freeze({
    ...value,
    platform: value.platform ?? 'legacy'
  })
  try {
    assertTerminalAuthorityOwnerProcessIdentity(normalized)
    return normalized
  } catch {
    return null
  }
}

function isOwnerProcessPlatform(
  value: unknown
): value is TerminalAuthorityOwnerProcessIdentity['platform'] {
  return (
    typeof value === 'string' &&
    [
      'aix',
      'android',
      'darwin',
      'freebsd',
      'haiku',
      'legacy',
      'linux',
      'openbsd',
      'sunos',
      'win32',
      'cygwin',
      'netbsd'
    ].includes(value)
  )
}
