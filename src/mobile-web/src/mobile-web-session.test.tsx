// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebWorkspaceSummary } from '../../shared/mobile-web/bridge-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebSession } from './mobile-web-session'

vi.mock('./mobile-web-terminal', () => ({ MobileWebTerminal: () => null }))

const WORKSPACE: MobileWebWorkspaceSummary = {
  id: 'workspace-1',
  repoId: 'repo-1',
  workspaceKind: 'git',
  name: 'Mobile rearchitecture',
  repo: 'repo',
  branch: 'mobile-rearch',
  folderName: '',
  workspaceStatus: '',
  sortOrder: 0,
  manualOrder: null,
  lastActivityAt: null,
  createdAt: null,
  isArchived: false,
  isMainWorktree: false,
  hasHostSidebarActivity: false,
  parentWorkspaceId: null,
  isActive: true,
  liveTerminalCount: 1,
  hasAttachedPty: true,
  unread: false,
  lastOutputAt: null,
  isPinned: false,
  linkedPR: null,
  linkedIssue: null,
  linkedLinearIssue: null,
  linkedGitLabMR: null,
  linkedGitLabIssue: null,
  comment: '',
  status: 'active',
  agents: []
}

afterEach(cleanup)

describe('mobile web session', () => {
  it('activates before loading a bounded session and retains it offline', async () => {
    const calls: string[] = []
    const workspaceActivate = vi.fn().mockImplementation(async () => {
      calls.push('activate')
      return {
        workspaceId: 'workspace-1',
        activated: true,
        sleepingAgentWake: 'not-applicable'
      }
    })
    const sessionSnapshot = vi.fn().mockImplementation(async () => {
      calls.push('snapshot')
      return {
        workspaceId: 'workspace-1',
        publicationEpoch: 'epoch-1',
        snapshotVersion: 4,
        activeTabId: 'terminal-1',
        activeTabType: 'terminal',
        tabs: [
          {
            type: 'terminal',
            id: 'terminal-1',
            title: 'Codex',
            status: 'ready',
            isActive: true
          }
        ],
        truncated: false
      }
    })
    let onSessionEvent: ((snapshot: unknown) => void) | undefined
    const unsubscribe = vi.fn()
    const sessionSubscribe = vi.fn().mockImplementation((_payload, onEvent) => {
      onSessionEvent = onEvent
      return { ready: Promise.resolve(), unsubscribe }
    })
    const client = {
      workspaceActivate,
      sessionSnapshot,
      sessionSubscribe,
      fileList: vi.fn().mockResolvedValue(emptyFileList()),
      fileDirectory: vi.fn().mockResolvedValue(emptyFileDirectory()),
      sourceControlStatus: vi.fn().mockResolvedValue(emptySourceControlStatus()),
      sourceControlBranches: vi.fn().mockResolvedValue(emptyBranches()),
      sourceControlHistory: vi.fn().mockResolvedValue(emptyHistory()),
      sourceControlUpstream: vi.fn().mockResolvedValue(repositoryState()),
      sourceControlBranchCompare: vi.fn(),
      sourceControlCommitCompare: vi.fn(),
      sourceControlSubscribe: vi
        .fn()
        .mockReturnValue({ ready: Promise.resolve(), unsubscribe: vi.fn() })
    } as unknown as MobileWebBridgeClient
    const view = render(
      createElement(MobileWebSession, {
        client,
        connection: 'connected',
        workspace: WORKSPACE,
        onBack: vi.fn()
      })
    )

    expect(await screen.findByText('Codex')).toBeTruthy()
    expect(calls).toEqual(['activate', 'snapshot'])
    expect(workspaceActivate).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(sessionSnapshot).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(sessionSubscribe).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1' },
      expect.any(Function),
      expect.any(Function)
    )

    onSessionEvent?.({
      workspaceId: 'workspace-1',
      publicationEpoch: 'epoch-1',
      snapshotVersion: 5,
      activeTabId: 'file-1',
      activeTabType: 'file',
      tabs: [{ type: 'file', id: 'file-1', title: 'bridge.ts', isActive: true }],
      truncated: false
    })
    expect(await screen.findByText('bridge.ts')).toBeTruthy()

    onSessionEvent?.({
      workspaceId: 'workspace-1',
      publicationEpoch: 'epoch-1',
      snapshotVersion: 4,
      activeTabId: 'stale-file',
      activeTabType: 'file',
      tabs: [{ type: 'file', id: 'stale-file', title: 'stale.ts', isActive: true }],
      truncated: false
    })
    expect(screen.queryByText('stale.ts')).toBeNull()

    view.rerender(
      createElement(MobileWebSession, {
        client,
        connection: 'offline',
        workspace: WORKSPACE,
        onBack: vi.fn()
      })
    )
    expect(screen.getByText('bridge.ts')).toBeTruthy()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(screen.getByText('Desktop is offline — showing the last session snapshot.')).toBeTruthy()
  })

  it('creates, activates, and closes tabs through typed session actions', async () => {
    const initial = sessionSnapshot(4, 'terminal-1', [
      terminalTab('terminal-1', 'Codex', true),
      { type: 'file', id: 'file-1', title: 'Notes', isActive: false }
    ])
    const activated = sessionSnapshot(4, 'file-1', [
      terminalTab('terminal-1', 'Codex', false),
      { type: 'file', id: 'file-1', title: 'Notes', isActive: true }
    ])
    const created = sessionSnapshot(5, 'terminal-2', [
      terminalTab('terminal-1', 'Codex', false),
      { type: 'file', id: 'file-1', title: 'Notes', isActive: false },
      terminalTab('terminal-2', 'Shell', true)
    ])
    const closed = sessionSnapshot(6, 'terminal-2', [
      { type: 'file', id: 'file-1', title: 'Notes', isActive: false },
      terminalTab('terminal-2', 'Shell', true)
    ])
    const sessionSnapshotRequest = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce(closed)
    const sessionActivate = vi.fn().mockResolvedValue(activated)
    const sessionCreate = vi.fn().mockResolvedValue({
      workspaceId: WORKSPACE.id,
      tabId: 'terminal-2',
      created: true
    })
    const sessionClose = vi.fn().mockResolvedValue({
      workspaceId: WORKSPACE.id,
      tabId: 'terminal-1',
      outcome: 'closed',
      refusalReason: null
    })
    const client = {
      workspaceActivate: vi.fn().mockResolvedValue({
        workspaceId: WORKSPACE.id,
        activated: true,
        sleepingAgentWake: 'not-applicable'
      }),
      sessionSnapshot: sessionSnapshotRequest,
      sessionSubscribe: vi.fn().mockReturnValue({
        ready: Promise.resolve(),
        unsubscribe: vi.fn()
      }),
      sessionActivate,
      sessionCreate,
      sessionClose,
      fileList: vi.fn().mockResolvedValue(emptyFileList()),
      fileDirectory: vi.fn().mockResolvedValue(emptyFileDirectory()),
      sourceControlStatus: vi.fn().mockResolvedValue(emptySourceControlStatus()),
      sourceControlBranches: vi.fn().mockResolvedValue(emptyBranches()),
      sourceControlHistory: vi.fn().mockResolvedValue(emptyHistory()),
      sourceControlUpstream: vi.fn().mockResolvedValue(repositoryState()),
      sourceControlBranchCompare: vi.fn(),
      sourceControlCommitCompare: vi.fn(),
      sourceControlSubscribe: vi
        .fn()
        .mockReturnValue({ ready: Promise.resolve(), unsubscribe: vi.fn() })
    } as unknown as MobileWebBridgeClient

    render(
      createElement(MobileWebSession, {
        client,
        connection: 'connected',
        workspace: WORKSPACE,
        onBack: vi.fn()
      })
    )

    expect(await screen.findByText('Notes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Notes file' }))
    await vi.waitFor(() => {
      expect(sessionActivate).toHaveBeenCalledWith({
        workspaceId: WORKSPACE.id,
        tabId: 'file-1'
      })
      expect(screen.getByText('Notes').closest('li')?.getAttribute('data-current')).toBe('true')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(await screen.findByText('Shell')).toBeTruthy()
    expect(sessionCreate).toHaveBeenCalledWith({ workspaceId: WORKSPACE.id })

    fireEvent.click(screen.getByRole('button', { name: 'Close Codex' }))
    await vi.waitFor(() => expect(screen.queryByText('Codex')).toBeNull())
    expect(sessionClose).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      tabId: 'terminal-1'
    })
  })
})

function sessionSnapshot(
  snapshotVersion: number,
  activeTabId: string,
  tabs: (
    | ReturnType<typeof terminalTab>
    | { type: 'file'; id: string; title: string; isActive: boolean }
  )[]
) {
  return {
    workspaceId: WORKSPACE.id,
    publicationEpoch: 'epoch-1',
    snapshotVersion,
    activeTabId,
    activeTabType: tabs.find((tab) => tab.id === activeTabId)?.type ?? null,
    tabs,
    truncated: false
  }
}

function terminalTab(id: string, title: string, isActive: boolean) {
  return { type: 'terminal' as const, id, title, status: 'ready' as const, isActive }
}

function emptyFileList() {
  return {
    workspaceId: WORKSPACE.id,
    files: [],
    totalCount: 0,
    truncated: false
  }
}

function emptyFileDirectory() {
  return {
    workspaceId: WORKSPACE.id,
    relativePath: '',
    revision: '0'.repeat(64),
    entries: [],
    truncated: false
  }
}

function emptySourceControlStatus() {
  return {
    workspaceId: WORKSPACE.id,
    conflictOperation: 'unknown',
    entries: [],
    totalCount: 0,
    truncated: false
  }
}

function emptyBranches() {
  return {
    workspaceId: WORKSPACE.id,
    current: 'main',
    branches: ['main'],
    totalCount: 1,
    truncated: false
  }
}

function emptyHistory() {
  return {
    workspaceId: WORKSPACE.id,
    items: [],
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: false,
    limit: 50
  }
}

function repositoryState() {
  return {
    workspaceId: WORKSPACE.id,
    head: null,
    branch: 'main',
    conflictOperation: 'unknown',
    baseRef: 'origin/main',
    upstream: {
      hasUpstream: true,
      upstreamName: 'origin/main',
      ahead: 0,
      behind: 0,
      hasConfiguredPushTarget: false,
      behindCommitsArePatchEquivalent: false
    }
  }
}
