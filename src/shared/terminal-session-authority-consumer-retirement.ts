import {
  assertAuthorityId,
  assertAuthorityNamespace,
  isRecord,
  type TerminalAuthorityNamespace
} from './terminal-session-authority-identity'

export const TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION = 1 as const
export const TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM =
  'x25519-hkdf-sha256-hmac-sha256-retirement-v1' as const
export const TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CAPABILITY =
  'terminal-session.authority-consumer-retirement.v1' as const

export type TerminalAuthorityConsumerRetirementStart = Readonly<{
  version: typeof TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
  algorithm: typeof TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM
  namespace: TerminalAuthorityNamespace
  appPublicKeyB64: string
  candidateProcessIncarnationId: string
  candidateSessionNonce: string
  requestId: string
}>

export type TerminalAuthorityConsumerRetirementLiveAdmission = Readonly<{
  requestId: string
  processIncarnationId: string
  sessionNonce: string
}>

export type TerminalAuthorityConsumerRetirementChallenge =
  TerminalAuthorityConsumerRetirementStart &
    Readonly<{
      consumerId: string
      currentConsumerIncarnationId: string | null
      retirementCas: string
      connectionGrantId: string
      liveAdmission: TerminalAuthorityConsumerRetirementLiveAdmission | null
      authenticatedTransportPrincipal: string
      authenticatedTransportCapability: string
      hostEphemeralPublicKeyB64: string
      expiresAtMs: number
    }>

export type TerminalAuthorityConsumerRetirementProof = Readonly<{
  version: typeof TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
  challenge: TerminalAuthorityConsumerRetirementChallenge
  proofMacB64: string
}>

export type TerminalAuthorityConsumerRetirementResult = Readonly<{
  version: typeof TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
  namespace: TerminalAuthorityNamespace
  consumerId: string
  retiredConsumerIncarnationId: string | null
  requestId: string
  candidateProcessIncarnationId: string
  candidateSessionNonce: string
  connectionGrantId: string
  retirementCas: string
  retired: true
  alreadyAbsent: boolean
  replayed: boolean
}>

export function parseTerminalAuthorityConsumerRetirementStart(
  value: unknown
): TerminalAuthorityConsumerRetirementStart | null {
  if (
    !isRetirementRecord(value) ||
    value.algorithm !== TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM
  ) {
    return null
  }
  try {
    assertAuthorityNamespace(value.namespace)
    assertEncodedBytes(value.appPublicKeyB64, 'appPublicKeyB64', 32)
    assertAuthorityId(value.candidateProcessIncarnationId, 'candidateProcessIncarnationId')
    assertAuthorityId(value.candidateSessionNonce, 'candidateSessionNonce')
    assertAuthorityId(value.requestId, 'requestId')
  } catch {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_ALGORITHM,
    namespace: Object.freeze({ ...value.namespace }),
    appPublicKeyB64: value.appPublicKeyB64,
    candidateProcessIncarnationId: value.candidateProcessIncarnationId,
    candidateSessionNonce: value.candidateSessionNonce,
    requestId: value.requestId
  })
}

export function parseTerminalAuthorityConsumerRetirementChallenge(
  value: unknown
): TerminalAuthorityConsumerRetirementChallenge | null {
  const start = parseTerminalAuthorityConsumerRetirementStart(value)
  if (!start || !isRecord(value)) {
    return null
  }
  try {
    assertAuthorityId(value.consumerId, 'consumerId')
    if (value.currentConsumerIncarnationId !== null) {
      assertAuthorityId(value.currentConsumerIncarnationId, 'currentConsumerIncarnationId')
    }
    assertAuthorityId(value.retirementCas, 'retirementCas')
    assertAuthorityId(value.connectionGrantId, 'connectionGrantId')
    assertAuthorityId(value.authenticatedTransportPrincipal, 'authenticatedTransportPrincipal')
    assertAuthorityId(value.authenticatedTransportCapability, 'authenticatedTransportCapability')
    assertEncodedBytes(value.hostEphemeralPublicKeyB64, 'hostEphemeralPublicKeyB64', 32)
  } catch {
    return null
  }
  const liveAdmission = parseLiveAdmission(value.liveAdmission)
  if (
    (value.liveAdmission !== null && !liveAdmission) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    Number(value.expiresAtMs) < 1
  ) {
    return null
  }
  return Object.freeze({
    ...start,
    consumerId: value.consumerId,
    currentConsumerIncarnationId: value.currentConsumerIncarnationId,
    retirementCas: value.retirementCas,
    connectionGrantId: value.connectionGrantId,
    liveAdmission,
    authenticatedTransportPrincipal: value.authenticatedTransportPrincipal,
    authenticatedTransportCapability: value.authenticatedTransportCapability,
    hostEphemeralPublicKeyB64: value.hostEphemeralPublicKeyB64,
    expiresAtMs: Number(value.expiresAtMs)
  })
}

export function parseTerminalAuthorityConsumerRetirementProof(
  value: unknown
): TerminalAuthorityConsumerRetirementProof | null {
  if (!isRetirementRecord(value)) {
    return null
  }
  const challenge = parseTerminalAuthorityConsumerRetirementChallenge(value.challenge)
  try {
    assertEncodedBytes(value.proofMacB64, 'proofMacB64', 32)
  } catch {
    return null
  }
  return challenge
    ? Object.freeze({
        version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
        challenge,
        proofMacB64: value.proofMacB64
      })
    : null
}

export function parseTerminalAuthorityConsumerRetirementResult(
  value: unknown
): TerminalAuthorityConsumerRetirementResult | null {
  if (!isRetirementRecord(value)) {
    return null
  }
  try {
    assertAuthorityNamespace(value.namespace)
    assertAuthorityId(value.consumerId, 'consumerId')
    if (value.retiredConsumerIncarnationId !== null) {
      assertAuthorityId(value.retiredConsumerIncarnationId, 'retiredConsumerIncarnationId')
    }
    assertAuthorityId(value.requestId, 'requestId')
    assertAuthorityId(value.candidateProcessIncarnationId, 'candidateProcessIncarnationId')
    assertAuthorityId(value.candidateSessionNonce, 'candidateSessionNonce')
    assertAuthorityId(value.connectionGrantId, 'connectionGrantId')
    assertAuthorityId(value.retirementCas, 'retirementCas')
  } catch {
    return null
  }
  if (
    value.retired !== true ||
    typeof value.alreadyAbsent !== 'boolean' ||
    typeof value.replayed !== 'boolean' ||
    value.alreadyAbsent !== (value.retiredConsumerIncarnationId === null)
  ) {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    namespace: Object.freeze({ ...value.namespace }),
    consumerId: value.consumerId,
    retiredConsumerIncarnationId: value.retiredConsumerIncarnationId,
    requestId: value.requestId,
    candidateProcessIncarnationId: value.candidateProcessIncarnationId,
    candidateSessionNonce: value.candidateSessionNonce,
    connectionGrantId: value.connectionGrantId,
    retirementCas: value.retirementCas,
    retired: true,
    alreadyAbsent: value.alreadyAbsent,
    replayed: value.replayed
  })
}

export function encodeTerminalAuthorityConsumerRetirementTranscript(
  challenge: TerminalAuthorityConsumerRetirementChallenge
): Uint8Array {
  const live = challenge.liveAdmission
  const fields: readonly (readonly [string, string])[] = [
    ['protocol', TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CAPABILITY],
    ['version', String(challenge.version)],
    ['algorithm', challenge.algorithm],
    ['authenticatedTransportPrincipal', challenge.authenticatedTransportPrincipal],
    ['authenticatedTransportCapability', challenge.authenticatedTransportCapability],
    ['authorityHostId', challenge.namespace.authorityHostId],
    ['namespaceId', challenge.namespace.namespaceId],
    ['consumerId', challenge.consumerId],
    ['currentConsumerIncarnationId', challenge.currentConsumerIncarnationId ?? ''],
    ['retirementCas', challenge.retirementCas],
    ['candidateProcessIncarnationId', challenge.candidateProcessIncarnationId],
    ['candidateSessionNonce', challenge.candidateSessionNonce],
    ['requestId', challenge.requestId],
    ['connectionGrantId', challenge.connectionGrantId],
    ['liveAdmissionRequestId', live?.requestId ?? ''],
    ['liveAdmissionProcessIncarnationId', live?.processIncarnationId ?? ''],
    ['liveAdmissionSessionNonce', live?.sessionNonce ?? ''],
    ['hostEphemeralPublicKeyB64', challenge.hostEphemeralPublicKeyB64],
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

function parseLiveAdmission(
  value: unknown
): TerminalAuthorityConsumerRetirementLiveAdmission | null {
  if (!isRecord(value)) {
    return null
  }
  try {
    assertAuthorityId(value.requestId, 'live admission requestId')
    assertAuthorityId(value.processIncarnationId, 'live admission processIncarnationId')
    assertAuthorityId(value.sessionNonce, 'live admission sessionNonce')
  } catch {
    return null
  }
  return Object.freeze({
    requestId: value.requestId,
    processIncarnationId: value.processIncarnationId,
    sessionNonce: value.sessionNonce
  })
}

function isRetirementRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.version === TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
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
