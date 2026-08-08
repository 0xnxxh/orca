import type { ClaimedAgentPtyOwnerRegistry } from '../../shared/claimed-agent-pty-owner'
import type { Session } from './session'
import type { SessionInfo } from './types'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

export function listLiveTerminalHostSessions(
  sessions: ReadonlyMap<string, Session>,
  agentSessionOwners: ClaimedAgentPtyOwnerRegistry,
  authorityAccessFor?: (physicalPtyId: string) => TerminalSessionAuthorityPtyAccess | null
): SessionInfo[] {
  const result: SessionInfo[] = []
  for (const session of sessions.values()) {
    if (!session.isAlive) {
      continue
    }
    const size = session.getAppliedSize()
    const authorityAccess = authorityAccessFor?.(session.sessionId) ?? null
    result.push({
      sessionId: session.sessionId,
      incarnationId: session.incarnationId,
      ...(authorityAccess ? { terminalSessionAuthorityAccess: authorityAccess } : {}),
      state: session.state,
      shellState: session.shellState,
      isAlive: true,
      ...(session.terminalHandle ? { terminalHandle: session.terminalHandle } : {}),
      wslDistro: session.wslDistro,
      pid: session.pid,
      cwd: session.getCwd(),
      cols: size?.cols ?? 0,
      rows: size?.rows ?? 0,
      createdAt: 0,
      agentSessionOwners: agentSessionOwners.listForPty(session.sessionId)
    })
  }
  return result
}
