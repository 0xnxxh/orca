import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import { useAgentRowConversationName } from './use-agent-row-conversation-name'
import type { DashboardAgentRow } from './useDashboardData'

const storeState = vi.hoisted(() => ({
  current: { settings: {} } as { current?: unknown; settings: Record<string, unknown> }
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
    tab: { customTitle: 'Patient sync spike', title: '' },
    agentType: 'claude',
    state: 'working',
    startedAt: 0,
    ...overrides
  } as DashboardAgentRow
}

beforeEach(() => {
  storeState.current = { settings: {} }
})

describe('useAgentRowConversationName', () => {
  it('returns null while the setting is off', () => {
    expect(useAgentRowConversationName(makeAgent())).toBeNull()
  })

  it('returns the conversation name when the setting is on', () => {
    storeState.current = { settings: { agentRowsUseConversationName: true } }
    expect(useAgentRowConversationName(makeAgent())).toBe('Patient sync spike')
  })

  it('never renames subagent child rows after the parent tab', () => {
    storeState.current = { settings: { agentRowsUseConversationName: true } }
    expect(useAgentRowConversationName(makeAgent({ rowSource: 'subagent' }))).toBeNull()
  })

  it('honors the generated-titles setting for generated names', () => {
    const agent = makeAgent({
      tab: { customTitle: null, title: '', generatedTitle: 'Fix intake flow' }
    } as Partial<DashboardAgentRow>)
    storeState.current = { settings: { agentRowsUseConversationName: true } }
    expect(useAgentRowConversationName(agent)).toBeNull()
    storeState.current = {
      settings: { agentRowsUseConversationName: true, tabAutoGenerateTitle: true }
    }
    expect(useAgentRowConversationName(agent)).toBe('Fix intake flow')
  })
})
