import { describe, expect, it, vi } from 'vitest'
import type { PtyListedSession } from '../../../shared/pty-listed-session'
import { runWorktreeAgentActivationGate } from './worktree-agent-activation-gate'

const WORKTREE_ID = 'repo::/worktree'

function listed(id: string): PtyListedSession {
  return { id, cwd: '/worktree', title: 'Codex', agentOwnership: 'present' }
}

function testDeps(args: { sessions?: PtyListedSession[]; structured?: boolean }) {
  const createTab = vi.fn()
  const resume = vi.fn(() => 1)
  const store = {
    createTab,
    ptyIdsByTabId: {},
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
    expect(resume).toHaveBeenCalledWith(WORKTREE_ID)
  })
})
