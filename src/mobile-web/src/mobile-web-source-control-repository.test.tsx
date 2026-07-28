// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebSourceControlRepository } from './mobile-web-source-control-repository'

afterEach(cleanup)

describe('MobileWebSourceControlRepository', () => {
  it('loads branches and history and compares each through the typed client', async () => {
    const client = repositoryClient()
    render(
      createElement(MobileWebSourceControlRepository, {
        client,
        workspaceId: 'workspace-1',
        connected: true,
        onRepositoryChanged: vi.fn()
      })
    )

    expect(await screen.findByText('feature/mobile')).toBeDefined()
    expect(screen.getByText('2 branches · 1 recent commit')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Compare feature/mobile' }))
    expect(await screen.findByText('src/branch.ts')).toBeDefined()
    expect(client.sourceControlBranchCompare).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', baseRef: 'feature/mobile', offset: 0, limit: 128 },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'History' }), { button: 0 })
    fireEvent.click(await screen.findByRole('button', { name: /feat: history/ }))
    expect(await screen.findByText('src/commit.ts')).toBeDefined()
    expect(client.sourceControlCommitCompare).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', commitId: 'a'.repeat(40) },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('aborts delayed repository and comparison reads on workspace replacement', async () => {
    let resolveBranches: ((value: ReturnType<typeof branchesResult>) => void) | undefined
    const first = repositoryClient()
    first.sourceControlBranches.mockReturnValue(
      new Promise((resolve) => {
        resolveBranches = resolve
      })
    )
    const second = repositoryClient('workspace-2')
    const view = render(
      createElement(MobileWebSourceControlRepository, {
        client: first,
        workspaceId: 'workspace-1',
        connected: true,
        onRepositoryChanged: vi.fn()
      })
    )
    const initialSignal = first.sourceControlBranches.mock.calls[0]?.[1]?.signal as AbortSignal

    view.rerender(
      createElement(MobileWebSourceControlRepository, {
        client: second,
        workspaceId: 'workspace-2',
        connected: true,
        onRepositoryChanged: vi.fn()
      })
    )
    expect(initialSignal.aborted).toBe(true)
    resolveBranches?.(branchesResult('workspace-1'))
    expect(await screen.findByText('release/mobile')).toBeDefined()
    expect(screen.queryByText('feature/mobile')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Compare release/mobile' }))
    const comparisonSignal = second.sourceControlBranchCompare.mock.calls[0]?.[1]
      ?.signal as AbortSignal
    view.rerender(
      createElement(MobileWebSourceControlRepository, {
        client: first,
        workspaceId: 'workspace-1',
        connected: true,
        onRepositoryChanged: vi.fn()
      })
    )
    await waitFor(() => expect(comparisonSignal.aborted).toBe(true))
  })

  it('confirms checkout and sends the exact displayed repository identity', async () => {
    const client = repositoryClient()
    const onRepositoryChanged = vi.fn()
    render(
      createElement(MobileWebSourceControlRepository, {
        client,
        workspaceId: 'workspace-1',
        connected: true,
        onRepositoryChanged
      })
    )

    await screen.findByText('feature/mobile')
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }))
    expect(await screen.findByText('Switch to feature/mobile?')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Switch branch' }))

    await waitFor(() =>
      expect(client.sourceControlCheckout).toHaveBeenCalledWith(
        {
          workspaceId: 'workspace-1',
          expectedHead: 'b'.repeat(40),
          expectedBranch: 'main',
          branch: 'feature/mobile',
          confirmation: 'checkout-confirmed'
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
    expect(onRepositoryChanged).toHaveBeenCalled()
  })

  it('confirms a non-force push and keeps fetch as a direct bounded action', async () => {
    const client = repositoryClient()
    render(
      createElement(MobileWebSourceControlRepository, {
        client,
        workspaceId: 'workspace-1',
        connected: true,
        onRepositoryChanged: vi.fn()
      })
    )

    expect(await screen.findByText('origin/main · ↓0 ↑1')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    await waitFor(() =>
      expect(client.sourceControlFetch).toHaveBeenCalledWith(
        {
          workspaceId: 'workspace-1',
          expectedHead: 'b'.repeat(40),
          expectedBranch: 'main'
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Push 1' }))
    expect(await screen.findByText('Push local commits?')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(client.sourceControlPush).toHaveBeenCalled())
    const payload = client.sourceControlPush.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      workspaceId: 'workspace-1',
      expectedHead: 'b'.repeat(40),
      expectedBranch: 'main',
      mode: 'push',
      confirmation: 'push-confirmed'
    })
    expect(payload).not.toHaveProperty('forceWithLease')
  })
})

function repositoryClient(workspaceId = 'workspace-1') {
  const branchName = workspaceId === 'workspace-1' ? 'feature/mobile' : 'release/mobile'
  return {
    sourceControlBranches: vi.fn().mockResolvedValue(branchesResult(workspaceId, branchName)),
    sourceControlHistory: vi.fn().mockResolvedValue(historyResult(workspaceId)),
    sourceControlBranchCompare: vi.fn().mockImplementation(({ workspaceId: requested }) =>
      Promise.resolve({
        workspaceId: requested,
        baseRef: branchName,
        compareRef: 'HEAD',
        baseOid: 'a'.repeat(40),
        headOid: 'b'.repeat(40),
        mergeBase: 'a'.repeat(40),
        changedFiles: 1,
        commitsAhead: 1,
        status: 'ready',
        entries: [{ relativePath: 'src/branch.ts', status: 'modified' }],
        truncated: false
      })
    ),
    sourceControlCommitCompare: vi.fn().mockImplementation(({ workspaceId: requested, commitId }) =>
      Promise.resolve({
        workspaceId: requested,
        commitId,
        commitOid: commitId,
        parentOid: null,
        compareRef: commitId.slice(0, 7),
        baseRef: 'empty tree',
        changedFiles: 1,
        status: 'ready',
        entries: [{ relativePath: 'src/commit.ts', status: 'added' }],
        truncated: false
      })
    ),
    sourceControlUpstream: vi.fn().mockResolvedValue(repositoryState(workspaceId)),
    sourceControlCheckout: vi
      .fn()
      .mockImplementation((payload) =>
        Promise.resolve(actionResult(payload.workspaceId, 'branch', payload.branch))
      ),
    sourceControlFetch: vi
      .fn()
      .mockImplementation((payload) => Promise.resolve(actionResult(payload.workspaceId, 'fetch'))),
    sourceControlPull: vi
      .fn()
      .mockImplementation((payload) => Promise.resolve(actionResult(payload.workspaceId, 'pull'))),
    sourceControlPush: vi
      .fn()
      .mockImplementation((payload) => Promise.resolve(actionResult(payload.workspaceId, 'push'))),
    sourceControlRebase: vi
      .fn()
      .mockImplementation((payload) =>
        Promise.resolve(actionResult(payload.workspaceId, 'rebase'))
      ),
    sourceControlAbort: vi
      .fn()
      .mockImplementation((payload) => Promise.resolve(actionResult(payload.workspaceId, 'abort')))
  } as unknown as MobileWebBridgeClient & {
    sourceControlBranches: ReturnType<typeof vi.fn>
    sourceControlHistory: ReturnType<typeof vi.fn>
    sourceControlBranchCompare: ReturnType<typeof vi.fn>
    sourceControlCommitCompare: ReturnType<typeof vi.fn>
    sourceControlCheckout: ReturnType<typeof vi.fn>
    sourceControlFetch: ReturnType<typeof vi.fn>
    sourceControlPush: ReturnType<typeof vi.fn>
  }
}

function branchesResult(workspaceId: string, branch = 'feature/mobile') {
  return {
    workspaceId,
    current: 'main',
    branches: ['main', branch],
    totalCount: 2,
    truncated: false
  }
}

function historyResult(workspaceId: string) {
  return {
    workspaceId,
    items: [
      {
        id: 'a'.repeat(40),
        parentIds: [],
        displayId: 'aaaaaaa',
        subject: 'feat: history',
        message: 'feat: history',
        author: 'Orca',
        timestamp: Date.UTC(2026, 6, 23),
        references: []
      }
    ],
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: false,
    limit: 50
  }
}

function repositoryState(workspaceId: string) {
  return {
    workspaceId,
    head: 'b'.repeat(40),
    branch: 'main',
    conflictOperation: 'unknown' as const,
    baseRef: 'origin/main',
    upstream: {
      hasUpstream: true,
      upstreamName: 'origin/main',
      ahead: 1,
      behind: 0,
      hasConfiguredPushTarget: false,
      behindCommitsArePatchEquivalent: false
    }
  }
}

function actionResult(workspaceId: string, operation: string, branch?: string) {
  return {
    workspaceId,
    operation,
    previousHead: 'b'.repeat(40),
    previousBranch: 'main',
    ...(branch ? { branch } : {}),
    repository: repositoryState(workspaceId),
    completed: true
  }
}
