import type {
  TerminalAuthorityNamespaceAdmissionChallenge,
  TerminalAuthorityNamespaceAdmissionGrant
} from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityPolicyConsumerClaim } from '../../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityConsumerAdmissionSeal } from './terminal-session-authority-consumer-admission-seal'

const MAX_PENDING_CHALLENGES = 1_024
const MAX_PENDING_CHALLENGES_PER_SCOPE = 64
const MAX_REPLAY_RESULTS = 1_024

export type TerminalAuthorityAdmissionChallengeEntry = Readonly<{
  challenge: TerminalAuthorityNamespaceAdmissionChallenge
  startDigest: string
  secretKey: Uint8Array
  transportToken: object
  consumerId: string
  expectedIncarnationId: string | null
  scopeKey: string
}>

export type TerminalAuthorityAdmissionReplayEntry = Readonly<{
  challenge: TerminalAuthorityNamespaceAdmissionChallenge
  startDigest: string
  proofDigest: string
  claim: TerminalAuthorityPolicyConsumerClaim
  grant: TerminalAuthorityNamespaceAdmissionGrant
  transportToken: object
}>

export type TerminalAuthorityAdmissionReservation = Readonly<{ transportToken: object }>

export type TerminalAuthorityAdmissionLiveGrant = Readonly<{
  connectionGrantId: string
  requestId: string
  processIncarnationId: string
  sessionNonce: string
  transportToken: object
  requestKey: string
}>

export type TerminalAuthorityNamespaceAdmissionPreparation = Readonly<{
  claim: TerminalAuthorityPolicyConsumerClaim
  grant: TerminalAuthorityNamespaceAdmissionGrant
  /** Seal, publish, and release, run inside the service's serialized durable-claim operation. */
  admissionSeal: TerminalAuthorityConsumerAdmissionSeal
  /** True once the live grant and exact-retry publication are externally visible. */
  readonly published: boolean
  rollback(): void
}>

export class TerminalSessionAuthorityConsumerAdmissionState {
  private readonly challenges = new Map<string, TerminalAuthorityAdmissionChallengeEntry>()
  private readonly replayResults = new Map<string, TerminalAuthorityAdmissionReplayEntry>()
  private readonly reservations = new Map<string, TerminalAuthorityAdmissionReservation>()
  private readonly liveGrants = new Map<string, TerminalAuthorityAdmissionLiveGrant>()

  pruneExpired(now: number): void {
    for (const [key, entry] of this.challenges) {
      if (entry.challenge.expiresAtMs <= now) {
        this.challenges.delete(key)
      }
    }
  }

  challenge(key: string): TerminalAuthorityAdmissionChallengeEntry | undefined {
    return this.challenges.get(key)
  }

  rememberChallenge(key: string, entry: TerminalAuthorityAdmissionChallengeEntry): void {
    if (this.challenges.size >= MAX_PENDING_CHALLENGES) {
      throw new Error('terminal authority namespace admission challenge capacity exceeded')
    }
    if (this.pendingChallengesForScope(entry.scopeKey) >= MAX_PENDING_CHALLENGES_PER_SCOPE) {
      throw new Error('terminal authority namespace admission challenge scope capacity exceeded')
    }
    this.challenges.set(key, entry)
  }

  deleteChallenge(key: string): void {
    this.challenges.delete(key)
  }

  replay(key: string): TerminalAuthorityAdmissionReplayEntry | undefined {
    return this.replayResults.get(key)
  }

  rememberReplay(key: string, entry: TerminalAuthorityAdmissionReplayEntry): void {
    this.replayResults.set(key, entry)
  }

  reserve(key: string, transportToken: object): TerminalAuthorityAdmissionReservation {
    if (this.reservations.has(key)) {
      throw new Error('terminal authority namespace admission is already pending')
    }
    if (
      !this.liveGrants.has(key) &&
      this.replayResults.size + this.reservations.size >= MAX_REPLAY_RESULTS
    ) {
      throw new Error('terminal authority namespace admission retry capacity exceeded')
    }
    const reservation = Object.freeze({ transportToken })
    this.reservations.set(key, reservation)
    return reservation
  }

  assertReservation(key: string, reservation: TerminalAuthorityAdmissionReservation): void {
    if (this.reservations.get(key) !== reservation) {
      throw new Error('terminal authority namespace admission reservation is stale')
    }
  }

  releaseReservation(key: string, reservation: TerminalAuthorityAdmissionReservation): boolean {
    if (this.reservations.get(key) === reservation) {
      this.reservations.delete(key)
      return true
    }
    return false
  }

  liveGrant(key: string): TerminalAuthorityAdmissionLiveGrant | undefined {
    return this.liveGrants.get(key)
  }

  installLiveGrant(key: string, grant: TerminalAuthorityAdmissionLiveGrant): void {
    const previous = this.liveGrants.get(key)
    if (previous) {
      this.replayResults.delete(previous.requestKey)
    }
    this.liveGrants.set(key, grant)
  }

  releaseTransport(transportToken: object): void {
    removeByToken(this.liveGrants, transportToken)
    removeByToken(this.challenges, transportToken)
    removeByToken(this.replayResults, transportToken)
    removeByToken(this.reservations, transportToken)
  }

  releaseNamespace(
    transportToken: object,
    consumerId: string,
    namespace: TerminalAuthorityNamespace
  ): void {
    const key = consumerNamespaceKey(consumerId, namespace)
    const live = this.liveGrants.get(key)
    if (live?.transportToken === transportToken) {
      this.liveGrants.delete(key)
      this.replayResults.delete(live.requestKey)
    }
  }

  private pendingChallengesForScope(scopeKey: string): number {
    let count = 0
    for (const challenge of this.challenges.values()) {
      if (challenge.scopeKey === scopeKey) {
        count += 1
      }
    }
    return count
  }
}

export function terminalAuthorityConsumerNamespaceAdmissionKey(
  consumerId: string,
  namespace: TerminalAuthorityNamespace
): string {
  return consumerNamespaceKey(consumerId, namespace)
}

function consumerNamespaceKey(consumerId: string, namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([consumerId, namespace.authorityHostId, namespace.namespaceId])
}

function removeByToken<T extends Readonly<{ transportToken: object }>>(
  values: Map<string, T>,
  token: object
): void {
  for (const [key, value] of values) {
    if (value.transportToken === token) {
      values.delete(key)
    }
  }
}
