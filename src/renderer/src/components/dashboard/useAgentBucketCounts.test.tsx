// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {
    repos: [],
    worktreesByRepo: {},
    tabsByWorktree: {},
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    runtimeAgentOrchestrationByPaneKey: {},
    terminalLayoutsByTabId: {},
    ptyIdsByTabId: {},
    runtimePaneTitlesByTabId: {},
    folderWorkspaces: [{ id: 'folder-1' }],
    agentStatusEpoch: 0
  },
  buildDashboardSnapshot: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

vi.mock('./build-dashboard-snapshot', () => ({
  buildDashboardSnapshot: mocks.buildDashboardSnapshot
}))

import { useAgentBucketCounts } from './useAgentBucketCounts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useAgentBucketCounts', () => {
  it('includes folder workspaces in the count snapshot inputs', () => {
    mocks.buildDashboardSnapshot.mockImplementation((state: { folderWorkspaces?: unknown[] }) => ({
      generatedAt: 1,
      cards: state.folderWorkspaces?.length ? [{ bucket: 'working' }] : []
    }))

    const { result } = renderHook(() => useAgentBucketCounts())

    expect(result.current).toEqual({ attention: 0, working: 1, done: 0, idle: 0 })
    expect(mocks.buildDashboardSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ folderWorkspaces: mocks.state.folderWorkspaces }),
      expect.any(Number),
      { includeCardDetails: false, includeFilterOptions: false }
    )
  })
})
