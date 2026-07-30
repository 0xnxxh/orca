// @vitest-environment happy-dom

import { StrictMode, type PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshProviderEpoch } from '../../../../shared/ssh-types'
import type { GitPushTarget, GitUpstreamStatus } from '../../../../shared/types'
import { useSourceControlAutomaticUpstreamSnapshot } from './use-source-control-automatic-upstream-snapshot'

const mocks = vi.hoisted(() => ({
  loadSourceControlAutomaticUpstream: vi.fn()
}))

vi.mock('./source-control-automatic-upstream-snapshot', () => ({
  loadSourceControlAutomaticUpstream: mocks.loadSourceControlAutomaticUpstream
}))

function deferred(): {
  promise: Promise<'snapshot'>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<'snapshot'>((done) => {
    resolve = () => done('snapshot')
  })
  return { promise, resolve }
}

function strictWrapper({ children }: PropsWithChildren): React.JSX.Element {
  return <StrictMode>{children}</StrictMode>
}

const fetchUpstreamStatus =
  vi.fn<
    (
      worktreeId: string,
      worktreePath: string,
      connectionId?: string,
      pushTarget?: GitPushTarget
    ) => Promise<GitUpstreamStatus | null>
  >()
const setUpstreamStatus = vi.fn()

function input(
  overrides: Partial<Parameters<typeof useSourceControlAutomaticUpstreamSnapshot>[0]> = {}
): Parameters<typeof useSourceControlAutomaticUpstreamSnapshot>[0] {
  return {
    enabled: true,
    settings: { activeRuntimeEnvironmentId: null },
    worktreeId: 'repo::/worktrees/feature',
    worktreePath: '/worktrees/feature',
    connectionId: null,
    sshConnectionState: null,
    branch: 'feature',
    fetchUpstreamStatus,
    setUpstreamStatus,
    ...overrides
  }
}

describe('useSourceControlAutomaticUpstreamSnapshot', () => {
  beforeEach(() => {
    mocks.loadSourceControlAutomaticUpstream.mockReset()
    fetchUpstreamStatus.mockReset()
    setUpstreamStatus.mockReset()
  })

  it('coalesces StrictMode effect re-entry for one exact visible context', async () => {
    const pending = deferred()
    mocks.loadSourceControlAutomaticUpstream.mockReturnValue(pending.promise)
    const hook = renderHook(() => useSourceControlAutomaticUpstreamSnapshot(input()), {
      wrapper: strictWrapper
    })

    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledOnce())
    pending.resolve()
    await act(async () => pending.promise)
    hook.unmount()
  })

  it.each([
    ['worktree', { worktreeId: 'repo::/worktrees/other' }],
    ['path', { worktreePath: '/worktrees/other' }],
    ['branch', { branch: 'other' }],
    ['connection', { connectionId: 'ssh-new' }],
    ['runtime target', { settings: { activeRuntimeEnvironmentId: 'runtime-new' } }],
    [
      'push target',
      {
        pushTarget: {
          remoteName: 'fork',
          branchName: 'feature',
          remoteCreated: false
        }
      }
    ]
  ] as const)('aborts and replaces an in-flight load after a %s change', async (_label, change) => {
    const first = deferred()
    const second = deferred()
    mocks.loadSourceControlAutomaticUpstream
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const hook = renderHook(({ value }) => useSourceControlAutomaticUpstreamSnapshot(value), {
      initialProps: { value: input() }
    })
    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledOnce())
    const firstRequest = mocks.loadSourceControlAutomaticUpstream.mock.calls[0][0].request

    hook.rerender({ value: input(change) })
    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledTimes(2))
    expect(firstRequest.shouldApply()).toBe(false)
    expect(firstRequest.signal.aborted).toBe(true)

    first.resolve()
    second.resolve()
    await act(async () => Promise.all([first.promise, second.promise]))
    hook.unmount()
  })

  it('replaces an in-flight load for a new provider incarnation on the same SSH target', async () => {
    const first = deferred()
    const second = deferred()
    mocks.loadSourceControlAutomaticUpstream
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const sshInput = (providerEpoch: string, connectionGeneration: number) =>
      input({
        connectionId: 'ssh-current',
        sshConnectionState: {
          providerEpoch: providerEpoch as SshProviderEpoch,
          connectionGeneration
        }
      })
    const hook = renderHook(({ value }) => useSourceControlAutomaticUpstreamSnapshot(value), {
      initialProps: { value: sshInput('provider-first', 1) }
    })
    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledOnce())
    const firstRequest = mocks.loadSourceControlAutomaticUpstream.mock.calls[0][0].request

    hook.rerender({ value: sshInput('provider-second', 2) })
    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledTimes(2))
    expect(firstRequest.shouldApply()).toBe(false)
    expect(firstRequest.signal.aborted).toBe(true)

    first.resolve()
    second.resolve()
    await act(async () => Promise.all([first.promise, second.promise]))
    hook.unmount()
  })

  it('invalidates immediately when hidden and starts again when visible', async () => {
    const first = deferred()
    const second = deferred()
    mocks.loadSourceControlAutomaticUpstream
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const hook = renderHook(
      ({ enabled }) => useSourceControlAutomaticUpstreamSnapshot(input({ enabled })),
      { initialProps: { enabled: true } }
    )
    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledOnce())
    const firstRequest = mocks.loadSourceControlAutomaticUpstream.mock.calls[0][0].request

    hook.rerender({ enabled: false })
    expect(firstRequest.shouldApply()).toBe(false)
    expect(firstRequest.signal.aborted).toBe(true)
    expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledOnce()

    hook.rerender({ enabled: true })
    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledTimes(2))
    first.resolve()
    second.resolve()
    await act(async () => Promise.all([first.promise, second.promise]))
    hook.unmount()
  })

  it('does not start for a folder-workspace-disabled context', () => {
    const hook = renderHook(() =>
      useSourceControlAutomaticUpstreamSnapshot(input({ enabled: false }))
    )
    expect(mocks.loadSourceControlAutomaticUpstream).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('preserves the automatic load for a detached branch identity', async () => {
    mocks.loadSourceControlAutomaticUpstream.mockResolvedValue('fresh')
    const hook = renderHook(() => useSourceControlAutomaticUpstreamSnapshot(input({ branch: '' })))

    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledOnce())
    expect(mocks.loadSourceControlAutomaticUpstream.mock.calls[0][0].context.branch).toBe('')
    hook.unmount()
  })

  it('suppresses a late completion after unmount', async () => {
    const pending = deferred()
    mocks.loadSourceControlAutomaticUpstream.mockReturnValue(pending.promise)
    const hook = renderHook(() => useSourceControlAutomaticUpstreamSnapshot(input()))
    await waitFor(() => expect(mocks.loadSourceControlAutomaticUpstream).toHaveBeenCalledOnce())
    const request = mocks.loadSourceControlAutomaticUpstream.mock.calls[0][0].request

    hook.unmount()
    await act(async () => undefined)
    expect(request.shouldApply()).toBe(false)
    expect(request.signal.aborted).toBe(true)

    pending.resolve()
    await act(async () => pending.promise)
  })
})
