import type { PtySourceDeliveryIdentity } from '../shared/pty-source-credit-contract'
import type {
  LegacyPhysicalWorkerAttachRequest,
  LegacyPhysicalWorkerAttachResult,
  LegacyPhysicalWorkerPtyRouter
} from './legacy-physical-worker-attach-router'
import type {
  ImportedPhysicalWorkerPtySession,
  LegacyPhysicalWorkerAuthorityRouterOptions
} from './legacy-physical-worker-authority-session'
import {
  importedPhysicalWorkerBindingKey,
  importedPhysicalWorkerPublicRouteKey
} from './legacy-physical-worker-authority-session'
import { LegacyPhysicalWorkerEventRouter } from './legacy-physical-worker-event-router'
import type { LegacyPhysicalWorkerMutation } from './legacy-physical-worker-mutation'
import type {
  TerminalAuthorityOutcome,
  TerminalSessionAuthorityEffect
} from '../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityOutcomeDeliveryAttempt } from './terminal-session-authority-outcome-delivery'
import { admitLegacyPhysicalWorkerSession } from './legacy-physical-worker-session-admission'
import type { TerminalSessionAuthorityPtyAccess } from '../shared/terminal-session-authority-pty-access'
import { ensureLegacyPhysicalWorkerAckDrain } from './legacy-physical-worker-ack-drain'
import { LegacyPhysicalWorkerAuthorityMutations } from './legacy-physical-worker-authority-mutations'
import { resolveLegacyPhysicalWorkerSessionLimit } from './legacy-physical-worker-session-capacity'
import { LegacyPhysicalWorkerAuthoritySessionRegistry } from './legacy-physical-worker-authority-session-registry'
import { acceptLegacyPhysicalWorkerUpstreamExit } from './legacy-physical-worker-upstream-exit'

const DEFAULT_MAX_IMPORTED_PTY_SESSIONS = 256

export type { LegacyPhysicalWorkerAuthorityRouterOptions } from './legacy-physical-worker-authority-session'

export class LegacyPhysicalWorkerAuthorityRouter implements LegacyPhysicalWorkerPtyRouter {
  private readonly sessionsByBinding = new Map<string, ImportedPhysicalWorkerPtySession>()
  private readonly sessionsByPublicRoute = new Map<string, ImportedPhysicalWorkerPtySession>()
  private readonly eventRouter: LegacyPhysicalWorkerEventRouter
  private readonly sessionRegistry: LegacyPhysicalWorkerAuthoritySessionRegistry
  private readonly authorityMutations: LegacyPhysicalWorkerAuthorityMutations
  private readonly maxSessions: number
  private disposed = false

  constructor(private readonly options: LegacyPhysicalWorkerAuthorityRouterOptions) {
    this.maxSessions = resolveLegacyPhysicalWorkerSessionLimit(
      options.maxSessions,
      DEFAULT_MAX_IMPORTED_PTY_SESSIONS
    )
    this.eventRouter = new LegacyPhysicalWorkerEventRouter(
      (error) => this.reportWorkerFault(error),
      (session, exit) => this.acceptUpstreamExit(session, exit.code)
    )
    this.sessionRegistry = new LegacyPhysicalWorkerAuthoritySessionRegistry(
      this.sessionsByBinding,
      this.sessionsByPublicRoute,
      this.eventRouter
    )
    this.authorityMutations = new LegacyPhysicalWorkerAuthorityMutations(
      options.registry,
      () => this.disposed,
      (error) => this.reportWorkerFault(error)
    )
  }

  async attachReachablePty(
    request: LegacyPhysicalWorkerAttachRequest
  ): Promise<LegacyPhysicalWorkerAttachResult | null> {
    this.assertOpen()
    return await admitLegacyPhysicalWorkerSession(
      {
        sessionsByBinding: this.sessionsByBinding,
        sessionsByPublicRoute: this.sessionsByPublicRoute,
        eventRouter: this.eventRouter,
        maxSessions: this.maxSessions,
        options: this.options,
        reportFault: (error) => this.reportWorkerFault(error),
        retireSession: (session) => this.sessionRegistry.retireSession(session),
        onExitPublished: (session, exit) => {
          if (exit.authorityOutcome) {
            this.sessionRegistry.maybeRetire(session)
          } else {
            this.recordLegacyExit(session, exit.code)
          }
        }
      },
      request
    )
  }

  async dispatchMutation(
    id: string,
    incarnationId: string,
    mutation: LegacyPhysicalWorkerMutation
  ): Promise<boolean> {
    const routeKey = importedPhysicalWorkerPublicRouteKey(id, incarnationId)
    const session = this.sessionsByPublicRoute.get(routeKey)
    if (!session || session.retired || session.upstreamExited || !session.route.isCurrent()) {
      return false
    }
    const operation = session.mutationTail.then(async () => {
      if (
        this.sessionsByPublicRoute.get(routeKey) !== session ||
        session.retired ||
        session.upstreamExited ||
        !session.route.isCurrent()
      ) {
        return false
      }
      return await session.client.dispatchVerifiedMutation({ id, incarnationId }, mutation)
    })
    session.mutationTail = operation.then(
      () => undefined,
      () => undefined
    )
    return await operation
  }

  async dispatchAuthorityMutation(
    access: TerminalSessionAuthorityPtyAccess,
    mutation: Exclude<LegacyPhysicalWorkerMutation, { kind: 'shutdown' }>
  ): Promise<boolean> {
    return await this.authorityMutations.dispatch(access, mutation)
  }

  async dispatchAuthorityShutdown(
    access: TerminalSessionAuthorityPtyAccess,
    mutation: Extract<LegacyPhysicalWorkerMutation, { kind: 'shutdown' }>,
    persistClose: () => Promise<void>
  ): Promise<boolean> {
    return await this.authorityMutations.persistAndDispatchShutdown(access, mutation, persistClose)
  }

  async ensureAuthorityShutdown(
    access: TerminalSessionAuthorityPtyAccess,
    mutation: Extract<LegacyPhysicalWorkerMutation, { kind: 'shutdown' }>
  ): Promise<boolean> {
    return await this.authorityMutations.ensureShutdown(access, mutation)
  }

  setDeliveryPaused(identity: PtySourceDeliveryIdentity, paused: boolean): boolean {
    const session = this.sessionRegistry.downstreamSession(identity)
    if (!session) {
      return false
    }
    session.client.setDeliveryPaused({
      id: identity.id,
      clientGeneration: session.upstreamIdentity.clientGeneration,
      ownerGeneration: session.upstreamIdentity.ownerGeneration,
      deliveryToken: session.upstreamIdentity.deliveryToken,
      paused
    })
    return true
  }

  async setHeldProducerPause(
    id: string,
    incarnationId: string,
    token: string,
    paused: boolean
  ): Promise<boolean> {
    const session = this.sessionsByPublicRoute.get(
      importedPhysicalWorkerPublicRouteKey(id, incarnationId)
    )
    if (!session || session.retired || session.upstreamExited || !session.route.isCurrent()) {
      return false
    }
    return await session.client.setHeldProducerPause({
      id,
      clientGeneration: session.upstreamIdentity.clientGeneration,
      ownerGeneration: session.upstreamIdentity.ownerGeneration,
      ptyIncarnationId: incarnationId,
      heldPauseToken: token,
      paused
    })
  }

  handleDownstreamCredit(identity: PtySourceDeliveryIdentity): boolean {
    const session = this.sessionRegistry.downstreamSession(identity)
    if (!session) {
      return false
    }
    session.downstream.onCreditAvailable()
    const creditedEndSu = session.downstream.acknowledgedEndSu()
    session.requestedAckEndSu = Math.max(session.requestedAckEndSu, creditedEndSu)
    ensureLegacyPhysicalWorkerAckDrain(
      session,
      () => this.sessionRegistry.maybeRetire(session),
      (error) => this.reportWorkerFault(error)
    )
    return true
  }

  reservesPhysicalPtyId(id: string): boolean {
    return this.options.registry.reservesPhysicalPtyId(id)
  }

  reservesPublicPtyIdentity(id: string, incarnationId: string): boolean {
    return this.sessionsByPublicRoute.has(importedPhysicalWorkerPublicRouteKey(id, incarnationId))
  }

  publishAuthorityOutcome(
    outcome: TerminalAuthorityOutcome,
    effect: Extract<TerminalSessionAuthorityEffect, { kind: 'terminal-exited' }>,
    attempt: TerminalAuthorityOutcomeDeliveryAttempt
  ): boolean {
    const session = this.sessionsByBinding.get(importedPhysicalWorkerBindingKey(effect.binding))
    if (
      !session ||
      session.retired ||
      !session.route.isCurrent() ||
      !session.upstreamExited ||
      session.pendingExitCode === null ||
      effect.code !== session.pendingExitCode ||
      session.attachRequest.pane.paneKey !== outcome.result.pane.paneKey ||
      session.attachRequest.pane.paneGenerationId !== outcome.result.pane.paneGenerationId
    ) {
      return false
    }
    const accepted = session.proxy.acceptExit({
      id: effect.binding.physicalPtyId,
      incarnationId: effect.binding.ptyIncarnationId,
      code: session.pendingExitCode,
      authorityOutcome: attempt
    })
    if (accepted) {
      session.exitRecorded = true
    }
    return accepted
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.sessionRegistry.dispose()
  }

  private acceptUpstreamExit(session: ImportedPhysicalWorkerPtySession, code: number): void {
    acceptLegacyPhysicalWorkerUpstreamExit(session, code, this.options, () => this.disposed)
  }

  private recordLegacyExit(session: ImportedPhysicalWorkerPtySession, code: number): void {
    if (session.exitRecorded) {
      return
    }
    session.exitRecorded = true
    void this.options.onExitSettled?.(session.attachRequest, code).catch((error) => {
      this.reportWorkerFault(error instanceof Error ? error : new Error(String(error)))
    })
  }

  private reportWorkerFault(error: Error): void {
    this.options.onWorkerFault?.(error)
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error('legacy physical worker authority router is disposed')
    }
  }
}
