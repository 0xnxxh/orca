import { isDeepStrictEqual } from 'node:util'
import {
  parseTerminalAuthorityNamespaceAdmissionProof,
  parseTerminalAuthorityNamespaceAdmissionStart,
  type TerminalAuthorityNamespaceAdmissionChallenge
} from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import {
  assertTerminalAuthorityConsumerProofPeerKey,
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityAdmissionCas,
  terminalAuthorityHostAppConsumerId,
  verifyTerminalAuthorityConsumerProof
} from './terminal-session-authority-consumer-proof'
export { terminalAuthorityAdmissionPreparation } from './terminal-session-authority-consumer-admission-preparation'
import {
  TerminalSessionAuthorityConsumerAdmissionState,
  terminalAuthorityConsumerNamespaceAdmissionKey,
  type TerminalAuthorityAdmissionLiveGrant,
  type TerminalAuthorityNamespaceAdmissionPreparation
} from './terminal-session-authority-consumer-admission-state'
import {
  replayTerminalAuthorityAdmissionPreparation as replayPreparation,
  terminalAuthorityAdmissionPreparation
} from './terminal-session-authority-consumer-admission-preparation'
import {
  assertExactTerminalAuthorityAdmissionRequest,
  assertTerminalAuthorityAdmissionServiceNamespace,
  assertTerminalAuthorityAdmissionTransportToken,
  assertTerminalAuthorityConsumerTransport,
  assertTerminalAuthorityHostId,
  terminalAuthorityAdmissionChallengeScopeKey,
  terminalAuthorityAdmissionDigest,
  terminalAuthorityAdmissionRequestKey,
  type TerminalAuthorityAuthenticatedConsumerTransport
} from './terminal-session-authority-consumer-admission-request'

export type { TerminalAuthorityAuthenticatedConsumerTransport } from './terminal-session-authority-consumer-admission-request'
export type { TerminalAuthorityNamespaceAdmissionPreparation } from './terminal-session-authority-consumer-admission-state'

const CHALLENGE_LIFETIME_MS = 30_000

export class TerminalSessionAuthorityConsumerAdmissions {
  private readonly state = new TerminalSessionAuthorityConsumerAdmissionState()

  constructor(
    private readonly authorityHostId: string,
    private readonly now: () => number = Date.now
  ) {
    assertTerminalAuthorityHostId(authorityHostId)
  }

  issueChallenge(
    service: TerminalSessionAuthorityService,
    unsafeStart: unknown,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): TerminalAuthorityNamespaceAdmissionChallenge {
    assertTerminalAuthorityConsumerTransport(transport)
    this.state.pruneExpired(this.now())
    const start = parseTerminalAuthorityNamespaceAdmissionStart(unsafeStart)
    if (!start || start.namespace.authorityHostId !== this.authorityHostId) {
      throw new Error('terminal authority namespace admission start is invalid')
    }
    assertTerminalAuthorityAdmissionServiceNamespace(service, start.namespace)
    const requestKey = terminalAuthorityAdmissionRequestKey(
      start.namespace,
      start.requestId,
      transport
    )
    const startDigest = terminalAuthorityAdmissionDigest(start)
    const replay = this.state.replay(requestKey)
    if (replay) {
      assertExactTerminalAuthorityAdmissionRequest(replay.startDigest, startDigest)
      assertTerminalAuthorityAdmissionTransportToken(replay.transportToken, transport)
      return replay.challenge
    }
    const existing = this.state.challenge(requestKey)
    if (existing) {
      assertExactTerminalAuthorityAdmissionRequest(existing.startDigest, startDigest)
      assertTerminalAuthorityAdmissionTransportToken(existing.transportToken, transport)
      return existing.challenge
    }
    const scopeKey = terminalAuthorityAdmissionChallengeScopeKey(transport)
    const appPublicKey = Uint8Array.from(Buffer.from(start.appPublicKeyB64, 'base64'))
    const consumerId = terminalAuthorityHostAppConsumerId(this.authorityHostId, appPublicKey)
    const expectedIncarnationId = service.activeConsumerIncarnation(
      service.writerAccess,
      consumerId
    )
    this.assertIntent(start, expectedIncarnationId, transport)
    const ephemeral = createTerminalAuthorityProofEphemeralKeypair()
    assertTerminalAuthorityConsumerProofPeerKey(appPublicKey, ephemeral.secretKey)
    const challenge = Object.freeze({
      ...start,
      currentAdmissionCas: terminalAuthorityAdmissionCas(
        start.namespace,
        consumerId,
        expectedIncarnationId
      ),
      connectionGrantId: transport.connectionGrantId,
      authenticatedTransportPrincipal: transport.principal,
      authenticatedTransportCapability: transport.capability,
      hostEphemeralPublicKeyB64: Buffer.from(ephemeral.publicKey).toString('base64'),
      expiresAtMs: this.now() + CHALLENGE_LIFETIME_MS
    })
    this.state.rememberChallenge(
      requestKey,
      Object.freeze({
        challenge,
        startDigest,
        secretKey: ephemeral.secretKey,
        transportToken: transport.token,
        consumerId,
        expectedIncarnationId,
        scopeKey
      })
    )
    return challenge
  }

  prepare(
    service: TerminalSessionAuthorityService,
    unsafeProof: unknown,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): TerminalAuthorityNamespaceAdmissionPreparation {
    assertTerminalAuthorityConsumerTransport(transport)
    this.state.pruneExpired(this.now())
    const proof = parseTerminalAuthorityNamespaceAdmissionProof(unsafeProof)
    if (!proof || proof.challenge.namespace.authorityHostId !== this.authorityHostId) {
      throw new Error('terminal authority namespace admission proof is invalid')
    }
    assertTerminalAuthorityAdmissionServiceNamespace(service, proof.challenge.namespace)
    const requestKey = terminalAuthorityAdmissionRequestKey(
      proof.challenge.namespace,
      proof.challenge.requestId,
      transport
    )
    const proofDigest = terminalAuthorityAdmissionDigest(proof)
    const replay = this.state.replay(requestKey)
    if (replay) {
      if (replay.proofDigest !== proofDigest) {
        throw new Error('terminal authority namespace admission retry changed')
      }
      assertTerminalAuthorityAdmissionTransportToken(replay.transportToken, transport)
      return replayPreparation(replay)
    }
    const entry = this.state.challenge(requestKey)
    if (!entry || !isDeepStrictEqual(entry.challenge, proof.challenge)) {
      throw new Error('terminal authority namespace admission challenge is stale')
    }
    assertTerminalAuthorityAdmissionTransportToken(entry.transportToken, transport)
    if (proof.challenge.expiresAtMs <= this.now()) {
      this.state.deleteChallenge(requestKey)
      throw new Error('terminal authority namespace admission challenge expired')
    }
    if (!verifyTerminalAuthorityConsumerProof(proof, entry.secretKey)) {
      throw new Error('terminal authority namespace admission proof was rejected')
    }
    const currentIncarnationId = service.activeConsumerIncarnation(
      service.writerAccess,
      entry.consumerId
    )
    if (
      currentIncarnationId !== entry.expectedIncarnationId ||
      terminalAuthorityAdmissionCas(
        proof.challenge.namespace,
        entry.consumerId,
        currentIncarnationId
      ) !== proof.challenge.currentAdmissionCas
    ) {
      throw new Error('terminal authority namespace admission CAS changed')
    }
    const namespaceKey = terminalAuthorityConsumerNamespaceAdmissionKey(
      entry.consumerId,
      proof.challenge.namespace
    )
    const reservation = this.state.reserve(namespaceKey, transport.token)
    return terminalAuthorityAdmissionPreparation({
      state: this.state,
      service,
      entry,
      proof,
      transport,
      requestKey,
      proofDigest,
      namespaceKey,
      reservation
    })
  }

  releaseTransport(transportToken: object): void {
    this.state.releaseTransport(transportToken)
  }

  releaseNamespace(
    transportToken: object,
    consumerId: string,
    namespace: TerminalAuthorityNamespace
  ): void {
    this.state.releaseNamespace(transportToken, consumerId, namespace)
  }

  liveGrant(
    transportToken: object,
    consumerId: string,
    namespace: TerminalAuthorityNamespace
  ): TerminalAuthorityAdmissionLiveGrant | null {
    const live = this.state.liveGrant(
      terminalAuthorityConsumerNamespaceAdmissionKey(consumerId, namespace)
    )
    return live?.transportToken === transportToken ? live : null
  }

  private assertIntent(
    start: NonNullable<ReturnType<typeof parseTerminalAuthorityNamespaceAdmissionStart>>,
    currentIncarnationId: string | null,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): void {
    const consumerId = terminalAuthorityHostAppConsumerId(
      this.authorityHostId,
      Uint8Array.from(Buffer.from(start.appPublicKeyB64, 'base64'))
    )
    const live = this.state.liveGrant(
      terminalAuthorityConsumerNamespaceAdmissionKey(consumerId, start.namespace)
    )
    const required = currentIncarnationId === null ? 'first' : live ? 'explicit-handover' : 'resume'
    if (start.intent !== required) {
      throw new Error(`terminal authority namespace admission requires ${required}`)
    }
    if (live?.transportToken === transport.token) {
      throw new Error('terminal authority namespace is already admitted on this connection')
    }
  }
}
