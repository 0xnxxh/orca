import { describe, expect, it, vi } from 'vitest'
import type { AiVaultListResult, AiVaultSession } from '../../../shared/ai-vault-types'
import { resolveTerminalTabTitle } from '../../../shared/tab-title-resolution'
import type { TerminalTab } from '../../../shared/types'
import { startProviderNativeTabTitleSync } from './provider-native-tab-title-sync'
import { collectProviderNativeTitleRequests } from './provider-native-tab-title-requests'
import type { AppState } from '@/store/types'

function terminalTab(worktreeId: string, providerNativeTitle?: TerminalTab['providerNativeTitle']) {
  return {
    id: 'tab-1',
    ptyId: null,
    worktreeId,
    title: '⠋ albacore',
    providerNativeTitle,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  } satisfies TerminalTab
}

function providerSessionEntry(worktreeId: string) {
  return {
    state: 'done' as const,
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    agentType: 'codex' as const,
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId,
    providerSession: { key: 'session_id' as const, id: 'codex-session' },
    stateHistory: []
  }
}

function session(executionHostId: AiVaultSession['executionHostId']): AiVaultSession {
  return {
    id: `${executionHostId}:codex:codex-session:/sessions/codex.jsonl`,
    executionHostId,
    agent: 'codex',
    sessionId: 'codex-session',
    title: 'Repair provider-native tab titles',
    providerNativeTitle: 'Repair provider-native tab titles',
    cwd: '/workspace/albacore',
    branch: null,
    model: null,
    filePath: '/sessions/codex.jsonl',
    codexHome: '/home/dev/.codex',
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-08-05T00:00:00.000Z',
    messageCount: 1,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'codex resume codex-session',
    subagent: null
  }
}

function makeState(args: {
  executionHostId: 'ssh:dev-box' | 'runtime:server-1'
  worktreeId: string
  path: string
  sleeping?: boolean
  providerNativeTitle?: TerminalTab['providerNativeTitle']
}) {
  const tab = terminalTab(args.worktreeId, args.providerNativeTitle)
  const listeners = new Set<(state: AppState, previous: AppState) => void>()
  let state = {
    activeWorktreeId: args.worktreeId,
    activeWorkspaceExecutionHostId: args.executionHostId,
    agentStatusByPaneKey: args.sleeping
      ? {}
      : { 'tab-1:leaf-1': providerSessionEntry(args.worktreeId) },
    retainedAgentsByPaneKey: {},
    sleepingAgentSessionsByPaneKey: args.sleeping
      ? {
          'tab-1:leaf-1': {
            paneKey: 'tab-1:leaf-1',
            tabId: 'tab-1',
            worktreeId: args.worktreeId,
            agent: 'codex',
            providerSession: { key: 'session_id', id: 'codex-session' },
            prompt: '',
            state: 'done',
            capturedAt: 1,
            updatedAt: 1,
            origin: 'worktree-sleep'
          }
        }
      : {},
    tabsByWorktree: { [args.worktreeId]: [tab] },
    terminalLayoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf', leafId: 'leaf-1' },
        activeLeafId: 'leaf-1',
        expandedLeafId: null
      }
    },
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    folderWorkspaces: [],
    getKnownWorktreeById: () => ({ path: args.path }),
    setProviderNativeTabTitle: (
      tabId: string,
      providerNativeTitle: TerminalTab['providerNativeTitle'] | null
    ) => {
      const previous = state
      state = {
        ...state,
        tabsByWorktree: {
          [args.worktreeId]: state.tabsByWorktree[args.worktreeId].map((entry: TerminalTab) =>
            entry.id === tabId ? { ...entry, providerNativeTitle } : entry
          )
        }
      }
      for (const listener of listeners) {
        listener(state, previous)
      }
    }
  } as unknown as AppState
  return {
    getState: () => state,
    removeSleepingRecord: () => {
      const previous = state
      state = { ...state, sleepingAgentSessionsByPaneKey: {} }
      for (const listener of listeners) {
        listener(state, previous)
      }
    },
    subscribe: (listener: (next: AppState, previous: AppState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

describe('provider-native tab title sync', () => {
  it('routes SSH title lookup through the workspace execution host and path', async () => {
    const store = makeState({
      executionHostId: 'ssh:dev-box',
      worktreeId: 'worktree-1',
      path: '/workspace/albacore'
    })
    const listSessions = vi.fn(
      async (): Promise<AiVaultListResult> => ({
        sessions: [session('ssh:dev-box')],
        issues: [],
        scannedAt: '2026-08-05T00:00:00.000Z'
      })
    )
    const stop = startProviderNativeTabTitleSync({ ...store, listSessions })

    await vi.waitFor(() =>
      expect(store.getState().tabsByWorktree['worktree-1'][0].providerNativeTitle).toEqual({
        agent: 'codex',
        sessionId: 'codex-session',
        title: 'Repair provider-native tab titles'
      })
    )
    expect(listSessions).toHaveBeenCalledWith({
      executionHostScope: 'ssh:dev-box',
      scopePaths: ['/workspace/albacore'],
      limit: 500,
      force: true
    })
    stop()
  })

  it('uses runtime host authority and folder workspace paths', () => {
    const store = makeState({
      executionHostId: 'runtime:server-1',
      worktreeId: 'folder:folder-1',
      path: '/srv/folders/albacore'
    })

    expect(collectProviderNativeTitleRequests(store.getState())).toEqual([
      expect.objectContaining({
        executionHostId: 'runtime:server-1',
        scopePath: '/srv/folders/albacore',
        tabId: 'tab-1',
        worktreeId: 'folder:folder-1'
      })
    ])
  })

  it('persists a recovered sleeping title after the session row disappears', async () => {
    const store = makeState({
      executionHostId: 'ssh:dev-box',
      worktreeId: 'worktree-1',
      path: '/workspace/albacore',
      sleeping: true
    })
    const stop = startProviderNativeTabTitleSync({
      ...store,
      listSessions: async () => ({
        sessions: [session('ssh:dev-box')],
        issues: [],
        scannedAt: '2026-08-05T00:00:00.000Z'
      })
    })

    await vi.waitFor(() =>
      expect(store.getState().tabsByWorktree['worktree-1'][0].providerNativeTitle).toBeTruthy()
    )
    store.removeSleepingRecord()
    const restored = store.getState().tabsByWorktree['worktree-1'][0] as TerminalTab
    expect(resolveTerminalTabTitle(restored, false)).toBe('Repair provider-native tab titles')
    stop()
  })

  it('does not rescan a restored tab that already carries its identity-bound title', async () => {
    const store = makeState({
      executionHostId: 'ssh:dev-box',
      worktreeId: 'worktree-1',
      path: '/workspace/albacore',
      sleeping: true,
      providerNativeTitle: {
        agent: 'codex',
        sessionId: 'codex-session',
        title: 'Restored conversation'
      }
    })
    const listSessions = vi.fn()
    const stop = startProviderNativeTabTitleSync({ ...store, listSessions })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(listSessions).not.toHaveBeenCalled()
    stop()
  })
})
