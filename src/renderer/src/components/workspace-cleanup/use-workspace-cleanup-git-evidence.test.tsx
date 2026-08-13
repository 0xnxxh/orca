// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceCleanupScanResult } from '../../../../shared/workspace-cleanup'
import { makeFacetCandidate } from './workspace-cleanup-facet.test.fixture'
import { useWorkspaceCleanupGitEvidence } from './use-workspace-cleanup-git-evidence'

const holders = vi.hoisted(() => ({ scan: vi.fn() }))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { scanWorkspaceCleanup: typeof holders.scan }) => unknown) =>
    selector({ scanWorkspaceCleanup: holders.scan })
}))

type PendingScan = {
  worktreeId: string
  resolve: (result: WorkspaceCleanupScanResult) => void
}

function deferredCandidate(worktreeId: string) {
  return makeFacetCandidate({
    worktreeId,
    git: { clean: null, upstreamAhead: null, upstreamBehind: null, checkedAt: null }
  })
}

describe('useWorkspaceCleanupGitEvidence', () => {
  let pending: PendingScan[]

  beforeEach(() => {
    pending = []
    holders.scan.mockReset()
    holders.scan.mockImplementation(({ worktreeId }: { worktreeId: string }) => {
      return new Promise<WorkspaceCleanupScanResult>((resolve) => {
        pending.push({ worktreeId, resolve })
      })
    })
  })

  it('bounds restarted passes and isolates them from stale settlements', async () => {
    const candidates = ['a', 'b', 'c', 'd', 'e', 'f'].map(deferredCandidate)
    const view = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useWorkspaceCleanupGitEvidence({ enabled, candidates, scannedAt: 1 }),
      { initialProps: { enabled: true } }
    )

    await waitFor(() => expect(view.result.current.totalCount).toBe(6))
    expect(view.result.current.pendingWorktreeIds.size).toBe(6)
    expect(holders.scan).toHaveBeenCalledTimes(4)

    view.rerender({ enabled: false })
    await waitFor(() => expect(view.result.current.pendingWorktreeIds.size).toBe(0))
    view.rerender({ enabled: true })
    await waitFor(() => expect(view.result.current.pendingWorktreeIds.size).toBe(6))
    expect(holders.scan).toHaveBeenCalledTimes(4)
    expect(view.result.current.pendingWorktreeIds.size).toBe(6)

    await act(async () => {
      pending[0]?.resolve({
        scannedAt: 2,
        candidates: [makeFacetCandidate({ worktreeId: pending[0].worktreeId })],
        errors: []
      })
    })
    await waitFor(() => expect(holders.scan).toHaveBeenCalledTimes(5))
    expect(view.result.current.pendingWorktreeIds.size).toBe(6)
    expect(view.result.current.evidenceByWorktreeId.size).toBe(0)

    await act(async () => {
      pending[4]?.resolve({
        scannedAt: 3,
        candidates: [makeFacetCandidate({ worktreeId: pending[4].worktreeId })],
        errors: []
      })
    })
    await waitFor(() => expect(view.result.current.evidenceByWorktreeId.size).toBe(1))
    expect(view.result.current.pendingWorktreeIds.size).toBe(5)
  })

  it('restarts evidence collection when the settled scan snapshot changes', async () => {
    const candidates = [deferredCandidate('a')]
    const view = renderHook(
      ({ scannedAt }: { scannedAt: number }) =>
        useWorkspaceCleanupGitEvidence({ enabled: true, candidates, scannedAt }),
      { initialProps: { scannedAt: 1 } }
    )

    await waitFor(() => expect(holders.scan).toHaveBeenCalledTimes(1))
    view.rerender({ scannedAt: 2 })
    expect(holders.scan).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending[0]?.resolve({
        scannedAt: 1,
        candidates: [makeFacetCandidate({ worktreeId: 'a' })],
        errors: []
      })
    })
    await waitFor(() => expect(holders.scan).toHaveBeenCalledTimes(2))
    expect(view.result.current.evidenceByWorktreeId.size).toBe(0)
    expect(view.result.current.pendingWorktreeIds).toEqual(new Set(['a']))

    await act(async () => {
      pending[1]?.resolve({
        scannedAt: 2,
        candidates: [makeFacetCandidate({ worktreeId: 'a' })],
        errors: []
      })
    })
    await waitFor(() => expect(view.result.current.evidenceByWorktreeId.size).toBe(1))
  })
})
