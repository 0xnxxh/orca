import { expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/runtime/sync-runtime-graph', () => ({ scheduleRuntimeGraphSync: vi.fn() }))
vi.mock('@/components/terminal-pane/pty-transport', () => ({
  registerEagerPtyBuffer: vi.fn(),
  ensurePtyDispatcher: vi.fn()
}))

// @ts-expect-error -- mocked browser preload API
globalThis.window = { api: {} }

import type { WorkspaceSessionState } from '../../../../shared/types'
import { getDefaultWorkspaceSession } from '../../../../shared/constants'
import { buildWorkspaceSessionPayload } from '../../lib/workspace-session'
import { createTestStore, makeTab, makeWorktree, seedStore } from './store-test-helpers'

it('hydrates host-owned parked fact identity without echoing it from renderer persistence', () => {
  const store = createTestStore()
  const worktreeId = 'repo1::/wt-side-effect-identity'
  const tabId = 'tab-side-effect-identity'
  const leafId = '11111111-1111-4111-8111-111111111111'
  const paneKey = `${tabId}:${leafId}`
  seedStore(store, {
    worktreesByRepo: {
      repo1: [makeWorktree({ id: worktreeId, repoId: 'repo1', path: '/wt-side-effect-identity' })]
    }
  })
  const session: WorkspaceSessionState = {
    ...getDefaultWorkspaceSession(),
    activeRepoId: 'repo1',
    activeWorktreeId: worktreeId,
    activeTabId: tabId,
    tabsByWorktree: {
      [worktreeId]: [makeTab({ id: tabId, worktreeId, ptyId: 'pty-1', generation: 6 })]
    },
    terminalLayoutsByTabId: {
      [tabId]: {
        root: { type: 'leaf', leafId },
        activeLeafId: leafId,
        expandedLeafId: null,
        ptyIdsByLeafId: { [leafId]: 'pty-1' }
      }
    },
    terminalPtyIncarnationsByPaneKey: {
      [paneKey]: '22222222-2222-4222-8222-222222222222',
      'unknown-tab:33333333-3333-4333-8333-333333333333': '44444444-4444-4444-8444-444444444444'
    }
  }

  store.getState().hydrateWorkspaceSession(session)

  expect(store.getState().hostTerminalSideEffectIdentityByPaneKey).toEqual({
    [paneKey]: {
      incarnationId: '22222222-2222-4222-8222-222222222222',
      paneGeneration: 6
    }
  })
  expect(buildWorkspaceSessionPayload(store.getState())).not.toHaveProperty(
    'terminalPtyIncarnationsByPaneKey'
  )
})
