import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import { useAgentRowConversationName } from './use-agent-row-conversation-name'
import type { DashboardAgentRow } from './useDashboardData'

const storeState = vi.hoisted(() => ({
  current: { settings: {}, tabsByWorktree: {} } as {
    settings: Record<string, unknown>
    tabsByWorktree: Record<string, unknown[]>
  }
}))

// Why: the mocked selector makes the hook a pure function, so tests can call it
// directly without mounting a component.
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: AppState) => unknown) =>
    selector(storeState.current as unknown as AppState)
}))

function makeAgent(overrides: Partial<DashboardAgentRow> = {}): DashboardAgentRow {
  return {
    paneKey: 'tab-1:leaf-1',
    entry: { prompt: 'fix the sidebar' },
    tab: { id: 'tab-1', worktreeId: 'wt-1', customTitle: 'Patient sync spike', title: '' },
    agentType: 'claude',
    state: 'working',
    startedAt: 0,
    ...overrides
  } as DashboardAgentRow
}

beforeEach(() => {
  storeState.current = { settings: {}, tabsByWorktree: {} }
})

describe('useAgentRowConversationName', () => {
  it('returns null while the setting is off', () => {
    expect(useAgentRowConversationName(makeAgent())).toBeNull()
  })

  it('returns the conversation name when the setting is on', () => {
    storeState.current = { settings: { agentRowsUseConversationName: true }, tabsByWorktree: {} }
    expect(useAgentRowConversationName(makeAgent())).toBe('Patient sync spike')
  })

  it('never renames subagent child rows after the parent tab', () => {
    storeState.current = { settings: { agentRowsUseConversationName: true }, tabsByWorktree: {} }
    expect(useAgentRowConversationName(makeAgent({ rowSource: 'subagent' }))).toBeNull()
  })

  it('prefers the live store tab over the stale row snapshot', () => {
    storeState.current = {
      settings: { agentRowsUseConversationName: true },
      // Why: row data patches entries in place and keeps the creation-time tab
      // snapshot; a rename landing after that must still surface.
      tabsByWorktree: {
        'wt-1': [{ id: 'tab-1', worktreeId: 'wt-1', customTitle: 'Renamed later', title: '' }]
      }
    }
    expect(useAgentRowConversationName(makeAgent())).toBe('Renamed later')
  })

  it('honors the generated-titles setting for generated names', () => {
    const agent = makeAgent({
      tab: { customTitle: null, title: '', generatedTitle: 'Fix intake flow' }
    } as Partial<DashboardAgentRow>)
    storeState.current = { settings: { agentRowsUseConversationName: true }, tabsByWorktree: {} }
    expect(useAgentRowConversationName(agent)).toBeNull()
    storeState.current = {
      settings: { agentRowsUseConversationName: true, tabAutoGenerateTitle: true },
      tabsByWorktree: {}
    }
    expect(useAgentRowConversationName(agent)).toBe('Fix intake flow')
  })
})
