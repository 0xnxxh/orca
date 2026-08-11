import type { RuntimeCapability } from '../../../shared/protocol-version'
import type { TerminalStreamFrame } from '../../../shared/terminal-stream-protocol'
import type { PairingRpcContext } from './core'

export type RpcDispatchStreamingOptions = {
  connectionId?: string
  signal?: AbortSignal
  clientId?: string
  pairedDeviceId?: string
  clientKind?: 'mobile' | 'runtime'
  clientCapabilities?: readonly RuntimeCapability[]
  onOutboundReplyOverflow?: (context: { method: string }) => void
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
