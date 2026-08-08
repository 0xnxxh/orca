import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import nacl from 'tweetnacl'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  encodeTerminalAuthorityConsumerProofTranscript,
  type TerminalAuthorityNamespaceAdmissionChallenge,
  type TerminalAuthorityNamespaceAdmissionProof
} from '../../shared/terminal-session-authority-consumer-proof'
import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CAPABILITY,
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
  encodeTerminalAuthorityConsumerRetirementTranscript,
  type TerminalAuthorityConsumerRetirementChallenge,
  type TerminalAuthorityConsumerRetirementProof
} from '../../shared/terminal-session-authority-consumer-retirement'
import {
  assertAuthorityId,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'

const CONSUMER_ID_DOMAIN = 'orca:terminal-authority:app-consumer-id:v1\0'
const PAIRED_DEVICE_ID_DOMAIN = 'orca:terminal-authority:paired-device-id:v1\0'
const ADMISSION_CAS_DOMAIN = 'orca:terminal-authority:admission-cas:v1\0'
const RETIREMENT_CAS_DOMAIN = 'orca:terminal-authority:retirement-cas:v1\0'
const PROOF_KEY_DOMAIN = 'orca:terminal-authority:consumer-proof-key:v1\0'
const RETIREMENT_PROOF_KEY_DOMAIN = 'orca:terminal-authority:consumer-retirement-proof-key:v1\0'

export type TerminalAuthorityConsumerProofKeypair = Readonly<{
  publicKey: Uint8Array
  secretKey: Uint8Array
}>

export function terminalAuthorityHostAppConsumerId(
  authorityHostId: string,
  publicKey: Uint8Array
): string {
  assertAuthorityId(authorityHostId, 'authorityHostId')
  assertKey(publicKey, 'app public key')
  const fingerprint = createHash('sha256')
    .update(CONSUMER_ID_DOMAIN)
    .update(Buffer.from([TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION]))
    .update(lengthPrefixed(authorityHostId))
    .update(publicKey)
    .digest('base64url')
  return `app-profile:v1:${fingerprint}`
}

export function terminalAuthorityHostPairedDeviceConsumerId(
  authorityHostId: string,
  deviceId: string
): string {
  assertAuthorityId(authorityHostId, 'authorityHostId')
  const fingerprint = createHash('sha256')
    .update(PAIRED_DEVICE_ID_DOMAIN)
    .update(lengthPrefixed(authorityHostId))
    .update(deviceId, 'utf8')
    .digest('base64url')
  return `paired-device:v1:${fingerprint}`
}

export function terminalAuthorityAdmissionCas(
  namespace: TerminalAuthorityNamespace,
  consumerId: string,
  currentIncarnationId: string | null
): string {
  return createHash('sha256')
    .update(ADMISSION_CAS_DOMAIN)
    .update(lengthPrefixed(namespace.authorityHostId))
    .update(lengthPrefixed(namespace.namespaceId))
    .update(lengthPrefixed(consumerId))
    .update(lengthPrefixed(currentIncarnationId ?? ''))
    .digest('base64url')
}

export function terminalAuthorityRetirementCas(
  namespace: TerminalAuthorityNamespace,
  consumerId: string,
  currentIncarnationId: string | null
): string {
  return createHash('sha256')
    .update(RETIREMENT_CAS_DOMAIN)
    .update(lengthPrefixed(namespace.authorityHostId))
    .update(lengthPrefixed(namespace.namespaceId))
    .update(lengthPrefixed(consumerId))
    .update(lengthPrefixed(currentIncarnationId ?? ''))
    .digest('base64url')
}

export function createTerminalAuthorityConsumerProof(
  challenge: TerminalAuthorityNamespaceAdmissionChallenge,
  appKeypair: TerminalAuthorityConsumerProofKeypair
): TerminalAuthorityNamespaceAdmissionProof {
  assertKey(appKeypair.publicKey, 'app public key')
  assertKey(appKeypair.secretKey, 'app secret key')
  const claimedPublicKey = decodeKey(challenge.appPublicKeyB64, 'app public key')
  const derivedPublicKey = nacl.box.keyPair.fromSecretKey(appKeypair.secretKey).publicKey
  if (
    !timingSafeEqual(Buffer.from(appKeypair.publicKey), Buffer.from(claimedPublicKey)) ||
    !timingSafeEqual(Buffer.from(derivedPublicKey), Buffer.from(claimedPublicKey))
  ) {
    throw new Error('terminal authority consumer proof keypair does not match challenge')
  }
  const hostPublicKey = decodeKey(challenge.hostEphemeralPublicKeyB64, 'host ephemeral public key')
  const sharedSecret = terminalAuthorityConsumerProofSharedSecret(
    hostPublicKey,
    appKeypair.secretKey
  )
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    challenge,
    proofMacB64: proofMac(challenge, sharedSecret).toString('base64')
  })
}

export function createTerminalAuthorityConsumerRetirementProof(
  challenge: TerminalAuthorityConsumerRetirementChallenge,
  appKeypair: TerminalAuthorityConsumerProofKeypair
): TerminalAuthorityConsumerRetirementProof {
  assertKey(appKeypair.publicKey, 'app public key')
  assertKey(appKeypair.secretKey, 'app secret key')
  const claimedPublicKey = decodeKey(challenge.appPublicKeyB64, 'app public key')
  const derivedPublicKey = nacl.box.keyPair.fromSecretKey(appKeypair.secretKey).publicKey
  if (
    !timingSafeEqual(Buffer.from(appKeypair.publicKey), Buffer.from(claimedPublicKey)) ||
    !timingSafeEqual(Buffer.from(derivedPublicKey), Buffer.from(claimedPublicKey))
  ) {
    throw new Error('terminal authority consumer retirement keypair does not match challenge')
  }
  const hostPublicKey = decodeKey(challenge.hostEphemeralPublicKeyB64, 'host ephemeral public key')
  const sharedSecret = terminalAuthorityConsumerProofSharedSecret(
    hostPublicKey,
    appKeypair.secretKey
  )
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
    challenge,
    proofMacB64: retirementProofMac(challenge, sharedSecret).toString('base64')
  })
}

export function verifyTerminalAuthorityConsumerProof(
  proof: TerminalAuthorityNamespaceAdmissionProof,
  hostEphemeralSecretKey: Uint8Array
): boolean {
  assertKey(hostEphemeralSecretKey, 'host ephemeral secret key')
  const appPublicKey = decodeKey(proof.challenge.appPublicKeyB64, 'app public key')
  const supplied = decodeMac(proof.proofMacB64)
  const sharedSecret = terminalAuthorityConsumerProofSharedSecret(
    appPublicKey,
    hostEphemeralSecretKey
  )
  const expected = proofMac(proof.challenge, sharedSecret)
  return timingSafeEqual(supplied, expected)
}

export function verifyTerminalAuthorityConsumerRetirementProof(
  proof: TerminalAuthorityConsumerRetirementProof,
  hostEphemeralSecretKey: Uint8Array
): boolean {
  assertKey(hostEphemeralSecretKey, 'host ephemeral secret key')
  const appPublicKey = decodeKey(proof.challenge.appPublicKeyB64, 'app public key')
  const supplied = decodeMac(proof.proofMacB64)
  const sharedSecret = terminalAuthorityConsumerProofSharedSecret(
    appPublicKey,
    hostEphemeralSecretKey
  )
  const expected = retirementProofMac(proof.challenge, sharedSecret)
  return timingSafeEqual(supplied, expected)
}

export function createTerminalAuthorityProofEphemeralKeypair(): TerminalAuthorityConsumerProofKeypair {
  const keypair = nacl.box.keyPair()
  return Object.freeze({ publicKey: keypair.publicKey, secretKey: keypair.secretKey })
}

export function assertTerminalAuthorityConsumerProofPeerKey(
  peerPublicKey: Uint8Array,
  ourSecretKey: Uint8Array
): void {
  assertKey(peerPublicKey, 'peer public key')
  assertKey(ourSecretKey, 'local secret key')
  const rawSharedPoint = nacl.scalarMult(ourSecretKey, peerPublicKey)
  const allZero = Buffer.alloc(rawSharedPoint.length)
  if (timingSafeEqual(Buffer.from(rawSharedPoint), allZero)) {
    throw new Error('terminal authority consumer proof peer key is low order')
  }
}

function terminalAuthorityConsumerProofSharedSecret(
  peerPublicKey: Uint8Array,
  ourSecretKey: Uint8Array
): Uint8Array {
  assertTerminalAuthorityConsumerProofPeerKey(peerPublicKey, ourSecretKey)
  return nacl.box.before(peerPublicKey, ourSecretKey)
}

function proofMac(
  challenge: TerminalAuthorityNamespaceAdmissionChallenge,
  sharedSecret: Uint8Array
): Buffer {
  const salt = createHash('sha256').update(PROOF_KEY_DOMAIN).digest()
  const info = Buffer.from(`${TERMINAL_AUTHORITY_CONSUMER_PROOF_CAPABILITY}:hmac`, 'utf8')
  const key = Buffer.from(hkdfSync('sha256', sharedSecret, salt, info, 32))
  return createHmac('sha256', key)
    .update(encodeTerminalAuthorityConsumerProofTranscript(challenge))
    .digest()
}

function retirementProofMac(
  challenge: TerminalAuthorityConsumerRetirementChallenge,
  sharedSecret: Uint8Array
): Buffer {
  const salt = createHash('sha256').update(RETIREMENT_PROOF_KEY_DOMAIN).digest()
  const info = Buffer.from(`${TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_CAPABILITY}:hmac`, 'utf8')
  const key = Buffer.from(hkdfSync('sha256', sharedSecret, salt, info, 32))
  return createHmac('sha256', key)
    .update(encodeTerminalAuthorityConsumerRetirementTranscript(challenge))
    .digest()
}

function decodeKey(value: string, field: string): Uint8Array {
  const decoded = Uint8Array.from(Buffer.from(value, 'base64'))
  assertKey(decoded, field)
  return decoded
}

function decodeMac(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new Error('terminal authority consumer proof MAC is invalid')
  }
  return decoded
}

function assertKey(value: Uint8Array, field: string): void {
  if (value.length !== 32) {
    throw new Error(`${field} is invalid`)
  }
}

function lengthPrefixed(value: string): Buffer {
  const encoded = Buffer.from(value, 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(encoded.length)
  return Buffer.concat([length, encoded])
}
