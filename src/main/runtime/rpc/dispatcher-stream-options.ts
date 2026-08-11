import type { RuntimeCapability } from '../../../shared/protocol-version'
import type { TerminalStreamFrame } from '../../../shared/terminal-stream-protocol'
import type { PairingRpcContext } from './core'
import type { OversizedReplyReport } from './oversized-reply-report'

export type RpcDispatchStreamingOptions = {
  connectionId?: string
  signal?: AbortSignal
  clientId?: string
  pairedDeviceId?: string
  clientKind?: 'mobile' | 'runtime'
  clientCapabilities?: readonly RuntimeCapability[]
  /** The reply cannot be replaced in place; the caller is expected to kill the socket. */
  onOutboundReplyOverflow?: (report: OversizedReplyReport) => void
  /** The reply was replaced by a response_too_large envelope; the socket stays up. */
  onOutboundReplyTooLarge?: (report: OversizedReplyReport) => void
  // Why: socket-terminal conditions only — keying this off signal.aborted would silently
  // swallow the reply for any future per-request cancel and hang the caller.
  shouldSuppressReplies?: () => boolean
  pairing?: PairingRpcContext
  sendBinary?: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void
  registerBinaryStreamHandler?: (
    streamId: number,
    handler: (frame: TerminalStreamFrame) => void
  ) => () => void
}
