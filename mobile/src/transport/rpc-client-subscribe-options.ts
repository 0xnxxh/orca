import type { BrowserScreencastFrame } from './browser-screencast-protocol'
import type { TerminalStreamFrame } from './terminal-stream-protocol'

export type RpcClientSubscribeOptions = {
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
  onTerminalBinaryFrame?: (frame: TerminalStreamFrame) => boolean
}
