import { useAppStore } from '@/store'
import type { PtyListedSession } from '../../../shared/pty-listed-session'
import { parsePtySessionId, PTY_SESSION_ID_SEPARATOR } from '../../../shared/pty-session-id-format'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { resumeSleepingAgentSessionsForWorktree } from './resume-sleeping-agent-session'

type ActivationStore = Pick<
  ReturnType<typeof useAppStore.getState>,
  'createTab' | 'ptyIdsByTabId' | 'unifiedTabsByWorktree'
>

type ActivationGateDeps = {
  getState: () => ActivationStore
  listSessions: () => Promise<PtyListedSession[]>
  hasStructuredSession?: (worktreeId: string) => Promise<boolean>
  resume: (worktreeId: string) => number
}

export type WorktreeAgentActivationOutcome = 'adopted' | 'structured' | 'resumed' | 'blocked'

const inFlightByWorktreeId = new Map<string, Promise<WorktreeAgentActivationOutcome>>()

export function workspaceHasSleepingAgentSessions(
  state: Pick<ReturnType<typeof useAppStore.getState>, 'sleepingAgentSessionsByPaneKey'>,
  worktreeId: string
): boolean {
  return Object.values(state.sleepingAgentSessionsByPaneKey).some(
    (record) => record.worktreeId === worktreeId
  )
}

function hasStructuredSession(store: ActivationStore, worktreeId: string): boolean {
  return (store.unifiedTabsByWorktree[worktreeId] ?? []).some(
    (tab) => tab.contentType === 'agent-session'
  )
}

function ptyIsAlreadyBound(store: ActivationStore, ptyId: string): boolean {
  return Object.values(store.ptyIdsByTabId).some((ids) => ids.includes(ptyId))
}

function sessionBelongsToWorkspace(sessionId: string, worktreeId: string): boolean {
  if (parsePtySessionId(sessionId).worktreeId === worktreeId) {
    return true
  }
  const scope = parseWorkspaceKey(worktreeId)
  return (
    scope?.type === 'folder' &&
    sessionId.startsWith(`${worktreeId}${PTY_SESSION_ID_SEPARATOR}`) &&
    sessionId.length > worktreeId.length + PTY_SESSION_ID_SEPARATOR.length
  )
}

export async function runWorktreeAgentActivationGate(
  worktreeId: string,
  deps: ActivationGateDeps
): Promise<WorktreeAgentActivationOutcome> {
  let sessions: PtyListedSession[]
  try {
    sessions = await deps.listSessions()
  } catch {
    // Inventory uncertainty cannot authorize a second writer.
    return 'blocked'
  }

  const liveWorkspaceSessions = sessions.filter((session) =>
    sessionBelongsToWorkspace(session.id, worktreeId)
  )
  if (liveWorkspaceSessions.length > 0) {
    for (const session of liveWorkspaceSessions) {
      const store = deps.getState()
      if (ptyIsAlreadyBound(store, session.id)) {
        continue
      }
      store.createTab(worktreeId, undefined, undefined, {
        initialPtyId: session.id,
        activate: false,
        recordInteraction: false
      })
    }
    return 'adopted'
  }

  try {
    if (
      hasStructuredSession(deps.getState(), worktreeId) ||
      (await deps.hasStructuredSession?.(worktreeId))
    ) {
      return 'structured'
    }
  } catch {
    return 'blocked'
  }
  deps.resume(worktreeId)
  return 'resumed'
}

export function gateWorktreeAgentActivation(
  worktreeId: string
): Promise<WorktreeAgentActivationOutcome> {
  const existing = inFlightByWorktreeId.get(worktreeId)
  if (existing) {
    return existing
  }
  const gate = runWorktreeAgentActivationGate(worktreeId, {
    getState: () => useAppStore.getState(),
    listSessions: () =>
      typeof window === 'undefined' ? Promise.resolve([]) : window.api.pty.listSessions(),
    hasStructuredSession: async (candidate) => {
      if (typeof window === 'undefined') {
        return false
      }
      const response = await window.api.runtime.call({ method: 'session.tabs.listAll', params: {} })
      if (!response.ok) {
        throw new Error('structured session inventory unavailable')
      }
      const result = response.result as { snapshots?: RuntimeMobileSessionTabsResult[] }
      return (result.snapshots ?? []).some(
        (snapshot) =>
          snapshot.worktree === candidate &&
          snapshot.tabs.some((tab) => tab.type === 'agent-session')
      )
    },
    resume: resumeSleepingAgentSessionsForWorktree
  }).finally(() => {
    if (inFlightByWorktreeId.get(worktreeId) === gate) {
      inFlightByWorktreeId.delete(worktreeId)
    }
  })
  inFlightByWorktreeId.set(worktreeId, gate)
  return gate
}

export function waitForWorktreeAgentActivationGateForTests(
  worktreeId: string
): Promise<WorktreeAgentActivationOutcome | null> {
  return inFlightByWorktreeId.get(worktreeId) ?? Promise.resolve(null)
}
