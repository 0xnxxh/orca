import {
  decodeBrowserScreencastFrame,
  type BrowserScreencastFrame
} from './browser-screencast-protocol'
import {
  handleTerminalBinaryFrame,
  type TerminalSnapshotState
} from './rpc-client-terminal-binary-frame'

export type RpcStreamingListener = (result: unknown) => void

export type RpcClientStreamRequest = {
  method: string
  params: unknown
  listener: RpcStreamingListener
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
  subscriptionId?: string
  cancelled?: boolean
  sent?: 'awaiting' | 'received'
}

type StreamFrameRoutingOptions = {
  activeBrowserRequestId: string | null
  streams: Map<string, RpcClientStreamRequest>
  terminalSnapshots: Map<number, TerminalSnapshotState>
  terminalListeners: Map<number, RpcStreamingListener>
}

export function routeRpcClientStreamFrame(
  bytes: Uint8Array,
  options: StreamFrameRoutingOptions
): void {
  const browserFrame = decodeBrowserScreencastFrame(bytes)
  if (browserFrame) {
    const stream = options.activeBrowserRequestId
      ? options.streams.get(options.activeBrowserRequestId)
      : undefined
    if (stream && !stream.cancelled && stream.method === 'browser.screencast') {
      stream.onBinaryFrame?.(browserFrame)
    }
    return
  }
  handleTerminalBinaryFrame(bytes, {
    terminalSnapshots: options.terminalSnapshots,
    getListener: (streamId) => options.terminalListeners.get(streamId)
  })
}
