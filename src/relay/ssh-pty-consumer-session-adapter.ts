import {
  PTY_CONSUMER_SESSION_PROTOCOL_VERSION,
  PtyConsumerSession,
  type PtyConsumerSessionAdmission,
  type PtyConsumerSessionGrant
} from '../shared/pty-consumer-session'
import { DEFAULT_PTY_SOURCE_WINDOW_SU } from '../shared/pty-source-credit-contract'
import { PTY_EXACT_OPERATION_PROTOCOL_VERSION } from '../shared/pty-exact-operation-protocol'
import { TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION } from '../shared/terminal-authority-exact-operation-protocol'
import type {
  PtySourceDeliveryIdentity,
  PtySourceDeliverySnapshot,
  PtySourceSpan,
  PtySourceTransform
} from '../shared/pty-source-credit-contract'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import type { PtySourceSendReservation } from './pty-source-credit-ledger'
import type { SshPtyDeliveryMode } from './ssh-pty-data-publication-admission'
import { parseOpenClientParams, requireIdentity } from './ssh-pty-open-client-request'
import type { TerminalSessionAuthorityPtyLifecycle } from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import { SshTerminalAuthorityPolicyConsumers } from './ssh-terminal-authority-policy-consumers'
import type { TerminalAuthorityPolicyConsumerConnection } from '../main/session-authority/terminal-session-authority-policy-consumers'
import { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from '../shared/terminal-session-authority-consumer-proof'
import { TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION } from '../shared/terminal-session-authority-consumer-retirement'
import {
  SshPtyConsumerDeliveryState,
  type SshPtyDeliveryPauseHandler
} from './ssh-pty-consumer-delivery-state'

export const SSH_PTY_OPEN_CLIENT_METHOD = 'pty.openClient'

export class SshPtyConsumerSessionAdapter {
  private readonly session: PtyConsumerSession
  private readonly deliveryState: SshPtyConsumerDeliveryState
  private readonly outcomeDeliveryClientListeners = new Set<(clientId: number) => void>()
  private readonly policyConsumers: SshTerminalAuthorityPolicyConsumers | null

  constructor(
    private readonly dispatcher: RelayDispatcher,
    serverBuildId: string,
    setDeliveryPaused?: SshPtyDeliveryPauseHandler,
    onSourceCreditAvailable?: (id: string, identity?: PtySourceDeliveryIdentity) => void,
    options: {
      ownerScope?: 'global' | 'principal-client-instance'
      terminalAuthorityExactOperations?: boolean
      terminalAuthorityOutcomeDelivery?: boolean
      terminalAuthorityPolicyConsumers?: TerminalSessionAuthorityPtyLifecycle
      terminalAuthorityConsumerProofHostId?: string
    } = {}
  ) {
    this.policyConsumers = options.terminalAuthorityPolicyConsumers
      ? new SshTerminalAuthorityPolicyConsumers(
          dispatcher,
          options.terminalAuthorityPolicyConsumers
        )
      : null
    this.session = new PtyConsumerSession({
      serverBuildId,
      outputFlowControl: { versions: [1], maxWindowSu: DEFAULT_PTY_SOURCE_WINDOW_SU },
      exactOperations: { versions: [PTY_EXACT_OPERATION_PROTOCOL_VERSION] },
      heldProducerPause: { versions: [1] },
      ...(options.terminalAuthorityExactOperations
        ? {
            terminalAuthorityExactOperations: {
              versions: [TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION]
            }
          }
        : {}),
      ...(options.terminalAuthorityOutcomeDelivery === false
        ? {}
        : { terminalAuthorityOutcomeDelivery: { versions: [1] } }),
      ...(this.policyConsumers && options.terminalAuthorityConsumerProofHostId
        ? {
            terminalAuthorityConsumerProof: {
              versions: [TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION],
              retirementVersions: [TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION],
              authorityHostId: options.terminalAuthorityConsumerProofHostId
            }
          }
        : {}),
      ownerScope: options.ownerScope
    })
    this.deliveryState = new SshPtyConsumerDeliveryState(
      dispatcher,
      (clientId) => this.session.activeGrant(String(clientId)),
      setDeliveryPaused,
      onSourceCreditAvailable
    )
    dispatcher.onRequest(SSH_PTY_OPEN_CLIENT_METHOD, (params, context) =>
      this.openClient(params, context)
    )
    dispatcher.onClientDetached((clientId, cause) => {
      const connectionKey = String(clientId)
      const grant = this.session.activeGrant(connectionKey)
      this.session.close(connectionKey, cause)
      this.policyConsumers?.disconnect(clientId)
      if (grant) {
        this.deliveryState.detach(grant)
      }
    })
    dispatcher.onDisposed(() => {
      this.outcomeDeliveryClientListeners.clear()
      this.policyConsumers?.dispose()
    })
  }

  openDelivery(
    clientId: number,
    id: string,
    ptyIncarnation: string,
    checkpointSourceEndSu = 0
  ): PtySourceDeliveryIdentity | null {
    return this.deliveryState.open(clientId, id, ptyIncarnation, checkpointSourceEndSu)
  }

  rotateDelivery(
    oldIdentity: PtySourceDeliveryIdentity,
    newClientId: number,
    acceptedSourceEndSu: number
  ) {
    return this.deliveryState.rotate(oldIdentity, newClientId, acceptedSourceEndSu)
  }

  appendSource(
    identity: PtySourceDeliveryIdentity,
    input: Readonly<{
      spanId: string
      data: string
      displayStart: number
      displayEnd: number
      splittable: boolean
      transform: PtySourceTransform
    }>
  ): PtySourceSpan {
    return this.deliveryState.append(identity, input)
  }

  reserveSourceSend(
    identity: PtySourceDeliveryIdentity,
    maxSourceSu?: number
  ): PtySourceSendReservation | null {
    return this.deliveryState.reserveSend(identity, maxSourceSu)
  }

  commitSourceSend(reservation: PtySourceSendReservation): void {
    this.deliveryState.commitSend(reservation)
  }

  rollbackSourceSend(reservation: PtySourceSendReservation): void {
    this.deliveryState.rollbackSend(reservation)
  }

  sealDelivery(identity: PtySourceDeliveryIdentity): void {
    this.deliveryState.seal(identity)
  }

  settleExitPublication(
    identity: PtySourceDeliveryIdentity,
    result: { ok: true } | { ok: false; error: Error }
  ): void {
    this.deliveryState.settleExit(identity, result)
  }

  sourceDeliverySnapshot(identity: PtySourceDeliveryIdentity): PtySourceDeliverySnapshot {
    return this.deliveryState.snapshot(identity)
  }

  sourceDeliverySnapshotIfKnown(
    identity: PtySourceDeliveryIdentity
  ): PtySourceDeliverySnapshot | null {
    return this.deliveryState.snapshotIfKnown(identity)
  }

  cancelDelivery(identity: PtySourceDeliveryIdentity, reason: string): void {
    this.deliveryState.cancel(identity, reason)
  }

  getDebugSnapshot(): Readonly<{
    deliveryTokens: number
    graceTimers: number
    sourceSu: number
    dataBytes: number
    spans: number
  }> {
    return this.deliveryState.debugSnapshot()
  }

  deliveryMode(clientId: number): SshPtyDeliveryMode {
    return this.deliveryState.mode(clientId)
  }

  hasActiveClient(clientId: number): boolean {
    return this.session.activeGrant(String(clientId)) !== null
  }

  terminalAuthorityOutcomeDelivery(
    clientId: number
  ): Readonly<{ clientGeneration: number; ownerGeneration: number }> | null {
    const grant = this.session.activeGrant(String(clientId))
    return grant?.role === 'session-owner' &&
      grant.capabilities?.terminalAuthorityOutcomeDelivery?.version === 1 &&
      grant.ownerGeneration !== undefined
      ? Object.freeze({
          clientGeneration: grant.clientGeneration,
          ownerGeneration: grant.ownerGeneration
        })
      : null
  }

  terminalAuthorityExactOperations(clientId: number): boolean {
    return this.terminalAuthorityPolicyConsumer(clientId) !== null
  }

  terminalAuthorityPolicyConsumer(
    clientId: number
  ): TerminalAuthorityPolicyConsumerConnection | null {
    const grant = this.session.activeGrant(String(clientId))
    return grant?.role === 'session-owner' &&
      grant.capabilities?.terminalAuthorityExactOperations?.version ===
        TERMINAL_AUTHORITY_EXACT_OPERATIONS_VERSION &&
      this.policyConsumers?.isInstalled(clientId) === true
      ? (this.policyConsumers.connection(clientId) ?? null)
      : null
  }

  onTerminalAuthorityOutcomeDeliveryClient(listener: (clientId: number) => void): () => void {
    this.outcomeDeliveryClientListeners.add(listener)
    return () => this.outcomeDeliveryClientListeners.delete(listener)
  }

  private async openClient(
    rawParams: Record<string, unknown>,
    context: RequestContext
  ): Promise<PtyConsumerSessionGrant> {
    const params = parseOpenClientParams(rawParams)
    if (params.protocolVersion !== PTY_CONSUMER_SESSION_PROTOCOL_VERSION) {
      throw new Error(
        `Unsupported pty.openClient protocol version: ${params.protocolVersion || 'missing'}`
      )
    }
    const identity = requireIdentity(context)
    const admission = this.session.admit(params, {
      connectionId: String(context.clientId),
      principal: identity.principal,
      authenticated: identity.authenticated,
      allowSessionOwner: identity.allowSessionOwner
    })
    const authorityProof = admission.grant.capabilities?.terminalAuthorityConsumerProof
    const authorityTransport = authorityProof?.version === TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION
    const policyConsumers = this.policyConsumers
    if (!context.onResponseSettled) {
      admission.rollbackPublication()
      throw new Error('SSH PTY consumer response publication fence is unavailable')
    }
    const commitAdmission = (): void => {
      admission.commitPublication()
      this.closeDisplacedOwner(admission.displacedOwner)
      if (admission.grant.capabilities?.terminalAuthorityOutcomeDelivery?.version === 1) {
        for (const listener of this.outcomeDeliveryClientListeners) {
          listener(context.clientId)
        }
      }
    }
    if (authorityProof?.version === TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION) {
      if (!policyConsumers) {
        admission.rollbackPublication()
        throw new Error('SSH PTY consumer authenticated transport is unavailable')
      }
      try {
        // Why: a follow-up can arrive before the response fence runs; the authenticated consumer and
        // owner claim must be live before this handler exposes a successful grant to the dispatcher.
        policyConsumers.installTransport(
          context.clientId,
          identity,
          authorityProof.retirementVersion === TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
        )
        commitAdmission()
      } catch (error) {
        admission.rollbackPublication()
        policyConsumers.disconnect(context.clientId)
        throw error
      }
    }
    context.onResponseSettled((result) => {
      if (!authorityTransport && !result.ok) {
        admission.rollbackPublication()
      } else if (!authorityTransport) {
        commitAdmission()
      }
    })
    return admission.grant
  }

  // Why: only after the replacement grant is published — until then the admission can still roll back
  // onto the incumbent. Its deliveries are retained for the new owner to rotate, exactly as on detach.
  private closeDisplacedOwner(displaced: PtyConsumerSessionAdmission['displacedOwner']): void {
    if (!displaced) {
      return
    }
    this.deliveryState.detach(displaced.grant)
    const clientId = Number(displaced.connectionId)
    if (Number.isSafeInteger(clientId)) {
      this.dispatcher.releaseDisplacedClient(clientId)
    }
  }
}
