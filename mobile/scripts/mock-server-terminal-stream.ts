import type { WebSocket } from 'ws'
import type { RpcRequest, RpcResponse } from './mock-server-rpc-handlers'
import {
  createMockTerminals,
  FAKE_SCROLLBACK,
  STREAMING_CHUNKS
} from './mock-server-terminal-fixtures'

// Why: the client resubscribes on every viewport change; without cancellation
// each resubscribe would stack another interval streaming under a dead request.
const streamIntervals = new WeakMap<WebSocket, Map<string, ReturnType<typeof setInterval>>>()

function clearTerminalStream(ws: WebSocket, terminal: string): void {
  const perTerminal = streamIntervals.get(ws)
  const interval = perTerminal?.get(terminal)
  if (interval !== undefined) {
    clearInterval(interval)
    perTerminal?.delete(terminal)
  }
}

function trackTerminalStream(
  ws: WebSocket,
  terminal: string,
  interval: ReturnType<typeof setInterval>
): void {
  let perTerminal = streamIntervals.get(ws)
  if (!perTerminal) {
    perTerminal = new Map()
    streamIntervals.set(ws, perTerminal)
  }
  perTerminal.set(terminal, interval)
}

/** Terminal list/stream/input backend for the mock server. Returns false for
 *  methods it does not own. */
export function handleMockTerminalRequest(
  request: RpcRequest,
  respond: (response: RpcResponse) => void,
  success: (id: string, result: unknown, streaming?: boolean) => RpcResponse,
  ws: WebSocket,
  // Shared with `session.tabs.list` so both surfaces agree on which worktree an
  // absent or `id:`-prefixed selector means.
  resolveWorktreeId: (selector: unknown) => string | undefined
): boolean {
  switch (request.method) {
    case 'terminal.list': {
      const terminals = createMockTerminals(resolveWorktreeId(request.params?.worktree))
      respond(
        success(request.id, {
          terminals,
          totalCount: terminals.length,
          truncated: false
        })
      )
      return true
    }

    case 'terminal.subscribe': {
      // Why: the client resubscribes until scrollback echoes its viewport dims;
      // the legacy `lines` shape left the session screen in that loop forever.
      const viewport = request.params?.viewport as { cols?: number; rows?: number } | undefined
      // MOCK_TUI=1 arms SGR drag mouse tracking (1002/1006) inside the scrollback
      // itself so every xterm re-init re-enters the mode - used by mouse/touch
      // input repros (#8818).
      const tuiPreamble =
        process.env.MOCK_TUI === '1'
          ? '\x1b[?1002h\x1b[?1006h[mock] mouse tracking ON (1002/1006)\r\n'
          : ''
      respond(
        success(request.id, {
          type: 'scrollback',
          cols: viewport?.cols ?? 80,
          rows: viewport?.rows ?? 24,
          serialized: FAKE_SCROLLBACK.replace(/\n/g, '\r\n') + tuiPreamble,
          truncated: false
        })
      )

      const terminal = String(request.params?.terminal ?? 'term-1')
      clearTerminalStream(ws, terminal)
      let chunkIndex = 0
      const interval = setInterval(() => {
        if (chunkIndex >= STREAMING_CHUNKS.length || ws.readyState !== ws.OPEN) {
          // Why: no `end` event - a live terminal stream stays open, and `end`
          // makes the client tear the subscription down and blank the pane.
          clearTerminalStream(ws, terminal)
          return
        }
        respond(success(request.id, { type: 'data', chunk: STREAMING_CHUNKS[chunkIndex] }, true))
        chunkIndex++
      }, 500)
      trackTerminalStream(ws, terminal, interval)
      return true
    }

    case 'terminal.send':
      // Input-routing repros (#8818) assert on the exact bytes reaching the host.
      console.log(
        `[SEND] terminal=${String(request.params?.terminal)} text=${JSON.stringify(request.params?.text)}`
      )
      respond(success(request.id, { send: { handle: 'term-1', ok: true } }))
      return true

    case 'terminal.unsubscribe':
      clearTerminalStream(ws, String(request.params?.terminal ?? 'term-1'))
      respond(success(request.id, { unsubscribed: true }))
      return true

    default:
      return false
  }
}
