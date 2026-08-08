import type {
  PtySourceRecoveryRequest,
  PtySourceRecoveryResult
} from '../shared/pty-source-recovery-contract'
import type {
  TerminalPaneGeneration,
  TerminalSessionBinding
} from '../shared/terminal-session-authority-identity'
import type { RequestContext } from './dispatcher'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'
import type { PtySourceDeliveryIdentity } from '../shared/pty-source-credit-contract'
import type { LegacyPhysicalWorkerMutation } from './legacy-physical-worker-mutation'
import type {
  TerminalAuthorityOutcome,
  TerminalSessionAuthorityEffect
} from '../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityOutcomeDeliveryAttempt } from './terminal-session-authority-outcome-delivery'
import type { TerminalSessionAuthorityPtyAccess } from '../shared/terminal-session-authority-pty-access'

export type LegacyPhysicalWorkerAttachResult = Readonly<{
  incarnationId: string
  replay?: string
  sourceRecovery?: PtySourceRecoveryResult
  sourceActivation?: PtySourceReceivingActivation
}>

export type LegacyPhysicalWorkerAttachRequest = Readonly<{
  pane: TerminalPaneGeneration
  binding: TerminalSessionBinding
  worktreeId: string
  expectedTabId?: string
  sourceRecovery?: PtySourceRecoveryRequest
  suppressReplayNotification: boolean
  context?: RequestContext
}>

export type LegacyPhysicalWorkerAttachRouter = Readonly<{
  attachReachablePty: (
    request: LegacyPhysicalWorkerAttachRequest
  ) => Promise<LegacyPhysicalWorkerAttachResult | null>
}>

export type LegacyPhysicalWorkerPtyRouter = LegacyPhysicalWorkerAttachRouter &
  Readonly<{
    dispatchMutation: (
      id: string,
      incarnationId: string,
      mutation: LegacyPhysicalWorkerMutation
    ) => Promise<boolean>
    dispatchAuthorityMutation: (
      access: TerminalSessionAuthorityPtyAccess,
      mutation: Exclude<LegacyPhysicalWorkerMutation, { kind: 'shutdown' }>
    ) => Promise<boolean>
    dispatchAuthorityShutdown: (
      access: TerminalSessionAuthorityPtyAccess,
      mutation: Extract<LegacyPhysicalWorkerMutation, { kind: 'shutdown' }>,
      persistClose: () => Promise<void>
    ) => Promise<boolean>
    ensureAuthorityShutdown?: (
      access: TerminalSessionAuthorityPtyAccess,
      mutation: Extract<LegacyPhysicalWorkerMutation, { kind: 'shutdown' }>
    ) => Promise<boolean>
    setDeliveryPaused: (identity: PtySourceDeliveryIdentity, paused: boolean) => boolean
    setHeldProducerPause: (
      id: string,
      incarnationId: string,
      token: string,
      paused: boolean
    ) => Promise<boolean>
    handleDownstreamCredit: (identity: PtySourceDeliveryIdentity) => boolean
    reservesPhysicalPtyId: (id: string) => boolean
    reservesPublicPtyIdentity: (id: string, incarnationId: string) => boolean
    publishAuthorityOutcome?: (
      outcome: TerminalAuthorityOutcome,
      effect: Extract<TerminalSessionAuthorityEffect, { kind: 'terminal-exited' }>,
      attempt: TerminalAuthorityOutcomeDeliveryAttempt
    ) => boolean
    dispose: () => void
  }>

export type LegacyPhysicalWorkerAttachIdentity = Readonly<{
  id: string
  incarnationId: string
  expectedPaneKey?: string
  expectedTabId?: string
}>
