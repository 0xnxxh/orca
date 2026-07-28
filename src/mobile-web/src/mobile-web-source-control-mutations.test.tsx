// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebSourceControlStatusEntry } from '../../shared/mobile-web/source-control-operation-contract'
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

describe('MobileWebSourceControl mutations', () => {
  it('stages and unstages a single provider-neutral status snapshot', async () => {
    const client = mutationClient()
    client.sourceControlStatus
      .mockResolvedValueOnce(statusResult('workspace-1', [entry('unstaged')]))
      .mockResolvedValueOnce(statusResult('workspace-1', [entry('staged')]))
      .mockResolvedValue(statusResult('workspace-1', [entry('unstaged')]))
    renderSourceControl(client)

    fireEvent.click(await screen.findByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(client.sourceControlStage).toHaveBeenCalledOnce())
    expect(client.sourceControlStage).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        expectedHead: 'b'.repeat(40),
        entries: [{ relativePath: 'src/app.ts', status: 'modified', area: 'unstaged' }]
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Unstage' }))
    await waitFor(() => expect(client.sourceControlUnstage).toHaveBeenCalledOnce())
    expect(client.sourceControlUnstage).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        expectedHead: 'b'.repeat(40),
        entries: [{ relativePath: 'src/app.ts', status: 'modified', area: 'staged' }]
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('bounds bulk stage and unstage requests to the negotiated mutation limit', async () => {
    const client = mutationClient()
    const entries = [
      ...Array.from({ length: 34 }, (_, index) => entry('unstaged', `src/unstaged-${index}.ts`)),
      ...Array.from({ length: 34 }, (_, index) => entry('staged', `src/staged-${index}.ts`))
    ]
    client.sourceControlStatus.mockResolvedValue(statusResult('workspace-1', entries))
    renderSourceControl(client)

    fireEvent.click(await screen.findByRole('button', { name: 'Stage 32' }))
    await waitFor(() => expect(client.sourceControlStage).toHaveBeenCalledOnce())
    expect(client.sourceControlStage.mock.calls[0]?.[0].entries).toHaveLength(32)

    fireEvent.click(screen.getByRole('button', { name: 'Unstage 32' }))
    await waitFor(() => expect(client.sourceControlUnstage).toHaveBeenCalledOnce())
    expect(client.sourceControlUnstage.mock.calls[0]?.[0].entries).toHaveLength(32)
  })

  it('requires a visible confirmation before sending discard', async () => {
    const client = mutationClient()
    renderSourceControl(client)

    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(client.sourceControlDiscard).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Discard change?')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(client.sourceControlDiscard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(client.sourceControlDiscard).toHaveBeenCalledOnce())
    expect(client.sourceControlDiscard).toHaveBeenCalledWith(
      expect.objectContaining({ confirmation: 'discard-confirmed' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('surfaces repository conflicts and refreshes status', async () => {
    const client = mutationClient()
    client.sourceControlStage.mockRejectedValue(new MobileWebBridgeClientError('conflict', true))
    renderSourceControl(client)

    fireEvent.click(await screen.findByRole('button', { name: 'Stage' }))
    expect(
      await screen.findByText(
        'The repository changed. Review the refreshed status before trying again.'
      )
    ).toBeDefined()
    await waitFor(() => expect(client.sourceControlStatus).toHaveBeenCalledTimes(2))
  })

  it('aborts an in-flight mutation when client and workspace identity change', async () => {
    let resolveMutation: (() => void) | undefined
    const first = mutationClient()
    first.sourceControlStage.mockReturnValue(
      new Promise((resolve) => {
        resolveMutation = () => resolve(mutationResult('stage', ['src/app.ts']))
      })
    )
    const view = renderSourceControl(first)

    fireEvent.click(await screen.findByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(first.sourceControlStage).toHaveBeenCalledOnce())
    const signal = first.sourceControlStage.mock.calls[0]?.[1]?.signal as AbortSignal
    const second = mutationClient('workspace-2')
    view.rerender(
      createElement(MobileWebSourceControl, {
        client: second,
        workspaceId: 'workspace-2',
        connected: true
      })
    )

    expect(signal.aborted).toBe(true)
    resolveMutation?.()
    await Promise.resolve()
    expect(first.sourceControlStatus).toHaveBeenCalledOnce()
    expect(await screen.findByText('src/app.ts')).toBeDefined()
  })
})

type MockBridgeClient = MobileWebBridgeClient &
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
    | 'sourceControlDiscard',
    ReturnType<typeof vi.fn>
  >

function mutationClient(workspaceId = 'workspace-1'): MockBridgeClient {
  return {
    sourceControlStatus: vi.fn().mockResolvedValue(statusResult(workspaceId, [entry('unstaged')])),
    sourceControlSubscribe: vi.fn().mockReturnValue({
      ready: Promise.resolve(),
      unsubscribe: vi.fn()
    }),
    sourceControlDiff: vi.fn(),
    sourceControlBranches: vi.fn().mockResolvedValue(emptyBranches(workspaceId)),
    sourceControlHistory: vi.fn().mockResolvedValue(emptyHistory(workspaceId)),
    sourceControlUpstream: vi.fn().mockResolvedValue(repositoryState(workspaceId)),
    sourceControlBranchCompare: vi.fn(),
    sourceControlCommitCompare: vi.fn(),
    sourceControlStage: vi.fn().mockResolvedValue(mutationResult('stage', ['src/app.ts'])),
    sourceControlUnstage: vi.fn().mockResolvedValue(mutationResult('unstage', ['src/app.ts'])),
    sourceControlDiscard: vi.fn().mockResolvedValue(mutationResult('discard', ['src/app.ts']))
  } as unknown as MockBridgeClient
}

function renderSourceControl(client: MockBridgeClient) {
  return render(
    createElement(MobileWebSourceControl, {
      client,
      workspaceId: 'workspace-1',
      connected: true
    })
  )
}

function statusResult(workspaceId: string, entries: MobileWebSourceControlStatusEntry[]) {
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

function entry(
  area: MobileWebSourceControlStatusEntry['area'],
  relativePath = 'src/app.ts'
): MobileWebSourceControlStatusEntry {
  return { relativePath, status: 'modified', area }
}

function mutationResult(operation: 'stage' | 'unstage' | 'discard', relativePaths: string[]) {
  return {
    workspaceId: 'workspace-1',
    operation,
    relativePaths,
    mutated: true as const
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
