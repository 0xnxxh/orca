// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'

const mocks = vi.hoisted(() => ({
  useLiveDashboardSnapshot: vi.fn(() => ({ generatedAt: 1, cards: [] }))
}))

vi.mock('./useLiveDashboardSnapshot', () => ({
  useLiveDashboardSnapshot: mocks.useLiveDashboardSnapshot
}))

vi.mock('../dashboard-popout/AgentKanbanBoard', () => ({
  AgentKanbanBoard: () => null
}))

vi.mock('./AgentDashboardSettingsMenu', () => ({
  AgentDashboardSettingsMenu: () => null
}))

vi.mock('../sidebar/use-workspace-kanban-outside-dismiss', () => ({
  isWorkspaceBoardKeepOpenTarget: () => false,
  useWorkspaceKanbanOutsideDismiss: () => undefined
}))

import { AgentDashboardDrawer } from './AgentDashboardDrawer'

const initialState = useAppStore.getInitialState()

beforeEach(() => {
  useAppStore.setState(
    {
      agentDashboardDrawerOpen: false,
      sidebarOpen: true,
      sidebarWidth: 320
    },
    false
  )
  mocks.useLiveDashboardSnapshot.mockClear()
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

describe('AgentDashboardDrawer', () => {
  it('derives no dashboard snapshot while closed', () => {
    render(<AgentDashboardDrawer statusBarVisible />)

    expect(mocks.useLiveDashboardSnapshot).not.toHaveBeenCalled()

    act(() => useAppStore.setState({ agentDashboardDrawerOpen: true }))
    expect(mocks.useLiveDashboardSnapshot).toHaveBeenCalledTimes(1)
  })
})
