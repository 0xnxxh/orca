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
  it('returns null without reading the tab map while the setting is off', () => {
    const tabsByWorktree = new Proxy(
      {},
      {
        get: () => {
          throw new Error('inactive rows must not read the tab map')
        }
      }
    )
    storeState.current = { settings: {}, tabsByWorktree }
    expect(useAgentRowConversationName(makeAgent())).toBeNull()
  })

  it('returns the conversation name when the setting is on', () => {
    storeState.current = { settings: { agentRowsUseConversationName: true }, tabsByWorktree: {} }
    expect(useAgentRowConversationName(makeAgent())).toBe('Patient sync spike')
  })

  it('never reads the parent tab for subagent child rows', () => {
    const tabsByWorktree = new Proxy(
      {},
      {
        get: () => {
          throw new Error('subagent rows must not read the parent tab')
        }
      }
    )
    storeState.current = { settings: { agentRowsUseConversationName: true }, tabsByWorktree }
    expect(useAgentRowConversationName(makeAgent({ rowSource: 'subagent' }))).toBeNull()
  })

  it('indexes one immutable tab array once across rows', () => {
    let tabReads = 0
    const tabs = new Proxy(
      [
        { id: 'tab-1', worktreeId: 'wt-1', customTitle: 'First name', title: '' },
        { id: 'tab-2', worktreeId: 'wt-1', customTitle: 'Second name', title: '' }
      ],
      {
        get: (target, property, receiver) => {
          if (typeof property === 'string' && /^\d+$/.test(property)) {
            tabReads += 1
          }
          return Reflect.get(target, property, receiver)
        }
      }
    )
    storeState.current = {
      settings: { agentRowsUseConversationName: true },
      tabsByWorktree: { 'wt-1': tabs }
    }

    expect(useAgentRowConversationName(makeAgent())).toBe('First name')
    const readsAfterFirstRow = tabReads
    expect(
      useAgentRowConversationName(
        makeAgent({
          paneKey: 'tab-2:leaf-1',
          tab: { id: 'tab-2', worktreeId: 'wt-1', customTitle: null, title: '' }
        } as Partial<DashboardAgentRow>)
      )
    ).toBe('Second name')
    expect(readsAfterFirstRow).toBeGreaterThan(0)
    expect(tabReads).toBe(readsAfterFirstRow)
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
