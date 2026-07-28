// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { MobileWebSourceControl } from './mobile-web-source-control'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => []
  })
}))

afterEach(cleanup)

describe('MobileWebSourceControl commit', () => {
  it('generates and commits against the exact visible staged snapshot', async () => {
    const client = commitClient()
    renderSourceControl(client)

    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await waitFor(() => {
      const input = screen.getByRole('textbox', { name: 'Commit message' }) as HTMLInputElement
      expect(input.value).toBe('feat: generated')
    })
    expect(client.sourceControlGenerateCommitMessage).toHaveBeenCalledWith(
      commitSnapshot(),
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 70_000 })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => expect(client.sourceControlCommit).toHaveBeenCalledOnce())
    expect(client.sourceControlCommit).toHaveBeenCalledWith(
      { ...commitSnapshot(), message: 'feat: generated' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    await waitFor(() => expect(client.sourceControlStatus).toHaveBeenCalledTimes(2))
  })

  it('cancels generation locally and requests host cancellation', async () => {
    const client = commitClient()
    let resolveGeneration: ((value: unknown) => void) | undefined
    client.sourceControlGenerateCommitMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveGeneration = resolve
      })
    )
    renderSourceControl(client)

    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    const signal = client.sourceControlGenerateCommitMessage.mock.calls[0]?.[1]
      ?.signal as AbortSignal
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(signal.aborted).toBe(true)
    await waitFor(() =>
      expect(client.sourceControlCancelCommitMessageGeneration).toHaveBeenCalledWith({
        workspaceId: 'workspace-1'
      })
    )
    resolveGeneration?.({
      workspaceId: 'workspace-1',
      previousHead: 'a'.repeat(40),
      status: 'generated',
      message: 'late draft'
    })
    await Promise.resolve()
    const input = screen.getByRole('textbox', { name: 'Commit message' }) as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('refreshes and explains a repository conflict without committing', async () => {
    const client = commitClient()
    client.sourceControlCommit.mockRejectedValue(new MobileWebBridgeClientError('conflict', true))
    renderSourceControl(client)
    const input = await screen.findByRole('textbox', { name: 'Commit message' })
    fireEvent.change(input, { target: { value: 'feat: stale' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    expect(
      await screen.findByText(
        'The repository changed. Review the refreshed status before trying again.'
      )
    ).toBeDefined()
    await waitFor(() => expect(client.sourceControlStatus).toHaveBeenCalledTimes(2))
  })
})

type MockCommitClient = MobileWebBridgeClient &
  Record<
    | 'sourceControlStatus'
    | 'sourceControlSubscribe'
    | 'sourceControlDiff'
    | 'sourceControlBranches'
    | 'sourceControlHistory'
    | 'sourceControlBranchCompare'
    | 'sourceControlCommitCompare'
    | 'sourceControlUpstream'
    | 'sourceControlStage'
    | 'sourceControlUnstage'
    | 'sourceControlDiscard'
    | 'sourceControlCommit'
    | 'sourceControlGenerateCommitMessage'
    | 'sourceControlCancelCommitMessageGeneration',
    ReturnType<typeof vi.fn>
  >

function commitClient(): MockCommitClient {
  return {
    sourceControlStatus: vi.fn().mockResolvedValue(statusResult()),
    sourceControlSubscribe: vi.fn().mockReturnValue({
      ready: Promise.resolve(),
      unsubscribe: vi.fn()
    }),
    sourceControlDiff: vi.fn(),
    sourceControlBranches: vi.fn().mockResolvedValue(emptyBranches()),
    sourceControlHistory: vi.fn().mockResolvedValue(emptyHistory()),
    sourceControlUpstream: vi.fn().mockResolvedValue(repositoryState()),
    sourceControlBranchCompare: vi.fn(),
    sourceControlCommitCompare: vi.fn(),
    sourceControlStage: vi.fn(),
    sourceControlUnstage: vi.fn(),
    sourceControlDiscard: vi.fn(),
    sourceControlCommit: vi.fn().mockResolvedValue({
      workspaceId: 'workspace-1',
      previousHead: 'a'.repeat(40),
      status: 'committed',
      head: 'b'.repeat(40)
    }),
    sourceControlGenerateCommitMessage: vi.fn().mockResolvedValue({
      workspaceId: 'workspace-1',
      previousHead: 'a'.repeat(40),
      status: 'generated',
      message: 'feat: generated'
    }),
    sourceControlCancelCommitMessageGeneration: vi.fn().mockResolvedValue({
      workspaceId: 'workspace-1',
      cancellationRequested: true
    })
  } as unknown as MockCommitClient
}

function renderSourceControl(client: MockCommitClient) {
  return render(
    createElement(MobileWebSourceControl, {
      client,
      workspaceId: 'workspace-1',
      connected: true
    })
  )
}

function commitSnapshot() {
  return {
    workspaceId: 'workspace-1',
    expectedHead: 'a'.repeat(40),
    stagedEntries: [{ relativePath: 'src/app.ts', status: 'modified', area: 'staged' }]
  }
}

function statusResult() {
  return {
    workspaceId: 'workspace-1',
    branch: 'mobile-rearch',
    head: 'a'.repeat(40),
    conflictOperation: 'unknown' as const,
    entries: [{ relativePath: 'src/app.ts', status: 'modified' as const, area: 'staged' as const }],
    totalCount: 1,
    truncated: false
  }
}

function emptyBranches() {
  return {
    workspaceId: 'workspace-1',
    current: 'main',
    branches: ['main'],
    totalCount: 1,
    truncated: false
  }
}

function emptyHistory() {
  return {
    workspaceId: 'workspace-1',
    items: [],
    hasIncomingChanges: false,
    hasOutgoingChanges: false,
    hasMore: false,
    limit: 50
  }
}

function repositoryState() {
  return {
    workspaceId: 'workspace-1',
    head: 'a'.repeat(40),
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
