import { assertAuthorityId, isRecord } from './terminal-session-authority-identity'

export const TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION = 1 as const

export type TerminalAuthorityPolicyConsumerIdentity = Readonly<{
  consumerId: string
  consumerIncarnationId: string
}>

export type TerminalAuthorityPolicyConsumerClaim = Readonly<{
  version: typeof TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
  consumer: TerminalAuthorityPolicyConsumerIdentity
  expectedConsumerIncarnationId: string | null
}>

export function parseTerminalAuthorityPolicyConsumerClaim(
  value: unknown
): TerminalAuthorityPolicyConsumerClaim | null {
  if (!isVersionedRecord(value)) {
    return null
  }
  const consumer = parseTerminalAuthorityPolicyConsumerIdentity(value.consumer)
  if (
    !consumer ||
    (value.expectedConsumerIncarnationId !== null &&
      value.expectedConsumerIncarnationId !== undefined &&
      !isAuthorityId(value.expectedConsumerIncarnationId, 'expectedConsumerIncarnationId'))
  ) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION,
    consumer,
    expectedConsumerIncarnationId: value.expectedConsumerIncarnationId ?? null
  })
}

export function parseTerminalAuthorityPolicyConsumerIdentity(
  value: unknown
): TerminalAuthorityPolicyConsumerIdentity | null {
  if (!isRecord(value)) {
    return null
  }
  try {
    assertAuthorityId(value.consumerId, 'consumerId')
    assertAuthorityId(value.consumerIncarnationId, 'consumerIncarnationId')
  } catch {
    return null
  }
  if (
    !value.consumerId.startsWith('app-profile:') &&
    !value.consumerId.startsWith('paired-device:')
  ) {
    return null
  }
  return Object.freeze({
    consumerId: value.consumerId,
    consumerIncarnationId: value.consumerIncarnationId
  })
}

export function sameTerminalAuthorityPolicyConsumer(
  left: TerminalAuthorityPolicyConsumerIdentity,
  right: TerminalAuthorityPolicyConsumerIdentity
): boolean {
  return (
    left.consumerId === right.consumerId &&
    left.consumerIncarnationId === right.consumerIncarnationId
  )
}

function isVersionedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.version === TERMINAL_AUTHORITY_NAMESPACE_OUTCOME_VERSION
}

export function isAuthorityId(value: unknown, name: string): value is string {
  try {
    assertAuthorityId(value, name)
    return true
  } catch {
    return false
  }
}
