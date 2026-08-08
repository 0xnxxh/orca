import type { Session } from './session'
import type { ClaimedAgentPtyOwnerRegistry } from '../../shared/claimed-agent-pty-owner'
import type { TerminalHostAuthoritySessions } from './terminal-host-authority-sessions'
import type { TerminalHostTombstones } from './terminal-host-tombstones'
import type { SessionInfo, TakePendingOutputResult, TerminalSnapshot } from './types'
import { resolveTerminalHostSessionCwd } from './terminal-host-session-cwd'
import { listLiveTerminalHostSessions } from './terminal-host-session-listing'
import { isShellProcess } from '../../shared/agent-detection'

export class TerminalHostSessionQueries {
  constructor(
    private readonly sessions: ReadonlyMap<string, Session>,
    private readonly owners: ClaimedAgentPtyOwnerRegistry,
    private readonly authority: TerminalHostAuthoritySessions,
    private readonly tombstones: TerminalHostTombstones,
    private readonly alive: (sessionId: string) => Session
  ) {}

  detach(sessionId: string, token: symbol): void {
    this.sessions.get(sessionId)?.detachClient(token)
  }

  async getCwd(sessionId: string): Promise<string | null> {
    return await resolveTerminalHostSessionCwd(this.alive(sessionId))
  }

  getForegroundProcess(sessionId: string): string | null {
    const session = this.sessions.get(sessionId)
    return session?.isAlive ? session.getForegroundProcess() : null
  }

  inspectProcess(sessionId: string): {
    foregroundProcess: string | null
    hasChildProcesses: boolean
  } {
    const foregroundProcess = this.alive(sessionId).getForegroundProcess()
    return {
      foregroundProcess,
      hasChildProcesses: foregroundProcess !== null && !isShellProcess(foregroundProcess)
    }
  }

  async confirmForegroundProcess(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId)
    return session?.isAlive ? await session.confirmForegroundProcess() : null
  }

  getSnapshot(sessionId: string, options: { scrollbackRows?: number }): TerminalSnapshot | null {
    const session = this.sessions.get(sessionId)
    return session?.isAlive ? session.getSnapshot(options) : null
  }

  getPartialEscapeTailAnsi(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    return session?.isAlive ? session.getPartialEscapeTailAnsi() : ''
  }

  getAppliedSize(sessionId: string): { cols: number; rows: number } | null {
    const session = this.sessions.get(sessionId)
    return session?.isAlive ? session.getAppliedSize() : null
  }

  takePendingOutput(
    sessionId: string,
    includeSnapshot: boolean,
    options: { teardownSnapshot?: boolean }
  ): TakePendingOutputResult | null {
    const session = this.sessions.get(sessionId)
    return session?.isAlive ? session.takePendingOutput(includeSnapshot, options) : null
  }

  isKilled(sessionId: string): boolean {
    return this.tombstones.has(sessionId)
  }

  listSessions(): SessionInfo[] {
    return listLiveTerminalHostSessions(this.sessions, this.owners, (sessionId) =>
      this.authority.accessFor(sessionId)
    )
  }
}
