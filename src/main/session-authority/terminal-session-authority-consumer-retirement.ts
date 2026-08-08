import { isDeepStrictEqual } from 'node:util'
import {
  TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
  parseTerminalAuthorityConsumerRetirementProof,
  parseTerminalAuthorityConsumerRetirementStart,
  type TerminalAuthorityConsumerRetirementChallenge,
  type TerminalAuthorityConsumerRetirementResult
} from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
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
import type { TerminalAuthorityAdmissionLiveGrant } from './terminal-session-authority-consumer-admission-state'
import {
  assertTerminalAuthorityConsumerProofPeerKey,
  createTerminalAuthorityProofEphemeralKeypair,
  terminalAuthorityHostAppConsumerId,
  terminalAuthorityRetirementCas,
  verifyTerminalAuthorityConsumerRetirementProof
} from './terminal-session-authority-consumer-proof'
import {
  TerminalSessionAuthorityConsumerRetirementState,
  type TerminalAuthorityRetirementReplayEntry
} from './terminal-session-authority-consumer-retirement-state'

const CHALLENGE_LIFETIME_MS = 30_000

export class TerminalSessionAuthorityConsumerRetirements {
  private readonly state = new TerminalSessionAuthorityConsumerRetirementState()

  constructor(
    private readonly authorityHostId: string,
    private readonly now: () => number = Date.now
  ) {
    assertTerminalAuthorityHostId(authorityHostId)
  }

  issueChallenge(
    service: TerminalSessionAuthorityService,
    unsafeStart: unknown,
    transport: TerminalAuthorityAuthenticatedConsumerTransport,
    liveGrant: TerminalAuthorityAdmissionLiveGrant | null
  ): TerminalAuthorityConsumerRetirementChallenge {
    assertTerminalAuthorityConsumerTransport(transport)
    this.state.pruneExpired(this.now())
    const start = parseTerminalAuthorityConsumerRetirementStart(unsafeStart)
    if (!start || start.namespace.authorityHostId !== this.authorityHostId) {
      throw new Error('terminal authority consumer retirement start is invalid')
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
    const appPublicKey = Uint8Array.from(Buffer.from(start.appPublicKeyB64, 'base64'))
    const consumerId = terminalAuthorityHostAppConsumerId(this.authorityHostId, appPublicKey)
    const currentConsumerIncarnationId = service.activeConsumerIncarnation(
      service.writerAccess,
      consumerId
    )
    if (liveGrant && liveGrant.processIncarnationId !== currentConsumerIncarnationId) {
      throw new Error('terminal authority consumer retirement live admission is stale')
    }
    const ephemeral = createTerminalAuthorityProofEphemeralKeypair()
    assertTerminalAuthorityConsumerProofPeerKey(appPublicKey, ephemeral.secretKey)
    const challenge = Object.freeze({
      ...start,
      consumerId,
      currentConsumerIncarnationId,
      retirementCas: terminalAuthorityRetirementCas(
        start.namespace,
        consumerId,
        currentConsumerIncarnationId
      ),
      connectionGrantId: transport.connectionGrantId,
      liveAdmission: liveGrant
        ? Object.freeze({
            requestId: liveGrant.requestId,
            processIncarnationId: liveGrant.processIncarnationId,
            sessionNonce: liveGrant.sessionNonce
          })
        : null,
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
        scopeKey: terminalAuthorityAdmissionChallengeScopeKey(transport)
      })
    )
    return challenge
  }

  async complete(
    service: TerminalSessionAuthorityService,
    unsafeProof: unknown,
    transport: TerminalAuthorityAuthenticatedConsumerTransport,
    liveGrant: TerminalAuthorityAdmissionLiveGrant | null
  ): Promise<TerminalAuthorityConsumerRetirementResult> {
    assertTerminalAuthorityConsumerTransport(transport)
    this.state.pruneExpired(this.now())
    const proof = parseTerminalAuthorityConsumerRetirementProof(unsafeProof)
    if (!proof || proof.challenge.namespace.authorityHostId !== this.authorityHostId) {
      throw new Error('terminal authority consumer retirement proof is invalid')
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
      this.assertReplay(replay, proofDigest, transport)
      return Object.freeze({ ...replay.result, replayed: true })
    }
    const inFlight = this.state.completion(requestKey)
    if (inFlight) {
      const result = await inFlight
      const completed = this.state.replay(requestKey)
      if (!completed) {
        throw new Error('terminal authority consumer retirement retry is unavailable')
      }
      this.assertReplay(completed, proofDigest, transport)
      return Object.freeze({ ...result, replayed: true })
    }
    const completion = this.completeExact(
      service,
      proof,
      proofDigest,
      transport,
      liveGrant,
      requestKey
    )
    this.state.startCompletion(requestKey, completion)
    try {
      return await completion
    } finally {
      this.state.finishCompletion(requestKey, completion)
    }
  }

  releaseTransport(transportToken: object): void {
    this.state.releaseTransport(transportToken)
  }

  private async completeExact(
    service: TerminalSessionAuthorityService,
    proof: NonNullable<ReturnType<typeof parseTerminalAuthorityConsumerRetirementProof>>,
    proofDigest: string,
    transport: TerminalAuthorityAuthenticatedConsumerTransport,
    liveGrant: TerminalAuthorityAdmissionLiveGrant | null,
    requestKey: string
  ): Promise<TerminalAuthorityConsumerRetirementResult> {
    const entry = this.state.challenge(requestKey)
    if (!entry || !isDeepStrictEqual(entry.challenge, proof.challenge)) {
      throw new Error('terminal authority consumer retirement challenge is stale')
    }
    assertTerminalAuthorityAdmissionTransportToken(entry.transportToken, transport)
    if (proof.challenge.expiresAtMs <= this.now()) {
      this.state.deleteChallenge(requestKey)
      throw new Error('terminal authority consumer retirement challenge expired')
    }
    if (!verifyTerminalAuthorityConsumerRetirementProof(proof, entry.secretKey)) {
      throw new Error('terminal authority consumer retirement proof was rejected')
    }
    this.assertLiveAdmission(proof.challenge, liveGrant)
    const currentConsumerIncarnationId = service.activeConsumerIncarnation(
      service.writerAccess,
      proof.challenge.consumerId
    )
    if (
      currentConsumerIncarnationId !== proof.challenge.currentConsumerIncarnationId ||
      terminalAuthorityRetirementCas(
        proof.challenge.namespace,
        proof.challenge.consumerId,
        currentConsumerIncarnationId
      ) !== proof.challenge.retirementCas
    ) {
      throw new Error('terminal authority consumer retirement CAS changed')
    }
    const reservation = this.state.reserveReplay(requestKey, transport.token)
    try {
      await service.retireConsumerIdentity(
        service.writerAccess,
        proof.challenge.consumerId,
        currentConsumerIncarnationId
      )
      const result = Object.freeze({
        version: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION,
        namespace: Object.freeze({ ...proof.challenge.namespace }),
        consumerId: proof.challenge.consumerId,
        retiredConsumerIncarnationId: currentConsumerIncarnationId,
        requestId: proof.challenge.requestId,
        candidateProcessIncarnationId: proof.challenge.candidateProcessIncarnationId,
        candidateSessionNonce: proof.challenge.candidateSessionNonce,
        connectionGrantId: proof.challenge.connectionGrantId,
        retirementCas: proof.challenge.retirementCas,
        retired: true as const,
        alreadyAbsent: currentConsumerIncarnationId === null,
        replayed: false
      })
      this.state.commitReplay(
        requestKey,
        reservation,
        Object.freeze({
          challenge: entry.challenge,
          startDigest: entry.startDigest,
          proofDigest,
          result,
          transportToken: transport.token
        })
      )
      return result
    } finally {
      this.state.releaseReplayReservation(requestKey, reservation)
    }
  }

  private assertLiveAdmission(
    challenge: TerminalAuthorityConsumerRetirementChallenge,
    liveGrant: TerminalAuthorityAdmissionLiveGrant | null
  ): void {
    const expected = challenge.liveAdmission
    if (
      (!expected && liveGrant) ||
      (expected &&
        (!liveGrant ||
          expected.requestId !== liveGrant.requestId ||
          expected.processIncarnationId !== liveGrant.processIncarnationId ||
          expected.sessionNonce !== liveGrant.sessionNonce))
    ) {
      throw new Error('terminal authority consumer retirement live admission changed')
    }
  }

  private assertReplay(
    replay: TerminalAuthorityRetirementReplayEntry,
    proofDigest: string,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): void {
    if (replay.proofDigest !== proofDigest) {
      throw new Error('terminal authority consumer retirement retry changed')
    }
    assertTerminalAuthorityAdmissionTransportToken(replay.transportToken, transport)
  }
}
