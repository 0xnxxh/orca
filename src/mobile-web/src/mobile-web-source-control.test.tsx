// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebSourceControl } from './mobile-web-source-control'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 24,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 24,
        size: 24
      }))
  })
}))

afterEach(cleanup)

describe('MobileWebSourceControl', () => {
  it('loads bounded status and revision-checked virtual diff pages', async () => {
    const client = sourceControlClient()
    render(
      createElement(MobileWebSourceControl, {
        client,
        workspaceId: 'workspace-1',
        connected: true
      })
    )

    expect(await screen.findByText('src/app.ts')).toBeDefined()
    expect(screen.getByText('mobile-rearch · 1 change')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Open diff for src/app.ts' }))

    expect(await screen.findByText('before')).toBeDefined()
    expect(screen.getByText('after')).toBeDefined()
    expect(screen.getByRole('list', { name: 'Diff rows' }).children[0]?.children).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Load more diff' }))

    expect(await screen.findByText('same')).toBeDefined()
    expect(client.sourceControlDiff).toHaveBeenLastCalledWith(
      {
        workspaceId: 'workspace-1',
        relativePath: 'src/app.ts',
        area: 'unstaged',
        offset: 2,
        limit: 96,
        expectedRevision: 'a'.repeat(64)
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(screen.queryByRole('button', { name: 'Load more diff' })).toBeNull()
  })

  it('aborts and drops delayed status when the workspace identity changes', async () => {
    let resolveFirst: ((value: ReturnType<typeof statusResult>) => void) | undefined
    const first = sourceControlClient()
    first.sourceControlStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveFirst = resolve
      })
    )
    const second = sourceControlClient()
    second.sourceControlStatus.mockResolvedValue(statusResult('workspace-2', []))
    const view = render(
      createElement(MobileWebSourceControl, {
        client: first,
        workspaceId: 'workspace-1',
        connected: true
      })
    )
    const firstSignal = first.sourceControlStatus.mock.calls[0]?.[1]?.signal as AbortSignal

    view.rerender(
      createElement(MobileWebSourceControl, {
        client: second,
        workspaceId: 'workspace-2',
        connected: true
      })
    )
    expect(firstSignal.aborted).toBe(true)
    resolveFirst?.(statusResult('workspace-1'))
    await Promise.resolve()

    expect(screen.queryByText('src/app.ts')).toBeNull()
    expect(await screen.findByText('No uncommitted changes.')).toBeDefined()
  })

  it('refreshes from watcher invalidations and retires stale workspace subscriptions', async () => {
    let onEvent: ((event: { workspaceId: string; reason: 'changed' }) => void) | undefined
    const unsubscribe = vi.fn()
    const first = sourceControlClient()
    first.sourceControlSubscribe.mockImplementation((_payload, nextEvent) => {
      onEvent = nextEvent
      return { ready: Promise.resolve(), unsubscribe }
    })
    const view = render(
      createElement(MobileWebSourceControl, {
        client: first,
        workspaceId: 'workspace-1',
        connected: true
      })
    )
    await screen.findByText('src/app.ts')

    onEvent?.({ workspaceId: 'workspace-1', reason: 'changed' })
    await waitFor(() => expect(first.sourceControlStatus).toHaveBeenCalledTimes(2))

    const second = sourceControlClient()
    second.sourceControlStatus.mockResolvedValue(statusResult('workspace-2', []))
    view.rerender(
      createElement(MobileWebSourceControl, {
        client: second,
        workspaceId: 'workspace-2',
        connected: true
      })
    )
    expect(unsubscribe).toHaveBeenCalledOnce()
    onEvent?.({ workspaceId: 'workspace-1', reason: 'changed' })
    await Promise.resolve()
    expect(first.sourceControlStatus).toHaveBeenCalledTimes(2)
  })
})

function sourceControlClient(): MobileWebBridgeClient & {
  sourceControlStatus: ReturnType<typeof vi.fn>
  sourceControlDiff: ReturnType<typeof vi.fn>
  sourceControlSubscribe: ReturnType<typeof vi.fn>
} {
  return {
    sourceControlStatus: vi.fn().mockResolvedValue(statusResult('workspace-1')),
    sourceControlSubscribe: vi.fn().mockReturnValue({
      ready: Promise.resolve(),
      unsubscribe: vi.fn()
    }),
    sourceControlBranches: vi
      .fn()
      .mockImplementation(({ workspaceId }) => Promise.resolve(emptyBranches(workspaceId))),
    sourceControlHistory: vi
      .fn()
      .mockImplementation(({ workspaceId }) => Promise.resolve(emptyHistory(workspaceId))),
    sourceControlUpstream: vi
      .fn()
      .mockImplementation(({ workspaceId }) => Promise.resolve(repositoryState(workspaceId))),
    sourceControlBranchCompare: vi.fn(),
    sourceControlCommitCompare: vi.fn(),
    sourceControlDiff: vi.fn().mockImplementation(({ offset }) => {
      if (offset === 0) {
        return Promise.resolve({
          workspaceId: 'workspace-1',
          relativePath: 'src/app.ts',
          area: 'unstaged',
          kind: 'text',
          revision: 'a'.repeat(64),
          offset: 0,
          totalRows: 3,
          rows: [
            {
              index: 0,
              kind: 'delete',
              text: 'before',
              textTruncated: false,
              oldLineNumber: 1
            },
            {
              index: 1,
              kind: 'add',
              text: 'after',
              textTruncated: false,
              newLineNumber: 1
            }
          ],
          nextOffset: 2,
          truncated: false
        })
      }
      return Promise.resolve({
        workspaceId: 'workspace-1',
        relativePath: 'src/app.ts',
        area: 'unstaged',
        kind: 'text',
        revision: 'a'.repeat(64),
        offset: 2,
        totalRows: 3,
        rows: [
          {
            index: 2,
            kind: 'context',
            text: 'same',
            textTruncated: false,
            oldLineNumber: 2,
            newLineNumber: 2
          }
        ],
        nextOffset: null,
        truncated: false
      })
    })
  } as unknown as MobileWebBridgeClient & {
    sourceControlStatus: ReturnType<typeof vi.fn>
    sourceControlDiff: ReturnType<typeof vi.fn>
    sourceControlSubscribe: ReturnType<typeof vi.fn>
  }
}

function statusResult(workspaceId: string, entries = [statusEntry()]) {
  return {
    workspaceId,
    branch: 'mobile-rearch',
    head: 'b'.repeat(40),
    conflictOperation: 'unknown' as const,
    entries,
    totalCount: entries.length,
    truncated: false
  }
}

function statusEntry() {
  return {
    relativePath: 'src/app.ts',
    status: 'modified' as const,
    area: 'unstaged' as const,
    added: 1,
    removed: 1
  }
}

function emptyBranches(workspaceId: string) {
  return { workspaceId, current: 'main', branches: ['main'], totalCount: 1, truncated: false }
}

function emptyHistory(workspaceId: string) {
  return {
    workspaceId,
    items: [],
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
