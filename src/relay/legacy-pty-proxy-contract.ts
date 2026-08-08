import type { PtySourceSpan } from '../shared/pty-source-credit-contract'
import type { TerminalAuthorityOutcomeDeliveryAttempt } from './terminal-session-authority-outcome-delivery'

export const LEGACY_PTY_PROXY_MAX_RETAINED_BYTES = 2 * 1024 * 1024
export const LEGACY_PTY_PROXY_MAX_FRAMES = 1_024

export type LegacyPtyProxyDownstreamSettlement =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: Error }>

export type LegacyPtyProxySink = Readonly<{
  publishData: (
    span: PtySourceSpan,
    onSettled: (settlement: LegacyPtyProxyDownstreamSettlement) => void
  ) => boolean
  publishExit: (
    exit: LegacyPtyProxyExit,
    onSettled: (settlement: LegacyPtyProxyDownstreamSettlement) => void
  ) => boolean
}>

export type LegacyPtyProxyExit = Readonly<{
  id: string
  incarnationId: string
  code: number
  sourceEndSu: number
  authorityOutcome?: TerminalAuthorityOutcomeDeliveryAttempt
}>
