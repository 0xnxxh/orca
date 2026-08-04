// Session-inventory shapes, split out of types.ts so the listing payload can
// grow without pushing that entry point over its line budget. Re-exported from
// `./types` so existing importers keep one entry point.
import type { AgentSessionOwnerBinding } from '../../shared/agent-session-host-authority'

// ─── Session State Machine ──────────────────────────────────────────
export type SessionState = 'created' | 'spawning' | 'running' | 'exiting' | 'exited'

export type ShellReadyState = 'pending' | 'ready' | 'timed_out' | 'unsupported'

export type SessionInfo = {
  sessionId: string
  incarnationId?: string
  state: SessionState
  shellState: ShellReadyState
  isAlive: boolean
  terminalHandle?: string
  /** Routing metadata for status bindings only, never an identity key — pane keys are reusable. */
  paneKey?: string
  wslDistro?: string | null
  pid: number | null
  cwd: string | null
  cols: number
  rows: number
  createdAt: number
  agentSessionOwners?: AgentSessionOwnerBinding[]
}

export type ListSessionsResult = {
  sessions: SessionInfo[]
}

// Why: SessionInfo + source protocol version, so the Manage Sessions UI can
// label legacy-backed sessions. Populated by the router/adapter at RPC time;
// never transmitted over the daemon wire (daemon only speaks its own
// protocol version and doesn't know about other versions).
export type DaemonSessionInfo = SessionInfo & {
  protocolVersion: number
}
