import { describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import type { PtyListedSession } from '../../../shared/pty-listed-session'
import { runWorktreeAgentActivationGate } from './worktree-agent-activation-gate'

const WORKTREE_ID = 'repo::/worktree'
const LIVE_LEAF_ID = '11111111-1111-4111-8111-111111111111'
const DEAD_LEAF_ID = '22222222-2222-4222-8222-222222222222'

function listed(id: string): PtyListedSession {
  return { id, cwd: '/worktree', title: 'Codex', agentOwnership: 'present' }
}

function sleepingRecord(
  tabId: string,
  leafId: string,
  providerSessionId: string
): SleepingAgentSessionRecord {
  return {
    paneKey: `${tabId}:${leafId}`,
    tabId,
    worktreeId: WORKTREE_ID,
    agent: 'codex',
    providerSession: { key: 'session_id', id: providerSessionId },
    prompt: 'resume',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1
  }
}

function testDeps(args: {
  sessions?: PtyListedSession[]
  sleeping?: SleepingAgentSessionRecord[]
  structured?: boolean
  resumeCount?: number
}) {
  const createTab = vi.fn()
  const resume = vi.fn(() => args.resumeCount ?? 1)
  const sleeping = args.sleeping ?? []
  const store = {
    createTab,
    ptyIdsByTabId: {},
    sleepingAgentSessionsByPaneKey: Object.fromEntries(
      sleeping.map((record) => [record.paneKey, record])
    ),
    terminalLayoutsByTabId: Object.fromEntries(
      sleeping.map((record) => {
        const leafId = record.paneKey.slice(record.paneKey.indexOf(':') + 1)
        return [
          record.tabId!,
          {
            root: { type: 'leaf' as const, leafId },
            activeLeafId: leafId,
            expandedLeafId: null,
            ptyIdsByLeafId: {}
          }
        ]
      })
    ),
    unifiedTabsByWorktree: {
      [WORKTREE_ID]: args.structured
        ? [
            {
              id: 'structured-1',
              entityId: 'session-1',
              groupId: 'group-1',
              worktreeId: WORKTREE_ID,
              contentType: 'agent-session' as const,
              label: 'Codex',
              customLabel: null,
              color: null,
              sortOrder: 0,
              createdAt: 1
            }
          ]
        : []
    }
  }
  return {
    createTab,
    resume,
    deps: {
      getState: () => store,
      listSessions: vi.fn(async () => args.sessions ?? []),
      resume
    }
  }
}

describe('worktree agent activation gate', () => {
  it('uses immediately ready development restore inventory', async () => {
    const ptyId = `${WORKTREE_ID}@@live-pty`
    const { deps, createTab, resume } = testDeps({ sessions: [listed(ptyId)] })
    const awaitReady = vi.fn(async () => true)

    await expect(
      runWorktreeAgentActivationGate(WORKTREE_ID, { ...deps, awaitReady })
    ).resolves.toBe('adopted')

    expect(awaitReady).toHaveBeenCalledOnce()
    expect(createTab).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
  })

  it('waits for packaged restore hydration before reading daemon inventory', async () => {
    const ptyId = `${WORKTREE_ID}@@live-pty`
    const { deps, createTab, resume } = testDeps({ sessions: [listed(ptyId)] })
    let releaseReady!: (ready: boolean) => void
    const awaitReady = vi.fn(() => new Promise<boolean>((resolve) => (releaseReady = resolve)))

    const activation = runWorktreeAgentActivationGate(WORKTREE_ID, { ...deps, awaitReady })
    await vi.waitFor(() => expect(awaitReady).toHaveBeenCalledOnce())
    expect(deps.listSessions).not.toHaveBeenCalled()

    releaseReady(true)
    await expect(activation).resolves.toBe('adopted')
    expect(deps.listSessions).toHaveBeenCalledOnce()
    expect(createTab).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
  })

  it('blocks automatic resume when packaged restore never becomes ready', async () => {
    const { deps, createTab, resume } = testDeps({})

    await expect(
      runWorktreeAgentActivationGate(WORKTREE_ID, {
        ...deps,
        awaitReady: async () => false
      })
    ).resolves.toBe('blocked')

    expect(deps.listSessions).not.toHaveBeenCalled()
    expect(createTab).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
  })

  it('adopts a live daemon PTY before activation can resume another agent', async () => {
    const ptyId = `${WORKTREE_ID}@@live-pty`
    const { deps, createTab, resume } = testDeps({ sessions: [listed(ptyId)] })

    await expect(runWorktreeAgentActivationGate(WORKTREE_ID, deps)).resolves.toBe('adopted')

    expect(createTab).toHaveBeenCalledWith(WORKTREE_ID, undefined, undefined, {
      initialPtyId: ptyId,
      activate: false,
      recordInteraction: false
    })
    expect(resume).not.toHaveBeenCalled()
  })

  it('adopts a daemon PTY minted for a folder workspace', async () => {
    const folderWorkspaceId = 'folder:plain-workspace'
    const ptyId = `${folderWorkspaceId}@@live-pty`
    const { deps, createTab, resume } = testDeps({ sessions: [listed(ptyId)] })

    await expect(runWorktreeAgentActivationGate(folderWorkspaceId, deps)).resolves.toBe('adopted')

    expect(createTab).toHaveBeenCalledWith(folderWorkspaceId, undefined, undefined, {
      initialPtyId: ptyId,
      activate: false,
      recordInteraction: false
    })
    expect(resume).not.toHaveBeenCalled()
  })

  it('does not resume when the workspace has only a structured session', async () => {
    const { deps, createTab, resume } = testDeps({ structured: true })

    await expect(runWorktreeAgentActivationGate(WORKTREE_ID, deps)).resolves.toBe('structured')

    expect(createTab).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
  })

  it('does not resume when the runtime reports a structured session before tab sync', async () => {
    const { deps, createTab, resume } = testDeps({})
    const hasStructuredSession = vi.fn(async () => true)

    await expect(
      runWorktreeAgentActivationGate(WORKTREE_ID, { ...deps, hasStructuredSession })
    ).resolves.toBe('structured')

    expect(hasStructuredSession).toHaveBeenCalledWith(WORKTREE_ID)
    expect(createTab).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
  })

  it('keeps the existing resume path when the workspace has no live agent', async () => {
    const { deps, createTab, resume } = testDeps({})

    await expect(runWorktreeAgentActivationGate(WORKTREE_ID, deps)).resolves.toBe('resumed')

    expect(createTab).not.toHaveBeenCalled()
    expect(resume).toHaveBeenCalledOnce()
    expect(resume).toHaveBeenCalledWith(WORKTREE_ID, { skipClaimKeys: new Set() })
  })

  it('resumes a dead agent when the workspace only has a non-agent PTY', async () => {
    const dead = sleepingRecord('tab-dead', DEAD_LEAF_ID, 'dead-session')
    const plainPtyId = `${WORKTREE_ID}@@plain-shell`
    const { deps, resume } = testDeps({
      sessions: [{ ...listed(plainPtyId), title: 'zsh', agentOwnership: 'absent' }],
      sleeping: [dead]
    })

    await expect(runWorktreeAgentActivationGate(WORKTREE_ID, deps)).resolves.toBe('resumed')

    expect(resume).toHaveBeenCalledWith(WORKTREE_ID, { skipClaimKeys: new Set() })
  })

  it('suppresses only the exact live agent session while resuming a dead sibling', async () => {
    const live = sleepingRecord('tab-live', LIVE_LEAF_ID, 'live-session')
    const dead = sleepingRecord('tab-dead', DEAD_LEAF_ID, 'dead-session')
    const livePtyId = `${WORKTREE_ID}@@live-agent`
    const { deps, resume } = testDeps({ sessions: [listed(livePtyId)], sleeping: [live, dead] })
    const store = deps.getState()
    store.terminalLayoutsByTabId['tab-live']!.ptyIdsByLeafId[LIVE_LEAF_ID] = livePtyId

    await expect(runWorktreeAgentActivationGate(WORKTREE_ID, deps)).resolves.toBe('resumed')

    expect(resume).toHaveBeenCalledWith(WORKTREE_ID, {
      skipClaimKeys: new Set([`${WORKTREE_ID}\0codex\0session_id\0live-session`])
    })
  })
})
