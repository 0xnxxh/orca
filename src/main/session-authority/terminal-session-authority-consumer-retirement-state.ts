import type {
  TerminalAuthorityConsumerRetirementChallenge,
  TerminalAuthorityConsumerRetirementResult
} from '../../shared/terminal-session-authority-consumer-retirement'

const MAX_CHALLENGES = 1_024
const MAX_CHALLENGES_PER_SCOPE = 64
const MAX_REPLAY_RESULTS = 1_024

export type TerminalAuthorityRetirementChallengeEntry = Readonly<{
  challenge: TerminalAuthorityConsumerRetirementChallenge
  startDigest: string
  secretKey: Uint8Array
  transportToken: object
  scopeKey: string
}>

export type TerminalAuthorityRetirementReplayEntry = Readonly<{
  challenge: TerminalAuthorityConsumerRetirementChallenge
  startDigest: string
  proofDigest: string
  result: TerminalAuthorityConsumerRetirementResult
  transportToken: object
}>

export type TerminalAuthorityRetirementReplayReservation = {
  transportToken: object
  released: boolean
}

export class TerminalSessionAuthorityConsumerRetirementState {
  private readonly challenges = new Map<string, TerminalAuthorityRetirementChallengeEntry>()
  private readonly replayResults = new Map<string, TerminalAuthorityRetirementReplayEntry>()
  private readonly completions = new Map<
    string,
    Promise<TerminalAuthorityConsumerRetirementResult>
  >()
  private readonly replayReservations = new Map<
    string,
    TerminalAuthorityRetirementReplayReservation
  >()

  pruneExpired(now: number): void {
    for (const [key, entry] of this.challenges) {
      if (entry.challenge.expiresAtMs <= now) {
        this.challenges.delete(key)
      }
    }
  }

  challenge(key: string): TerminalAuthorityRetirementChallengeEntry | undefined {
    return this.challenges.get(key)
  }

  rememberChallenge(key: string, entry: TerminalAuthorityRetirementChallengeEntry): void {
    if (this.occupiedReplaySlots() >= MAX_REPLAY_RESULTS) {
      throw new Error('terminal authority consumer retirement retry capacity exceeded')
    }
    if (this.challenges.size >= MAX_CHALLENGES) {
      throw new Error('terminal authority consumer retirement challenge capacity exceeded')
    }
    let scoped = 0
    for (const challenge of this.challenges.values()) {
      if (challenge.scopeKey === entry.scopeKey) {
        scoped += 1
      }
    }
    if (scoped >= MAX_CHALLENGES_PER_SCOPE) {
      throw new Error('terminal authority consumer retirement challenge scope capacity exceeded')
    }
    this.challenges.set(key, entry)
  }

  deleteChallenge(key: string): void {
    this.challenges.delete(key)
  }

  replay(key: string): TerminalAuthorityRetirementReplayEntry | undefined {
    return this.replayResults.get(key)
  }

  rememberReplay(key: string, entry: TerminalAuthorityRetirementReplayEntry): void {
    this.replayResults.set(key, entry)
    this.challenges.delete(key)
  }

  reserveReplay(key: string, transportToken: object): TerminalAuthorityRetirementReplayReservation {
    if (this.replayReservations.has(key)) {
      throw new Error('terminal authority consumer retirement replay is already pending')
    }
    if (!this.challenges.has(key) && this.occupiedReplaySlots() >= MAX_REPLAY_RESULTS) {
      throw new Error('terminal authority consumer retirement retry capacity exceeded')
    }
    const reservation = { transportToken, released: false }
    this.replayReservations.set(key, reservation)
    return reservation
  }

  commitReplay(
    key: string,
    reservation: TerminalAuthorityRetirementReplayReservation,
    entry: TerminalAuthorityRetirementReplayEntry
  ): boolean {
    if (this.replayReservations.get(key) !== reservation) {
      throw new Error('terminal authority consumer retirement replay reservation is stale')
    }
    if (reservation.released) {
      return false
    }
    this.rememberReplay(key, entry)
    return true
  }

  releaseReplayReservation(
    key: string,
    reservation: TerminalAuthorityRetirementReplayReservation
  ): void {
    if (this.replayReservations.get(key) === reservation) {
      this.replayReservations.delete(key)
    }
  }

  completion(key: string): Promise<TerminalAuthorityConsumerRetirementResult> | undefined {
    return this.completions.get(key)
  }

  startCompletion(
    key: string,
    completion: Promise<TerminalAuthorityConsumerRetirementResult>
  ): void {
    this.completions.set(key, completion)
  }

  finishCompletion(
    key: string,
    completion: Promise<TerminalAuthorityConsumerRetirementResult>
  ): void {
    if (this.completions.get(key) === completion) {
      this.completions.delete(key)
    }
  }

  releaseTransport(transportToken: object): void {
    removeByToken(this.challenges, transportToken)
    removeByToken(this.replayResults, transportToken)
    for (const reservation of this.replayReservations.values()) {
      if (reservation.transportToken === transportToken) {
        reservation.released = true
      }
    }
  }

  private occupiedReplaySlots(): number {
    return new Set([
      ...this.challenges.keys(),
      ...this.replayResults.keys(),
      ...this.replayReservations.keys()
    ]).size
  }
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
