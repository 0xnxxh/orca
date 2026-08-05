import { describe, expect, it, vi } from 'vitest'
import type {
  AiVaultAgent,
  AiVaultListResult,
  AiVaultSession
} from '../../../shared/ai-vault-types'
import { resolveTerminalTabTitle } from '../../../shared/tab-title-resolution'
import type { TerminalTab } from '../../../shared/types'
import { collectAiVaultTitleRequests } from './ai-vault-tab-title-requests'
import { startAiVaultTabTitleSync } from './ai-vault-tab-title-sync'
import type { AppState } from '@/store/types'

function terminalTab(worktreeId: string, aiVaultTitle?: TerminalTab['aiVaultTitle']): TerminalTab {
  return {
    id: 'tab-1',
    ptyId: null,
    worktreeId,
    title: '⠋ albacore',
    aiVaultTitle,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function session(
  agent: Extract<AiVaultAgent, 'claude' | 'codex'>,
  executionHostId: AiVaultSession['executionHostId'],
  title: string
): AiVaultSession {
  return {
    id: `${executionHostId}:${agent}:${agent}-session:/sessions/${agent}.jsonl`,
    executionHostId,
    agent,
    sessionId: `${agent}-session`,
    title,
    cwd: '/workspace/albacore',
    branch: null,
    model: null,
    filePath: `/sessions/${agent}.jsonl`,
    codexHome: agent === 'codex' ? '/home/dev/.codex' : null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-08-05T00:00:00.000Z',
    messageCount: 1,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: `${agent} --resume ${agent}-session`,
    subagent: null
  }
}

function makeState(args: {
  agent?: 'claude' | 'codex'
  aiVaultTitle?: TerminalTab['aiVaultTitle']
  executionHostId: 'ssh:dev-box' | 'runtime:server-1'
  sleeping?: boolean
  path: string
  worktreeId: string
}) {
  const agent = args.agent ?? 'codex'
  const tab = terminalTab(args.worktreeId, args.aiVaultTitle)
  const listeners = new Set<(state: AppState, previous: AppState) => void>()
  const providerSession = { key: 'session_id' as const, id: `${agent}-session` }
  const statusEntry = {
    state: 'done' as const,
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    agentType: agent,
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: args.worktreeId,
    providerSession,
    stateHistory: []
  }
  let state = {
    activeWorktreeId: args.worktreeId,
    activeWorkspaceExecutionHostId: args.executionHostId,
    agentStatusByPaneKey: args.sleeping ? {} : { 'tab-1:leaf-1': statusEntry },
    retainedAgentsByPaneKey: {},
    sleepingAgentSessionsByPaneKey: args.sleeping
      ? {
          'tab-1:leaf-1': {
            paneKey: 'tab-1:leaf-1',
            tabId: 'tab-1',
            worktreeId: args.worktreeId,
            agent,
            providerSession,
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
    setAiVaultTabTitle: (tabId: string, aiVaultTitle: TerminalTab['aiVaultTitle'] | null) => {
      const previous = state
      state = {
        ...state,
        tabsByWorktree: {
          [args.worktreeId]: state.tabsByWorktree[args.worktreeId].map((entry: TerminalTab) =>
            entry.id === tabId ? { ...entry, aiVaultTitle } : entry
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

describe('AI Vault tab title sync', () => {
  it.each(['claude', 'codex'] as const)(
    'projects the canonical %s AI Vault session title',
    async (agent) => {
      const store = makeState({
        agent,
        executionHostId: 'ssh:dev-box',
        worktreeId: 'worktree-1',
        path: '/workspace/albacore'
      })
      const listSessions = vi.fn(
        async (): Promise<AiVaultListResult> => ({
          sessions: [session(agent, 'ssh:dev-box', `${agent} conversation`)],
          issues: [],
          scannedAt: '2026-08-05T00:00:00.000Z'
        })
      )
      const stop = startAiVaultTabTitleSync({ ...store, listSessions })

      await vi.waitFor(() =>
        expect(store.getState().tabsByWorktree['worktree-1'][0].aiVaultTitle).toEqual({
          agent,
          sessionId: `${agent}-session`,
          title: `${agent} conversation`
        })
      )
      expect(listSessions).toHaveBeenCalledWith({
        executionHostScope: 'ssh:dev-box',
        scopePaths: ['/workspace/albacore'],
        limit: 500
      })
      stop()
    }
  )

  it('uses runtime host authority and folder workspace paths', () => {
    const store = makeState({
      executionHostId: 'runtime:server-1',
      worktreeId: 'folder:folder-1',
      path: '/srv/folders/albacore'
    })

    expect(collectAiVaultTitleRequests(store.getState())).toEqual([
      expect.objectContaining({
        executionHostId: 'runtime:server-1',
        scopePath: '/srv/folders/albacore',
        tabId: 'tab-1',
        worktreeId: 'folder:folder-1'
      })
    ])
  })

  it('retains a recovered sleeping title after its lifecycle record disappears', async () => {
    const store = makeState({
      executionHostId: 'ssh:dev-box',
      worktreeId: 'worktree-1',
      path: '/workspace/albacore',
      sleeping: true
    })
    const stop = startAiVaultTabTitleSync({
      ...store,
      listSessions: async () => ({
        sessions: [session('codex', 'ssh:dev-box', 'Stable conversation')],
        issues: [],
        scannedAt: '2026-08-05T00:00:00.000Z'
      })
    })

    await vi.waitFor(() =>
      expect(store.getState().tabsByWorktree['worktree-1'][0].aiVaultTitle).toBeTruthy()
    )
    store.removeSleepingRecord()
    const restored = store.getState().tabsByWorktree['worktree-1'][0] as TerminalTab
    expect(resolveTerminalTabTitle(restored, false)).toBe('Stable conversation')
    stop()
  })

  it('refreshes a live title when the AI Vault name changes', async () => {
    const store = makeState({
      aiVaultTitle: { agent: 'codex', sessionId: 'codex-session', title: 'First name' },
      executionHostId: 'ssh:dev-box',
      worktreeId: 'worktree-1',
      path: '/workspace/albacore'
    })
    let title = 'First name'
    let refresh: (() => void) | undefined
    const stop = startAiVaultTabTitleSync({
      ...store,
      listSessions: async () => ({
        sessions: [session('codex', 'ssh:dev-box', title)],
        issues: [],
        scannedAt: '2026-08-05T00:00:00.000Z'
      }),
      setTimer: (callback) => {
        refresh = callback
        return 1
      },
      clearTimer: () => {}
    })

    await vi.waitFor(() => expect(refresh).toBeTypeOf('function'))
    title = 'Renamed conversation'
    refresh?.()
    await vi.waitFor(() =>
      expect(store.getState().tabsByWorktree['worktree-1'][0].aiVaultTitle?.title).toBe(
        'Renamed conversation'
      )
    )
    stop()
  })
})
