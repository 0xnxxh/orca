import { createElement, StrictMode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { ReviewScreenState } from './mobile-diff-review-screen-model'

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  loadDiff: vi.fn(),
  interactionInput: null as Record<string, unknown> | null
}))

vi.mock('./mobile-diff-review-loaders', () => ({
  loadMobileDiffReviewSnapshot: (...args: unknown[]) => mocks.loadSnapshot(...args),
  loadMobileDiffReviewDiff: (...args: unknown[]) => mocks.loadDiff(...args)
}))

vi.mock('./use-mobile-diff-review-interactions', () => ({
  useMobileDiffReviewInteractions: (input: Record<string, unknown>) => {
    mocks.interactionInput = input
    return {}
  }
}))

vi.mock('./use-mobile-pr-sidebar-controller', () => ({
  useMobilePrSidebarController: () => ({})
}))

import { useMobileDiffReviewController } from './use-mobile-diff-review-controller'

let captured: ReturnType<typeof useMobileDiffReviewController> | null = null
const client = { sendRequest: vi.fn() } as unknown as RpcClient

function ready(head: string): ReviewScreenState {
  return {
    kind: 'ready',
    status: { entries: [], conflictOperation: 'unknown', head, branch: 'feature/mobile' },
    branchCompare: null,
    comments: [],
    reviewState: { version: 1, files: {} }
  }
}

function Harness(props: {
  hostId: string
  worktreeId: string
  client: RpcClient
  connState?: ConnectionState
}) {
  captured = useMobileDiffReviewController({
    client: props.client,
    connState: props.connState ?? 'connected',
    hostId: props.hostId,
    worktreeId: props.worktreeId,
    name: 'Worktree',
    initialFilter: 'all',
    initialTarget: null,
    onOpenSession: vi.fn(),
    onReconnect: vi.fn()
  })
  return null
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useMobileDiffReviewController initial snapshot load', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    captured = null
    mocks.interactionInput = null
    mocks.loadSnapshot.mockReset()
    mocks.loadDiff.mockReset()
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

  it('coalesces StrictMode effect re-entry and keeps later reloads fresh', async () => {
    mocks.loadSnapshot.mockResolvedValue(ready('initial'))
    await act(async () => {
      renderer = create(
        createElement(
          StrictMode,
          null,
          createElement(Harness, { hostId: 'host-1', worktreeId: 'wt-1', client })
        )
      )
    })
    await flush()

    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.loadSnapshot).toHaveBeenCalledWith(client, 'wt-1', {
      preferRepositorySnapshot: true
    })

    const reload = mocks.interactionInput?.loadReviewData as () => Promise<void>
    await act(async () => {
      await reload()
    })
    expect(mocks.loadSnapshot).toHaveBeenNthCalledWith(2, client, 'wt-1', {
      preferRepositorySnapshot: false
    })
  })

  it('preserves the initial snapshot opportunity until the first connected load', async () => {
    mocks.loadSnapshot.mockResolvedValue(ready('connected'))
    await act(async () => {
      renderer = create(
        createElement(Harness, {
          hostId: 'host-1',
          worktreeId: 'wt-1',
          client,
          connState: 'disconnected'
        })
      )
    })
    expect(mocks.loadSnapshot).not.toHaveBeenCalled()

    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          hostId: 'host-1',
          worktreeId: 'wt-1',
          client,
          connState: 'connected'
        })
      )
    })
    await flush()
    expect(mocks.loadSnapshot).toHaveBeenCalledOnce()
    expect(mocks.loadSnapshot).toHaveBeenCalledWith(client, 'wt-1', {
      preferRepositorySnapshot: true
    })
  })

  it('uses fresh status after a connected context reconnects', async () => {
    mocks.loadSnapshot.mockResolvedValue(ready('connected'))
    await act(async () => {
      renderer = create(
        createElement(Harness, {
          hostId: 'host-1',
          worktreeId: 'wt-1',
          client,
          connState: 'connected'
        })
      )
    })
    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          hostId: 'host-1',
          worktreeId: 'wt-1',
          client,
          connState: 'disconnected'
        })
      )
    })
    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          hostId: 'host-1',
          worktreeId: 'wt-1',
          client,
          connState: 'connected'
        })
      )
    })
    await flush()

    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(2)
    expect(mocks.loadSnapshot).toHaveBeenNthCalledWith(1, client, 'wt-1', {
      preferRepositorySnapshot: true
    })
    expect(mocks.loadSnapshot).toHaveBeenNthCalledWith(2, client, 'wt-1', {
      preferRepositorySnapshot: false
    })
  })

  it('suppresses a late initial result after context replacement', async () => {
    let resolveFirst!: (state: ReviewScreenState) => void
    mocks.loadSnapshot.mockImplementation((_client: RpcClient, worktreeId: string) =>
      worktreeId === 'wt-1'
        ? new Promise<ReviewScreenState>((resolve) => {
            resolveFirst = resolve
          })
        : Promise.resolve(ready('second'))
    )
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-1', worktreeId: 'wt-1', client }))
    })
    await act(async () => {
      renderer?.update(createElement(Harness, { hostId: 'host-2', worktreeId: 'wt-2', client }))
    })
    await flush()
    expect(mocks.loadSnapshot).toHaveBeenNthCalledWith(2, client, 'wt-2', {
      preferRepositorySnapshot: true
    })
    expect(captured?.screenState.kind).toBe('ready')
    if (captured?.screenState.kind === 'ready') {
      expect(captured.screenState.status.head).toBe('second')
    }

    await act(async () => {
      resolveFirst(ready('late-first'))
      await Promise.resolve()
    })
    if (captured?.screenState.kind === 'ready') {
      expect(captured.screenState.status.head).toBe('second')
    }
  })

  it('suppresses a late initial result after client replacement', async () => {
    let resolveFirst!: (state: ReviewScreenState) => void
    const nextClient = { sendRequest: vi.fn() } as unknown as RpcClient
    mocks.loadSnapshot.mockImplementation((requestClient: RpcClient) =>
      requestClient === client
        ? new Promise<ReviewScreenState>((resolve) => {
            resolveFirst = resolve
          })
        : Promise.resolve(ready('next-client'))
    )
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-1', worktreeId: 'wt-1', client }))
    })
    await act(async () => {
      renderer?.update(
        createElement(Harness, { hostId: 'host-1', worktreeId: 'wt-1', client: nextClient })
      )
    })
    await flush()
    expect(mocks.loadSnapshot).toHaveBeenNthCalledWith(2, nextClient, 'wt-1', {
      preferRepositorySnapshot: true
    })
    if (captured?.screenState.kind === 'ready') {
      expect(captured.screenState.status.head).toBe('next-client')
    }

    await act(async () => {
      resolveFirst(ready('late-first-client'))
      await Promise.resolve()
    })
    if (captured?.screenState.kind === 'ready') {
      expect(captured.screenState.status.head).toBe('next-client')
    }
  })

  it('suppresses a late initial result after a fresh reload', async () => {
    let resolveInitial!: (state: ReviewScreenState) => void
    mocks.loadSnapshot.mockImplementation(
      (_client: RpcClient, _worktreeId: string, options: { preferRepositorySnapshot: boolean }) =>
        options.preferRepositorySnapshot
          ? new Promise<ReviewScreenState>((resolve) => {
              resolveInitial = resolve
            })
          : Promise.resolve(ready('fresh-reload'))
    )
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-1', worktreeId: 'wt-1', client }))
    })

    const reload = mocks.interactionInput?.loadReviewData as () => Promise<void>
    await act(async () => {
      await reload()
    })
    if (captured?.screenState.kind === 'ready') {
      expect(captured.screenState.status.head).toBe('fresh-reload')
    }

    await act(async () => {
      resolveInitial(ready('late-initial'))
      await Promise.resolve()
    })
    if (captured?.screenState.kind === 'ready') {
      expect(captured.screenState.status.head).toBe('fresh-reload')
    }
  })
})
