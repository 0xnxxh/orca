import { useAppStore } from '@/store'
import type { PtyListedSession } from '../../../shared/pty-listed-session'
import { parsePtySessionId, PTY_SESSION_ID_SEPARATOR } from '../../../shared/pty-session-id-format'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import {
  resumeSleepingAgentSessionsForWorktree,
  type ResumeSleepingAgentSessionsOptions
} from './resume-sleeping-agent-session'
import { getProviderSessionClaimKey } from './sleeping-agent-pane-ownership'

type ActivationStore = Pick<
  ReturnType<typeof useAppStore.getState>,
  | 'createTab'
  | 'ptyIdsByTabId'
  | 'sleepingAgentSessionsByPaneKey'
  | 'terminalLayoutsByTabId'
  | 'unifiedTabsByWorktree'
>

type ActivationGateDeps = {
  getState: () => ActivationStore
  awaitReady?: () => Promise<boolean>
  listSessions: () => Promise<PtyListedSession[]>
  hasStructuredSession?: (worktreeId: string) => Promise<boolean>
  resume: (worktreeId: string, options?: ResumeSleepingAgentSessionsOptions) => number
}

export type WorktreeAgentActivationOutcome = 'adopted' | 'structured' | 'resumed' | 'blocked'

const inFlightByWorktreeId = new Map<string, Promise<WorktreeAgentActivationOutcome>>()
const WORKSPACE_SESSION_READY_TIMEOUT_MS = 30_000

function waitForWorkspaceSessionReady(): Promise<boolean> {
  if (useAppStore.getState().workspaceSessionReady) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null
    const settle = (ready: boolean) => {
      clearTimeout(timeout)
      unsubscribe?.()
      resolve(ready)
    }
    const timeout = setTimeout(
      () => settle(useAppStore.getState().workspaceSessionReady),
      WORKSPACE_SESSION_READY_TIMEOUT_MS
    )
    unsubscribe = useAppStore.subscribe((state) => {
      if (state.workspaceSessionReady) {
        settle(true)
      }
    })
    if (useAppStore.getState().workspaceSessionReady) {
      settle(true)
    }
  })
}

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

function liveSleepingAgentClaimKeys(
  store: ActivationStore,
  worktreeId: string,
  livePtyIds: ReadonlySet<string>
): Set<string> {
  const keys = new Set<string>()
  for (const record of Object.values(store.sleepingAgentSessionsByPaneKey)) {
    if (record.worktreeId !== worktreeId) {
      continue
    }
    const stable = parsePaneKey(record.paneKey)
    const tabId = record.tabId ?? stable?.tabId
    const persistedPtyId = stable
      ? store.terminalLayoutsByTabId[stable.tabId]?.ptyIdsByLeafId?.[stable.leafId]
      : tabId && store.ptyIdsByTabId[tabId]?.length === 1
        ? store.ptyIdsByTabId[tabId][0]
        : undefined
    if (persistedPtyId && livePtyIds.has(persistedPtyId)) {
      keys.add(getProviderSessionClaimKey(record))
    }
  }
  return keys
}

export async function runWorktreeAgentActivationGate(
  worktreeId: string,
  deps: ActivationGateDeps
): Promise<WorktreeAgentActivationOutcome> {
  try {
    if (deps.awaitReady && !(await deps.awaitReady())) {
      return 'blocked'
    }
  } catch {
    return 'blocked'
  }
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
  const liveWorkspacePtyIds = new Set(liveWorkspaceSessions.map((session) => session.id))
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
    if (!workspaceHasSleepingAgentSessions(deps.getState(), worktreeId)) {
      return 'adopted'
    }
  }

  let structured = false
  try {
    structured = Boolean(
      hasStructuredSession(deps.getState(), worktreeId) ||
      (await deps.hasStructuredSession?.(worktreeId))
    )
    if (structured && !workspaceHasSleepingAgentSessions(deps.getState(), worktreeId)) {
      return 'structured'
    }
  } catch {
    return 'blocked'
  }
  const launched = deps.resume(worktreeId, {
    skipClaimKeys: liveSleepingAgentClaimKeys(deps.getState(), worktreeId, liveWorkspacePtyIds)
  })
  return launched > 0
    ? 'resumed'
    : liveWorkspaceSessions.length > 0
      ? 'adopted'
      : structured
        ? 'structured'
        : 'resumed'
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
    awaitReady: waitForWorkspaceSessionReady,
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
