// @vitest-environment happy-dom
import { StrictMode, type PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import type { WorkspaceSpaceWorktree } from '../../../../shared/workspace-space-types'
import { useAppStore } from '../../store'
import { useWorkspaceSpaceGitStatusRefresh } from './use-workspace-space-git-status-refresh'

const mocks = vi.hoisted(() => ({
  loadWorkspaceSpaceGitStatus: vi.fn()
}))

vi.mock('./workspace-space-git-status-snapshot', () => ({
  loadWorkspaceSpaceGitStatus: mocks.loadWorkspaceSpaceGitStatus
}))

function row(overrides: Partial<WorkspaceSpaceWorktree> = {}): WorkspaceSpaceWorktree {
  return {
    worktreeId: 'repo::/worktrees/feature',
    repoId: 'repo',
    repoDisplayName: 'Repo',
    repoPath: '/repo',
    displayName: 'feature',
    path: '/worktrees/feature',
    branch: 'refs/heads/feature',
    isMainWorktree: false,
    isRemote: false,
    isSparse: false,
    canDelete: true,
    lastActivityAt: 0,
    status: 'ok',
    error: null,
    scannedAt: 1,
    sizeBytes: 1,
    reclaimableBytes: 1,
    skippedEntryCount: 0,
    topLevelItems: [],
    omittedTopLevelItemCount: 0,
    omittedTopLevelSizeBytes: 0,
    ...overrides
  }
}

function deferred(): { promise: Promise<'snapshot'>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<'snapshot'>((done) => {
    resolve = () => done('snapshot')
  })
  return { promise, resolve }
}

function strictWrapper({ children }: PropsWithChildren): React.JSX.Element {
  return <StrictMode>{children}</StrictMode>
}

function deps() {
  return {
    setGitStatus: vi.fn(),
    updateWorktreeGitIdentity: vi.fn(),
    setUpstreamStatus: vi.fn(),
    fetchUpstreamStatus: vi.fn()
  }
}

function setCurrentRow(current: WorkspaceSpaceWorktree, connectionId = 'ssh-current'): void {
  useAppStore.setState({
    workspaceSpaceAnalysis: {
      scannedAt: 1,
      totalSizeBytes: 1,
      reclaimableBytes: 1,
      worktreeCount: 1,
      scannedWorktreeCount: 1,
      unavailableWorktreeCount: 0,
      repos: [],
      worktrees: [current]
    },
    repos: [
      {
        id: current.repoId,
        path: current.repoPath,
        displayName: current.repoDisplayName,
        badgeColor: '#999999',
        addedAt: 1,
        connectionId
      }
    ],
    gitStatusByWorktree: {},
    settings: {
      ...useAppStore.getState().settings,
      activeRuntimeEnvironmentId: null
    } as GlobalSettings
  })
}

function currentRepoMap() {
  return new Map(useAppStore.getState().repos.map((repo) => [repo.id, repo]))
}

describe('useWorkspaceSpaceGitStatusRefresh', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    mocks.loadWorkspaceSpaceGitStatus.mockReset()
  })

  it('coalesces StrictMode duplicate effects for the same missing context', async () => {
    const current = row()
    const pending = deferred()
    setCurrentRow(current)
    const repoMap = currentRepoMap()
    mocks.loadWorkspaceSpaceGitStatus.mockReturnValue(pending.promise)

    const hook = renderHook(
      () =>
        useWorkspaceSpaceGitStatusRefresh({
          sourceRows: [current],
          repoMap,
          settings: useAppStore.getState().settings,
          deps: deps()
        }),
      { wrapper: strictWrapper }
    )

    await waitFor(() => expect(mocks.loadWorkspaceSpaceGitStatus).toHaveBeenCalledOnce())
    pending.resolve()
    await act(async () => pending.promise)
    hook.unmount()
  })

  it('fences a same-id route/context replacement before the next result can commit', async () => {
    const first = row()
    const replacement = row({ path: '/worktrees/replacement', branch: 'refs/heads/replacement' })
    const pending = deferred()
    setCurrentRow(first)
    const repoMap = currentRepoMap()
    mocks.loadWorkspaceSpaceGitStatus.mockReturnValue(pending.promise)
    const testDeps = deps()

    const hook = renderHook(
      ({ rows }) =>
        useWorkspaceSpaceGitStatusRefresh({
          sourceRows: rows,
          repoMap,
          settings: useAppStore.getState().settings,
          deps: testDeps
        }),
      { initialProps: { rows: [first] } }
    )
    await waitFor(() => expect(mocks.loadWorkspaceSpaceGitStatus).toHaveBeenCalledOnce())
    const firstRequest = mocks.loadWorkspaceSpaceGitStatus.mock.calls[0][0].request

    setCurrentRow(replacement)
    expect(firstRequest.shouldStart()).toBe(false)
    expect(firstRequest.shouldContinue()).toBe(false)
    hook.rerender({ rows: [replacement] })
    await waitFor(() => expect(mocks.loadWorkspaceSpaceGitStatus).toHaveBeenCalledTimes(2))
    expect(firstRequest.signal.aborted).toBe(true)
    hook.unmount()
  })

  it('restarts a missing row when only its SSH connection mapping changes', async () => {
    const current = row()
    const firstPending = deferred()
    const replacementPending = deferred()
    setCurrentRow(current, 'ssh-old')
    const oldRepoMap = currentRepoMap()
    mocks.loadWorkspaceSpaceGitStatus
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(replacementPending.promise)
    const testDeps = deps()

    const hook = renderHook(
      ({ repoMap }) =>
        useWorkspaceSpaceGitStatusRefresh({
          sourceRows: [current],
          repoMap,
          settings: useAppStore.getState().settings,
          deps: testDeps
        }),
      { initialProps: { repoMap: oldRepoMap } }
    )
    await waitFor(() => expect(mocks.loadWorkspaceSpaceGitStatus).toHaveBeenCalledOnce())
    const firstCall = mocks.loadWorkspaceSpaceGitStatus.mock.calls[0][0]
    expect(firstCall.context.connectionId).toBe('ssh-old')

    setCurrentRow(current, 'ssh-new')
    expect(firstCall.request.shouldContinue()).toBe(false)
    hook.rerender({ repoMap: currentRepoMap() })

    await waitFor(() => expect(mocks.loadWorkspaceSpaceGitStatus).toHaveBeenCalledTimes(2))
    expect(firstCall.request.signal.aborted).toBe(true)
    expect(mocks.loadWorkspaceSpaceGitStatus.mock.calls[1][0].context.connectionId).toBe('ssh-new')

    firstPending.resolve()
    await act(async () => firstPending.promise)
    expect(testDeps.setGitStatus).not.toHaveBeenCalled()

    hook.unmount()
    replacementPending.resolve()
    await act(async () => replacementPending.promise)
    expect(testDeps.setGitStatus).not.toHaveBeenCalled()
  })

  it('requires the renderer status entry to remain missing and aborts on unmount', async () => {
    const current = row()
    const pending = deferred()
    setCurrentRow(current)
    const repoMap = currentRepoMap()
    mocks.loadWorkspaceSpaceGitStatus.mockReturnValue(pending.promise)
    const testDeps = deps()

    const hook = renderHook(() =>
      useWorkspaceSpaceGitStatusRefresh({
        sourceRows: [current],
        repoMap,
        settings: useAppStore.getState().settings,
        deps: testDeps
      })
    )
    await waitFor(() => expect(mocks.loadWorkspaceSpaceGitStatus).toHaveBeenCalledOnce())
    const request = mocks.loadWorkspaceSpaceGitStatus.mock.calls[0][0].request

    useAppStore.setState({
      gitStatusByWorktree: {
        [current.worktreeId]: [{ path: 'newer.ts', status: 'modified', area: 'unstaged' }]
      }
    })
    expect(request.shouldStart()).toBe(false)
    expect(request.shouldContinue()).toBe(true)
    hook.unmount()
    await act(async () => undefined)
    expect(request.signal.aborted).toBe(true)
    pending.resolve()
    await act(async () => pending.promise)
    expect(testDeps.setGitStatus).not.toHaveBeenCalled()
  })
})
