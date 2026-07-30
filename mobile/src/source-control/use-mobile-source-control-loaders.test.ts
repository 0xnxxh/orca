import { createElement, StrictMode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcResponse } from '../transport/types'
import { useMobileSourceControlLoaders } from './use-mobile-source-control-loaders'

vi.mock('./mobile-branch-base-ref', () => ({
  resolveMobileBranchCompareBaseRef: vi.fn().mockResolvedValue(null)
}))

function ok(result: unknown): RpcResponse {
  return { id: 'r', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function failure(code: string, message: string): RpcResponse {
  return { id: 'r', ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

function repositorySnapshot() {
  const freshness = {
    state: 'fresh',
    generation: 2,
    currentGeneration: 2,
    revision: 5,
    identity: 'default-status'
  }
  return {
    repositoryIdentity: { head: 'snapshot', branch: 'feature/mobile' },
    status: { entries: [], retentionTruncated: false },
    conflicts: 'unknown',
    upstream: { hasUpstream: false, ahead: 0, behind: 0 },
    freshness: {
      repositoryIdentity: { ...freshness },
      status: { ...freshness },
      conflicts: { ...freshness },
      upstream: { ...freshness, identity: 'status:default-status' }
    }
  }
}

function freshStatus(head = 'fresh') {
  return {
    entries: [],
    conflictOperation: 'unknown',
    head,
    branch: 'feature/mobile',
    upstreamStatus: { hasUpstream: false, ahead: 0, behind: 0 }
  }
}

type HarnessProps = {
  client: RpcClient
  connState?: ConnectionState
  statusIdentityKey?: string
  worktreeId?: string
}

let captured: ReturnType<typeof useMobileSourceControlLoaders> | null = null

function Harness(props: HarnessProps): null {
  captured = useMobileSourceControlLoaders({
    client: props.client,
    connState: props.connState ?? 'connected',
    statusIdentityKey: props.statusIdentityKey ?? 'host-1\0wt-1',
    worktreeId: props.worktreeId ?? 'wt-1',
    setActionError: vi.fn()
  })
  return null
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useMobileSourceControlLoaders initial repository snapshot', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    captured = null
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (
        typeof args[0] !== 'string' ||
        (!args[0].includes('react-test-renderer is deprecated') &&
          !args[0].includes('The current testing environment is not configured'))
      ) {
        throw new Error(String(args[0]))
      }
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('coalesces the first connected StrictMode effect', async () => {
    const sendRequest = vi.fn(async () => ok(repositorySnapshot()))
    const client = { sendRequest } as unknown as RpcClient

    await act(async () => {
      renderer = create(createElement(StrictMode, null, createElement(Harness, { client })))
    })
    await flush()

    expect(sendRequest).toHaveBeenCalledOnce()
    expect(sendRequest).toHaveBeenCalledWith('git.repositorySnapshot', {
      worktree: 'id:wt-1'
    })
  })

  it('preserves the snapshot opportunity until an initially disconnected context connects', async () => {
    const sendRequest = vi.fn(async () => ok(repositorySnapshot()))
    const client = { sendRequest } as unknown as RpcClient

    await act(async () => {
      renderer = create(createElement(Harness, { client, connState: 'disconnected' }))
    })
    expect(sendRequest).not.toHaveBeenCalled()

    await act(async () => {
      renderer?.update(createElement(Harness, { client, connState: 'connected' }))
    })
    await flush()
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual(['git.repositorySnapshot'])
  })

  it('uses fresh status after reconnect and for retry, refresh, and forced mutation loads', async () => {
    const sendRequest = vi.fn(async (method: string) =>
      method === 'git.repositorySnapshot' ? ok(repositorySnapshot()) : ok(freshStatus())
    )
    const client = { sendRequest } as unknown as RpcClient

    await act(async () => {
      renderer = create(createElement(Harness, { client }))
    })
    await act(async () => {
      renderer?.update(createElement(Harness, { client, connState: 'disconnected' }))
    })
    await act(async () => {
      renderer?.update(createElement(Harness, { client, connState: 'connected' }))
    })
    await act(async () => {
      await captured?.loadStatus()
      await captured?.loadStatus({ preserveReadyOnFailure: true })
      await captured?.loadStatus({ force: true, preserveReadyOnFailure: true })
    })

    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'git.repositorySnapshot',
      'git.status',
      'git.status',
      'git.status',
      'git.status'
    ])
  })

  it('gives replacement host, worktree, and client contexts one new snapshot opportunity', async () => {
    const firstSend = vi.fn(async () => ok(repositorySnapshot()))
    const secondSend = vi.fn(async () => ok(repositorySnapshot()))
    const firstClient = { sendRequest: firstSend } as unknown as RpcClient
    const secondClient = { sendRequest: secondSend } as unknown as RpcClient

    await act(async () => {
      renderer = create(createElement(Harness, { client: firstClient }))
    })
    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          client: firstClient,
          statusIdentityKey: 'host-2\0wt-1'
        })
      )
    })
    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          client: firstClient,
          statusIdentityKey: 'host-2\0wt-2',
          worktreeId: 'wt-2'
        })
      )
    })
    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          client: secondClient,
          statusIdentityKey: 'host-2\0wt-2',
          worktreeId: 'wt-2'
        })
      )
    })

    expect(firstSend.mock.calls.map(([method]) => method)).toEqual([
      'git.repositorySnapshot',
      'git.repositorySnapshot',
      'git.repositorySnapshot'
    ])
    expect(secondSend.mock.calls.map(([method]) => method)).toEqual(['git.repositorySnapshot'])
  })

  it('suppresses a late snapshot after client replacement', async () => {
    let resolveFirstSnapshot!: (response: RpcResponse) => void
    const firstSend = vi.fn(
      () =>
        new Promise<RpcResponse>((resolve) => {
          resolveFirstSnapshot = resolve
        })
    )
    const secondSend = vi.fn(async () => ok(repositorySnapshot()))
    const firstClient = { sendRequest: firstSend } as unknown as RpcClient
    const secondClient = { sendRequest: secondSend } as unknown as RpcClient

    await act(async () => {
      renderer = create(createElement(Harness, { client: firstClient }))
    })
    await act(async () => {
      renderer?.update(createElement(Harness, { client: secondClient }))
    })
    await act(async () => {
      resolveFirstSnapshot(ok({ ...repositorySnapshot(), repositoryIdentity: { head: 'stale' } }))
      await Promise.resolve()
    })

    expect(captured?.screenState).toMatchObject({
      kind: 'ready',
      status: { head: 'snapshot' }
    })
    expect(firstSend).toHaveBeenCalledOnce()
    expect(secondSend).toHaveBeenCalledOnce()
  })

  it('preserves the existing unavailable screen copy after snapshot fallback', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(
        failure('method_not_found', 'Update Orca desktop to use Source Control on mobile.')
      )
    const client = { sendRequest } as unknown as RpcClient

    await act(async () => {
      renderer = create(createElement(Harness, { client }))
    })

    expect(captured?.screenState).toEqual({
      kind: 'unavailable',
      message: 'Update Orca desktop to use Source Control on mobile.'
    })
  })

  it('suppresses a late snapshot after a fresh load replaces it', async () => {
    let resolveSnapshot!: (response: RpcResponse) => void
    const sendRequest = vi.fn((method: string) =>
      method === 'git.repositorySnapshot'
        ? new Promise<RpcResponse>((resolve) => {
            resolveSnapshot = resolve
          })
        : Promise.resolve(ok(freshStatus('fresh-wins')))
    )
    const client = { sendRequest } as unknown as RpcClient

    await act(async () => {
      renderer = create(createElement(Harness, { client }))
    })
    await act(async () => {
      await captured?.loadStatus({ force: true })
    })
    await act(async () => {
      resolveSnapshot(ok(repositorySnapshot()))
      await Promise.resolve()
    })

    expect(captured?.screenState).toMatchObject({
      kind: 'ready',
      status: { head: 'fresh-wins' }
    })
    expect(sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'git.repositorySnapshot',
      'git.status'
    ])
  })

  it('suppresses a late snapshot after the mounted screen detaches', async () => {
    let resolveSnapshot!: (response: RpcResponse) => void
    const sendRequest = vi.fn(
      () =>
        new Promise<RpcResponse>((resolve) => {
          resolveSnapshot = resolve
        })
    )
    const client = { sendRequest } as unknown as RpcClient

    await act(async () => {
      renderer = create(createElement(Harness, { client }))
    })
    captured?.setRootRef(null)
    await act(async () => {
      resolveSnapshot(ok(repositorySnapshot()))
      await Promise.resolve()
    })

    expect(captured?.screenState).toEqual({ kind: 'loading' })
    expect(sendRequest).toHaveBeenCalledOnce()
  })
})
