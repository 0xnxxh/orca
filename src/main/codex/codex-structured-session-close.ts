import type { CodexSession, CodexStructuredSessionEvent } from './codex-structured-session-state'

export async function closeCodexPublishedSession(input: {
  sessions: Map<string, CodexSession>
  sessionId: string
  onEvent?: (event: CodexStructuredSessionEvent) => void
}): Promise<void> {
  const session = input.sessions.get(input.sessionId)
  if (!session) {
    return
  }
  input.sessions.delete(input.sessionId)
  session.prompts.clear()
  const event: CodexStructuredSessionEvent = {
    type: 'ended',
    sessionId: input.sessionId,
    reason: 'codex session closed'
  }
  session.translator?.handle(event)
  input.onEvent?.(event)
  session.translator?.flush()
  session.translator?.dispose()
  await session.connection.close()
}
