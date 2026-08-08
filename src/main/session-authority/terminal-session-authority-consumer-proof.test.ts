import { describe, expect, it } from 'vitest'
import {
  TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
  TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
  parseTerminalAuthorityNamespaceAdmissionProof,
  parseTerminalAuthorityNamespaceAdmissionStart,
  type TerminalAuthorityNamespaceAdmissionChallenge
} from '../../shared/terminal-session-authority-consumer-proof'
import {
  createTerminalAuthorityConsumerProof,
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityHostAppConsumerId,
  terminalAuthorityHostPairedDeviceConsumerId,
  verifyTerminalAuthorityConsumerProof
} from './terminal-session-authority-consumer-proof'

const LOW_ORDER_KEYS = [
  ['all-zero', new Uint8Array(32)],
  ['order-two', Uint8Array.from([1, ...Array.from({ length: 31 }, () => 0)])]
] as const

describe('terminal authority consumer proof', () => {
  it.each(LOW_ORDER_KEYS)('rejects a %s host peer key before proof derivation', (_name, key) => {
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const challenge = admissionChallenge(app.publicKey, key)

    expect(() => createTerminalAuthorityConsumerProof(challenge, app)).toThrow('low order')
  })

  it.each(LOW_ORDER_KEYS)('rejects a %s app peer key before proof verification', (_name, key) => {
    const host = createTerminalAuthorityProofEphemeralKeypair()
    const challenge = admissionChallenge(key, host.publicKey)

    expect(() =>
      verifyTerminalAuthorityConsumerProof(
        { version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION, challenge, proofMacB64: mac() },
        host.secretKey
      )
    ).toThrow('low order')
  })

  it('rejects a proof verified with the wrong host secret', () => {
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const host = createTerminalAuthorityProofEphemeralKeypair()
    const otherHost = createTerminalAuthorityProofEphemeralKeypair()
    const proof = createTerminalAuthorityConsumerProof(
      admissionChallenge(app.publicKey, host.publicKey),
      app
    )

    expect(verifyTerminalAuthorityConsumerProof(proof, host.secretKey)).toBe(true)
    expect(verifyTerminalAuthorityConsumerProof(proof, otherHost.secretKey)).toBe(false)
  })

  it('rejects a wrong app secret and transcript tampering', () => {
    const app = createTerminalAuthorityProofEphemeralKeypair()
    const otherApp = createTerminalAuthorityProofEphemeralKeypair()
    const host = createTerminalAuthorityProofEphemeralKeypair()
    const challenge = admissionChallenge(app.publicKey, host.publicKey)

    expect(() => createTerminalAuthorityConsumerProof(challenge, otherApp)).toThrow(
      'does not match challenge'
    )
    const proof = createTerminalAuthorityConsumerProof(challenge, app)
    expect(
      verifyTerminalAuthorityConsumerProof(
        {
          ...proof,
          challenge: { ...proof.challenge, authenticatedTransportPrincipal: 'other-principal' }
        },
        host.secretKey
      )
    ).toBe(false)
  })

  it('derives stable versioned host-local consumers without profile labels or routes', () => {
    const first = createTerminalAuthorityProofEphemeralKeypair()
    const second = createTerminalAuthorityProofEphemeralKeypair()

    expect(terminalAuthorityHostAppConsumerId('host-a', first.publicKey)).toMatch(
      /^app-profile:v1:/
    )
    expect(terminalAuthorityHostAppConsumerId('host-a', first.publicKey)).toBe(
      terminalAuthorityHostAppConsumerId('host-a', first.publicKey)
    )
    expect(terminalAuthorityHostAppConsumerId('host-a', first.publicKey)).not.toBe(
      terminalAuthorityHostAppConsumerId('host-a', second.publicKey)
    )
    expect(terminalAuthorityHostAppConsumerId('host-a', first.publicKey)).not.toBe(
      terminalAuthorityHostAppConsumerId('host-b', first.publicKey)
    )
    expect(terminalAuthorityHostPairedDeviceConsumerId('host-a', 'device-a')).toMatch(
      /^paired-device:v1:/
    )
    expect(terminalAuthorityHostPairedDeviceConsumerId('host-a', 'device-a')).not.toBe(
      terminalAuthorityHostPairedDeviceConsumerId('host-a', 'device-b')
    )
    expect(terminalAuthorityHostPairedDeviceConsumerId('host-a', 'device-a')).not.toBe(
      terminalAuthorityHostPairedDeviceConsumerId('host-b', 'device-a')
    )
  })

  it('rejects non-canonical base64 keys and MACs', () => {
    const host = createTerminalAuthorityProofEphemeralKeypair()
    const challenge = admissionChallenge(new Uint8Array(32), host.publicKey)
    const nonCanonical = `${challenge.appPublicKeyB64.slice(0, 42)}B=`

    expect(Buffer.from(nonCanonical, 'base64')).toEqual(Buffer.alloc(32))
    expect(
      parseTerminalAuthorityNamespaceAdmissionStart({
        ...challenge,
        appPublicKeyB64: nonCanonical
      })
    ).toBeNull()
    expect(
      parseTerminalAuthorityNamespaceAdmissionProof({
        version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
        challenge,
        proofMacB64: nonCanonical
      })
    ).toBeNull()
  })
})

function admissionChallenge(
  appPublicKey: Uint8Array,
  hostPublicKey: Uint8Array
): TerminalAuthorityNamespaceAdmissionChallenge {
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    algorithm: TERMINAL_AUTHORITY_CONSUMER_PROOF_ALGORITHM,
    namespace: Object.freeze({ authorityHostId: 'host-a', namespaceId: 'namespace-a' }),
    appPublicKeyB64: Buffer.from(appPublicKey).toString('base64'),
    candidateProcessIncarnationId: 'app-process:one',
    candidateSessionNonce: 'session-nonce-one',
    requestId: 'request-one',
    intent: 'first',
    currentAdmissionCas: 'admission-cas-one',
    connectionGrantId: 'connection-grant-one',
    authenticatedTransportPrincipal: 'daemon-token:one',
    authenticatedTransportCapability: 'daemon-authority-consumer-proof:v1',
    hostEphemeralPublicKeyB64: Buffer.from(hostPublicKey).toString('base64'),
    expiresAtMs: 10_000
  })
}

function mac(): string {
  return Buffer.alloc(32).toString('base64')
}
