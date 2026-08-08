import {
  assertAuthorityId,
  assertAuthorityNamespace,
  isRecord,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'
import {
  parseTerminalAuthorityPolicyConsumerIdentity,
  type TerminalAuthorityPolicyConsumerIdentity
} from './terminal-session-authority-consumer-transport'

export const TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION = 1 as const
export const TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM =
  'x25519-hkdf-sha256-hmac-sha256-v1' as const
export const TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY =
  'terminal-session.authority-consumer-proof.v1' as const

export type TerminalAuthorityNamespaceAdmissionIntent = 'first' | 'resume' | 'explicit-handover'

export type TerminalAuthorityNamespaceAdmissionStart = Readonly<{
  version: typeof TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION
  algorithm: typeof TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM
  namespace: TerminalAuthorityNamespace
  appPublicKeyB64: string
  candidateProcessIncarnationId: string
  candidateSessionNonce: string
  requestId: string
  intent: TerminalAuthorityNamespaceAdmissionIntent
}>

export type TerminalAuthorityNamespaceAdmissionChallenge =
  TerminalAuthorityNamespaceAdmissionStart &
    Readonly<{
      currentAdmissionCas: string
      connectionGrantId: string
      authenticatedTransportPrincipal: string
      authenticatedTransportCapability: string
      hostEphemeralPublicKeyB64: string
      expiresAtMs: number
    }>

export type TerminalAuthorityNamespaceAdmissionProof = Readonly<{
  version: typeof TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION
  challenge: TerminalAuthorityNamespaceAdmissionChallenge
  proofMacB64: string
}>

export type TerminalAuthorityNamespaceAdmissionGrant = Readonly<{
  version: typeof TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION
  consumer: TerminalAuthorityPolicyConsumerIdentity
  namespace: TerminalAuthorityNamespace
  requestId: string
  connectionGrantId: string
  admissionCas: string
  replayed: boolean
}>

export type TerminalAuthorityNamespaceAdmissionCancellation = Readonly<{
  version: typeof TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION
  consumer: TerminalAuthorityPolicyConsumerIdentity
  namespace: TerminalAuthorityNamespace
  requestId: string
  connectionGrantId: string
}>

export function parseTerminalAuthorityNamespaceAdmissionStart(
  value: unknown
): TerminalAuthorityNamespaceAdmissionStart | null {
  if (!isRecord(value) || !hasProofVersion(value)) {
    return null
  }
  try {
    assertAuthorityNamespace(value.namespace)
    assertEncodedKey(value.appPublicKeyB64, 'appPublicKeyB64')
    assertAuthorityId(value.candidateProcessIncarnationId, 'candidateProcessIncarnationId')
    assertAuthorityId(value.candidateSessionNonce, 'candidateSessionNonce')
    assertAuthorityId(value.requestId, 'requestId')
  } catch {
    return null
  }
  if (!isAdmissionIntent(value.intent)) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    namespace: Object.freeze({ ...value.namespace }),
    appPublicKeyB64: value.appPublicKeyB64,
    candidateProcessIncarnationId: value.candidateProcessIncarnationId,
    candidateSessionNonce: value.candidateSessionNonce,
    requestId: value.requestId,
    intent: value.intent
  })
}

export function parseTerminalAuthorityNamespaceAdmissionChallenge(
  value: unknown
): TerminalAuthorityNamespaceAdmissionChallenge | null {
  const start = parseTerminalAuthorityNamespaceAdmissionStart(value)
  if (!start || !isRecord(value)) {
    return null
  }
  try {
    assertAuthorityId(value.currentAdmissionCas, 'currentAdmissionCas')
    assertAuthorityId(value.connectionGrantId, 'connectionGrantId')
    assertAuthorityId(value.authenticatedTransportPrincipal, 'authenticatedTransportPrincipal')
    assertAuthorityId(value.authenticatedTransportCapability, 'authenticatedTransportCapability')
    assertEncodedKey(value.hostEphemeralPublicKeyB64, 'hostEphemeralPublicKeyB64')
  } catch {
    return null
  }
  if (!Number.isSafeInteger(value.expiresAtMs) || Number(value.expiresAtMs) < 1) {
    return null
  }
  return Object.freeze({
    ...start,
    currentAdmissionCas: value.currentAdmissionCas,
    connectionGrantId: value.connectionGrantId,
    authenticatedTransportPrincipal: value.authenticatedTransportPrincipal,
    authenticatedTransportCapability: value.authenticatedTransportCapability,
    hostEphemeralPublicKeyB64: value.hostEphemeralPublicKeyB64,
    expiresAtMs: Number(value.expiresAtMs)
  })
}

export function parseTerminalAuthorityNamespaceAdmissionProof(
  value: unknown
): TerminalAuthorityNamespaceAdmissionProof | null {
  if (!isRecord(value) || value.version !== TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION) {
    return null
  }
  const challenge = parseTerminalAuthorityNamespaceAdmissionChallenge(value.challenge)
  try {
    assertEncodedMac(value.proofMacB64)
  } catch {
    return null
  }
  return challenge
    ? Object.freeze({
        version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
        challenge,
        proofMacB64: value.proofMacB64
      })
    : null
}

export function parseTerminalAuthorityNamespaceAdmissionGrant(
  value: unknown
): TerminalAuthorityNamespaceAdmissionGrant | null {
  if (!isRecord(value) || value.version !== TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION) {
    return null
  }
  const consumer = parseTerminalAuthorityPolicyConsumerIdentity(value.consumer)
  try {
    assertAuthorityNamespace(value.namespace)
    assertAuthorityId(value.requestId, 'requestId')
    assertAuthorityId(value.connectionGrantId, 'connectionGrantId')
    assertAuthorityId(value.admissionCas, 'admissionCas')
  } catch {
    return null
  }
  if (!consumer || typeof value.replayed !== 'boolean') {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    consumer,
    namespace: Object.freeze({ ...value.namespace }),
    requestId: value.requestId,
    connectionGrantId: value.connectionGrantId,
    admissionCas: value.admissionCas,
    replayed: value.replayed
  })
}

export function parseTerminalAuthorityNamespaceAdmissionCancellation(
  value: unknown
): TerminalAuthorityNamespaceAdmissionCancellation | null {
  if (!isRecord(value) || value.version !== TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION) {
    return null
  }
  const consumer = parseTerminalAuthorityPolicyConsumerIdentity(value.consumer)
  try {
    assertAuthorityNamespace(value.namespace)
    assertAuthorityId(value.requestId, 'requestId')
    assertAuthorityId(value.connectionGrantId, 'connectionGrantId')
  } catch {
    return null
  }
  return consumer
    ? Object.freeze({
        version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
        consumer,
        namespace: Object.freeze({ ...value.namespace }),
        requestId: value.requestId,
        connectionGrantId: value.connectionGrantId
      })
    : null
}

export function encodeTerminalAuthorityConsumerProofTranscript(
  challenge: TerminalAuthorityNamespaceAdmissionChallenge
): Uint8Array {
  const fields: readonly (readonly [string, string])[] = [
    ['protocol', TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY],
    ['version', String(challenge.version)],
    ['algorithm', challenge.algorithm],
    ['authenticatedTransportPrincipal', challenge.authenticatedTransportPrincipal],
    ['authenticatedTransportCapability', challenge.authenticatedTransportCapability],
    ['authorityHostId', challenge.namespace.authorityHostId],
    ['namespaceId', challenge.namespace.namespaceId],
    ['currentAdmissionCas', challenge.currentAdmissionCas],
    ['candidateProcessIncarnationId', challenge.candidateProcessIncarnationId],
    ['candidateSessionNonce', challenge.candidateSessionNonce],
    ['requestId', challenge.requestId],
    ['connectionGrantId', challenge.connectionGrantId],
    ['hostEphemeralPublicKeyB64', challenge.hostEphemeralPublicKeyB64],
    ['intent', challenge.intent],
    ['appPublicKeyB64', challenge.appPublicKeyB64],
    ['expiresAtMs', String(challenge.expiresAtMs)]
  ]
  const encoder = new TextEncoder()
  return encoder.encode(
    fields
      .map(
        ([name, fieldValue]) =>
          `${encoder.encode(name).byteLength}:${name}${encoder.encode(fieldValue).byteLength}:${fieldValue}`
      )
      .join('')
  )
}

function hasProofVersion(value: Record<string, unknown>): boolean {
  return (
    value.version === TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION &&
    value.algorithm === TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM
  )
}

function isAdmissionIntent(value: unknown): value is TerminalAuthorityNamespaceAdmissionIntent {
  return value === 'first' || value === 'resume' || value === 'explicit-handover'
}

function assertEncodedKey(value: unknown, field: string): asserts value is string {
  assertEncodedBytes(value, field, 32)
}

function assertEncodedMac(value: unknown): asserts value is string {
  assertEncodedBytes(value, 'proofMacB64', 32)
}

function assertEncodedBytes(value: unknown, field: string, bytes: number): asserts value is string {
  if (typeof value !== 'string' || value.length !== 44 || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== bytes || decoded.toString('base64') !== value) {
    throw new Error(`${field} is invalid`)
  }
}
