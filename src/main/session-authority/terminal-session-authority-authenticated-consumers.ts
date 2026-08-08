import {
  parseTerminalAuthorityNamespaceAdmissionProof,
  parseTerminalAuthorityNamespaceAdmissionStart,
  type TerminalAuthorityNamespaceAdmissionChallenge
} from '../../shared/terminal-session-authority-consumer-proof'
import {
  parseTerminalAuthorityConsumerRetirementProof,
  parseTerminalAuthorityConsumerRetirementStart,
  type TerminalAuthorityConsumerRetirementChallenge,
  type TerminalAuthorityConsumerRetirementResult
} from '../../shared/terminal-session-authority-consumer-retirement'
import {
  TerminalSessionAuthorityConsumerAdmissions as ConsumerAdmissions,
  type TerminalAuthorityAuthenticatedConsumerTransport,
  type TerminalSessionAuthorityConsumerAdmissions
} from './terminal-session-authority-consumer-admission'
import type { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import type {
  TerminalAuthorityPolicyConsumerConnection,
  TerminalAuthorityPolicyOutcomeTransport,
  TerminalSessionAuthorityPolicyConsumers
} from './terminal-session-authority-policy-consumers'
import { terminalAuthorityHostAppConsumerId } from './terminal-session-authority-consumer-proof'
import {
  terminalAuthorityAuthenticatedNamespacePreparation,
  type TerminalAuthorityAuthenticatedNamespacePreparation
} from './terminal-session-authority-authenticated-namespace-preparation'
import { TerminalSessionAuthorityConsumerRetirements } from './terminal-session-authority-consumer-retirement'
import { joinTerminalAuthorityRollbackFailure } from './terminal-session-authority-consumer-rollback-failure'
import {
  TerminalSessionAuthorityAuthenticatedSessions,
  type TerminalAuthorityAuthenticatedNamespaceSession
} from './terminal-session-authority-authenticated-sessions'

export type { TerminalAuthorityAuthenticatedNamespaceSession } from './terminal-session-authority-authenticated-sessions'

export type { TerminalAuthorityAuthenticatedNamespacePreparation } from './terminal-session-authority-authenticated-namespace-preparation'

export class TerminalSessionAuthorityAuthenticatedConsumers {
  private admissions: TerminalSessionAuthorityConsumerAdmissions | null = null
  private retirements: TerminalSessionAuthorityConsumerRetirements | null = null
  private authorityHostId: string | null = null
  private readonly sessions = new TerminalSessionAuthorityAuthenticatedSessions()
  private readonly pendingPreparations = new Map<
    object,
    Set<TerminalAuthorityAuthenticatedNamespacePreparation>
  >()

  constructor(
    private readonly registry: TerminalSessionAuthorityRegistry,
    private readonly policyConsumers: TerminalSessionAuthorityPolicyConsumers,
    private readonly onRollbackFailure: (error: unknown) => void = reportRollbackFailure
  ) {}

  async issueChallenge(
    unsafeStart: unknown,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityNamespaceAdmissionChallenge> {
    const start = parseTerminalAuthorityNamespaceAdmissionStart(unsafeStart)
    if (!start) {
      throw new Error('terminal authority namespace admission start is invalid')
    }
    const service = await this.registry.openNamespace(start.namespace)
    return this.admissionsFor(start.namespace.authorityHostId).issueChallenge(
      service,
      start,
      transport
    )
  }

  async openNamespace(
    unsafeProof: unknown,
    authenticatedTransport: TerminalAuthorityAuthenticatedConsumerTransport,
    outcomeTransport: TerminalAuthorityPolicyOutcomeTransport
  ): Promise<TerminalAuthorityAuthenticatedNamespaceSession> {
    const preparation = await this.prepareNamespace(
      unsafeProof,
      authenticatedTransport,
      outcomeTransport
    )
    return await preparation.commit()
  }

  async issueRetirementChallenge(
    unsafeStart: unknown,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityConsumerRetirementChallenge> {
    const start = parseTerminalAuthorityConsumerRetirementStart(unsafeStart)
    if (!start) {
      throw new Error('terminal authority consumer retirement start is invalid')
    }
    const service = await this.registry.openNamespace(start.namespace)
    const admissions = this.admissionsFor(start.namespace.authorityHostId)
    const consumerId = terminalAuthorityHostAppConsumerId(
      start.namespace.authorityHostId,
      Uint8Array.from(Buffer.from(start.appPublicKeyB64, 'base64'))
    )
    return this.retirementsFor(start.namespace.authorityHostId).issueChallenge(
      service,
      start,
      transport,
      admissions.liveGrant(transport.token, consumerId, start.namespace)
    )
  }

  async retireConsumer(
    unsafeProof: unknown,
    transport: TerminalAuthorityAuthenticatedConsumerTransport
  ): Promise<TerminalAuthorityConsumerRetirementResult> {
    const proof = parseTerminalAuthorityConsumerRetirementProof(unsafeProof)
    if (!proof) {
      throw new Error('terminal authority consumer retirement proof is invalid')
    }
    const service = await this.registry.openNamespace(proof.challenge.namespace)
    const admissions = this.admissionsFor(proof.challenge.namespace.authorityHostId)
    const liveGrant = admissions.liveGrant(
      transport.token,
      proof.challenge.consumerId,
      proof.challenge.namespace
    )
    const result = await this.retirementsFor(proof.challenge.namespace.authorityHostId).complete(
      service,
      proof,
      transport,
      liveGrant
    )
    this.sessions.findByConsumer(transport.token, result.consumerId, result.namespace)?.disconnect()
    return result
  }

  async prepareNamespace(
    unsafeProof: unknown,
    authenticatedTransport: TerminalAuthorityAuthenticatedConsumerTransport,
    outcomeTransport: TerminalAuthorityPolicyOutcomeTransport
  ): Promise<TerminalAuthorityAuthenticatedNamespacePreparation> {
    const proof = parseTerminalAuthorityNamespaceAdmissionProof(unsafeProof)
    if (!proof) {
      throw new Error('terminal authority namespace admission proof is invalid')
    }
    const service = await this.registry.openNamespace(proof.challenge.namespace)
    const admissions = this.admissionsFor(proof.challenge.namespace.authorityHostId)
    const prepared = admissions.prepare(service, proof, authenticatedTransport)
    const replayed = prepared.grant.replayed
      ? this.sessions.find(authenticatedTransport.token, prepared.grant)
      : null
    if (replayed) {
      return Object.freeze({
        grant: prepared.grant,
        policyConsumer: replayed.policyConsumer,
        commit: async () => replayed,
        rollback: async () => {}
      })
    }
    let policyConsumer: TerminalAuthorityPolicyConsumerConnection | null = null
    try {
      policyConsumer = await this.policyConsumers.connect(prepared.claim, outcomeTransport)
      await policyConsumer.activate()
      if (!policyConsumer.prepareNamespace) {
        throw new Error('terminal authority policy consumer staging is unavailable')
      }
      const policyPreparation = await policyConsumer.prepareNamespace(
        service,
        prepared.admissionSeal
      )
      const preparation = terminalAuthorityAuthenticatedNamespacePreparation({
        prepared,
        policyPreparation,
        policyConsumer,
        transport: authenticatedTransport,
        liveGrant: () =>
          admissions.liveGrant(
            authenticatedTransport.token,
            prepared.grant.consumer.consumerId,
            prepared.grant.namespace
          ),
        releaseNamespace: () =>
          admissions.releaseNamespace(
            authenticatedTransport.token,
            prepared.grant.consumer.consumerId,
            prepared.grant.namespace
          ),
        remember: (release) =>
          this.sessions.remember(authenticatedTransport, prepared.grant, policyConsumer!, release),
        settled: () => this.untrackPending(authenticatedTransport.token, preparation)
      })
      this.trackPending(authenticatedTransport.token, preparation)
      return preparation
    } catch (error) {
      return await joinTerminalAuthorityRollbackFailure(error, async () => {
        try {
          policyConsumer?.disconnect()
        } finally {
          prepared.rollback()
        }
      })
    }
  }

  releaseTransport(transportToken: object): void {
    const pending = this.pendingPreparations.get(transportToken)
    this.pendingPreparations.delete(transportToken)
    for (const preparation of pending ?? []) {
      const cause = new Error(
        'terminal authority authenticated consumer transport released during admission'
      )
      void joinTerminalAuthorityRollbackFailure(cause, () => preparation.rollback()).catch(
        (failure) => {
          if (failure !== cause) {
            this.onRollbackFailure(failure)
          }
        }
      )
    }
    this.sessions.releaseTransport(transportToken)
    this.admissions?.releaseTransport(transportToken)
    this.retirements?.releaseTransport(transportToken)
  }

  dispose(): void {
    const tokens = new Set([...this.sessions.transportTokens(), ...this.pendingPreparations.keys()])
    for (const token of tokens) {
      this.releaseTransport(token)
    }
  }

  private trackPending(
    transportToken: object,
    preparation: TerminalAuthorityAuthenticatedNamespacePreparation
  ): void {
    const pending = this.pendingPreparations.get(transportToken) ?? new Set()
    pending.add(preparation)
    this.pendingPreparations.set(transportToken, pending)
  }

  private untrackPending(
    transportToken: object,
    preparation: TerminalAuthorityAuthenticatedNamespacePreparation
  ): void {
    const pending = this.pendingPreparations.get(transportToken)
    if (!pending) {
      return
    }
    pending.delete(preparation)
    if (pending.size === 0) {
      this.pendingPreparations.delete(transportToken)
    }
  }

  private admissionsFor(authorityHostId: string): TerminalSessionAuthorityConsumerAdmissions {
    if (this.authorityHostId !== null && this.authorityHostId !== authorityHostId) {
      throw new Error('terminal authority authenticated consumer host changed')
    }
    if (!this.admissions) {
      this.authorityHostId = authorityHostId
      this.admissions = new ConsumerAdmissions(authorityHostId)
    }
    return this.admissions
  }

  private retirementsFor(authorityHostId: string): TerminalSessionAuthorityConsumerRetirements {
    this.admissionsFor(authorityHostId)
    this.retirements ??= new TerminalSessionAuthorityConsumerRetirements(authorityHostId)
    return this.retirements
  }
}

function reportRollbackFailure(error: unknown): void {
  console.error('terminal authority authenticated consumer rollback failed', error)
}
