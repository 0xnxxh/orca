import { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespaceAdmissionProof } from '../../shared/terminal-session-authority-consumer-proof'
import { terminalAuthorityAdmissionCas } from './terminal-session-authority-consumer-proof'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from './terminal-session-authority-consumer-admission-request'
import type {
  TerminalAuthorityAdmissionChallengeEntry,
  TerminalAuthorityAdmissionReplayEntry,
  TerminalAuthorityAdmissionReservation,
  TerminalAuthorityNamespaceAdmissionPreparation,
  TerminalSessionAuthorityConsumerAdmissionState
} from './terminal-session-authority-consumer-admission-state'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'

type PreparationInput = Readonly<{
  state: TerminalSessionAuthorityConsumerAdmissionState
  service: TerminalSessionAuthorityService
  entry: TerminalAuthorityAdmissionChallengeEntry
  proof: TerminalAuthorityNamespaceAdmissionProof
  transport: TerminalAuthorityAuthenticatedConsumerTransport
  requestKey: string
  proofDigest: string
  namespaceKey: string
  reservation: TerminalAuthorityAdmissionReservation
}>

/**
 * The verified admission's seal: it holds the namespace reservation, and only its `commit` publishes
 * the live grant and the exact-retry result, so nothing is observable until the durable claim lands.
 */
export function terminalAuthorityAdmissionPreparation(
  input: PreparationInput
): TerminalAuthorityNamespaceAdmissionPreparation {
  const { state, service, entry, proof, transport, requestKey, namespaceKey, reservation } = input
  const claim = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    consumer: Object.freeze({
      consumerId: entry.consumerId,
      consumerIncarnationId: proof.challenge.candidateProcessIncarnationId
    }),
    expectedConsumerIncarnationId: entry.expectedIncarnationId
  })
  const grant = Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    consumer: claim.consumer,
    namespace: Object.freeze({ ...proof.challenge.namespace }),
    requestId: proof.challenge.requestId,
    connectionGrantId: proof.challenge.connectionGrantId,
    admissionCas: terminalAuthorityAdmissionCas(
      proof.challenge.namespace,
      entry.consumerId,
      proof.challenge.candidateProcessIncarnationId
    ),
    replayed: false
  })
  const liveGrant = Object.freeze({
    connectionGrantId: transport.connectionGrantId,
    requestId: proof.challenge.requestId,
    processIncarnationId: claim.consumer.consumerIncarnationId,
    sessionNonce: proof.challenge.candidateSessionNonce,
    transportToken: transport.token,
    requestKey
  })
  const replayEntry = Object.freeze({
    challenge: entry.challenge,
    startDigest: entry.startDigest,
    proofDigest: input.proofDigest,
    claim,
    grant,
    transportToken: transport.token
  })
  let phase: 'prepared' | 'sealed' | 'committed' | 'released' = 'prepared'
  const release = (): void => {
    if (phase === 'committed' || phase === 'released') {
      return
    }
    phase = 'released'
    state.releaseReservation(namespaceKey, reservation)
  }
  return Object.freeze({
    claim,
    grant,
    get published() {
      return phase === 'committed'
    },
    admissionSeal: Object.freeze({
      // Publishes nothing, so an exact retry racing the pending append still sees no grant.
      seal: () => {
        if (phase !== 'prepared') {
          throw new Error('terminal authority namespace admission preparation is stale')
        }
        state.assertReservation(namespaceKey, reservation)
        if (
          service.activeConsumerIncarnation(service.writerAccess, entry.consumerId) !==
          entry.expectedIncarnationId
        ) {
          throw new Error('terminal authority namespace admission CAS changed')
        }
        phase = 'sealed'
      },
      commit: () => {
        if (phase === 'committed') {
          return
        }
        phase = 'committed'
        state.releaseReservation(namespaceKey, reservation)
        state.installLiveGrant(namespaceKey, liveGrant)
        state.rememberReplay(requestKey, replayEntry)
        state.deleteChallenge(requestKey)
      },
      // The challenge survives: the claim provably never landed, so an exact retry re-presents it.
      abort: release
    }),
    rollback: release
  })
}

// Inert: the original commit already published the grant and retry result.
export function replayTerminalAuthorityAdmissionPreparation(
  entry: TerminalAuthorityAdmissionReplayEntry
): TerminalAuthorityNamespaceAdmissionPreparation {
  return Object.freeze({
    claim: entry.claim,
    grant: Object.freeze({ ...entry.grant, replayed: true }),
    published: true,
    admissionSeal: Object.freeze({ seal: () => {}, commit: () => {}, abort: () => {} }),
    rollback: () => {}
  })
}
