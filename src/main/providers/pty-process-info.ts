import type { AgentSessionOwnerBinding } from '../../shared/agent-session-host-authority'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

export type PtyProcessInfo = {
  id: string
  /** Opaque provider route captured with this inventory row for mutation-time revalidation. */
  mutationRouteToken?: object
  incarnationId?: PtyIncarnationId
  terminalSessionAuthorityAccess?: TerminalSessionAuthorityPtyAccess
  cwd: string
  title: string
  /** Owning worktree when the provider can report it authoritatively. */
  worktreeId?: string
  /** Trusted ORCA_TERMINAL_HANDLE exported into this PTY, when known. */
  terminalHandle?: string
  /** Exact WSL owner reported by the PTY provider; null means native Windows. */
  wslDistro?: string | null
  agentSessionOwners?: AgentSessionOwnerBinding[]
}
