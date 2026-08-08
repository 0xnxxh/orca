import { shutdownTerminalHostSessions } from './terminal-host-session-shutdown'
import type { Session } from './session'
import type { TerminalHostOptions } from './terminal-host-options'
import type { TerminalHostAuthoritySessions } from './terminal-host-authority-sessions'
import type { TerminalHostTombstones } from './terminal-host-tombstones'

export async function disposeTerminalHostSessions(args: {
  sessions: Map<string, Session>
  authoritySessions: TerminalHostAuthoritySessions
  killedTombstones: TerminalHostTombstones
  onFinalCheckpoint: TerminalHostOptions['onFinalCheckpoint']
}): Promise<void> {
  const requestSettlement = args.authoritySessions.requestSettlement()
  if (requestSettlement) {
    await requestSettlement
  }
  const pendingSessions = new Map(
    args.authoritySessions
      .unpublishedSessions()
      .map((session) => [session.sessionId, session] as const)
  )
  await shutdownTerminalHostSessions(args.sessions, args.onFinalCheckpoint)
  await shutdownTerminalHostSessions(pendingSessions)
  await args.authoritySessions.finishDispose()
  args.killedTombstones.clear()
}
