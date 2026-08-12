export type StructuredAgentSessionTab = {
  sessionId: string
  workspaceId: string
  agent: 'codex'
}

export function listStructuredAgentSessionTabs(
  sessions: ReadonlyMap<string, { params: { location: { workspaceId: string } } }>
): StructuredAgentSessionTab[] {
  return [...sessions.entries()].map(([sessionId, session]) => ({
    sessionId,
    workspaceId: session.params.location.workspaceId,
    agent: 'codex'
  }))
}
