import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  resetTerminalTabActivityFlagsCacheForTest,
  resolveTerminalTabActivityStatus
} from '../tab-bar/terminal-tab-activity-status'
import { selectWorktreeAgentActivitySummary } from './worktree-agent-activity-summary'
import { getAgentDotState } from './worktree-card-agent-summary'
import { buildWorktreeAgentRows } from './worktree-agent-rows'

// STA-4119 / #14253. The pane stays `working` (liveness, keep-awake, hibernation
// and teardown all read `state`), but every surface that renders FOREGROUND
// activity must stop drawing a finished turn as an active spinner.

const TAB_ID = 'tab-4119'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const WORKTREE_ID = 'wt-4119'
const NOW = 100_000

const TAB: TerminalTab = {
  id: TAB_ID,
  title: 'Claude',
  worktreeId: WORKTREE_ID,
  launchAgent: 'claude'
} as TerminalTab

function entry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey: PANE_KEY,
    state: 'working',
    prompt: 'ship the thing',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    agentType: 'claude',
    tabId: TAB_ID,
    worktreeId: WORKTREE_ID,
    ...overrides
  }
}

function summaryFor(row: AgentStatusEntry) {
  return selectWorktreeAgentActivitySummary(
    {
      // Why: the summary memo keys on this epoch; a fresh value per case avoids
      // one test's cached flags answering the next.
      agentStatusEpoch: Math.random(),
      agentStatusByPaneKey: { [row.paneKey]: row },
      migrationUnsupportedByPtyId: {},
      retainedAgentsByPaneKey: {},
      tabsByWorktree: { [WORKTREE_ID]: [{ id: TAB_ID }] }
    } as Parameters<typeof selectWorktreeAgentActivitySummary>[0],
    WORKTREE_ID
  )
}

function tabStatusFor(row: AgentStatusEntry) {
  resetTerminalTabActivityFlagsCacheForTest()
  return resolveTerminalTabActivityStatus({
    tab: TAB,
    agentStatusByPaneKey: { [row.paneKey]: row },
    agentStatusEpoch: Math.random(),
    ptyIdsByTabId: { [TAB_ID]: ['pty-1'] }
  })
}

function rowsFor(row: AgentStatusEntry) {
  return buildWorktreeAgentRows({ tabs: [TAB], entries: [row], retained: [], now: NOW })
}

beforeEach(() => {
  resetTerminalTabActivityFlagsCacheForTest()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  resetTerminalTabActivityFlagsCacheForTest()
})

describe('worktree card dot', () => {
  it('reports a foreground working pane as working', () => {
    expect(summaryFor(entry())).toMatchObject({ hasLiveWorking: true, hasLiveDone: false })
  })

  it('reports a background-only pane as done, not working', () => {
    expect(summaryFor(entry({ backgroundOnly: true }))).toMatchObject({
      hasLiveWorking: false,
      hasLiveDone: true
    })
  })

  it('ignores a stale marker on a non-working row', () => {
    expect(summaryFor(entry({ state: 'waiting', backgroundOnly: true }))).toMatchObject({
      hasPermission: true,
      hasLiveDone: false
    })
  })
})

describe('terminal tab glyph', () => {
  it('spins for a foreground working pane', () => {
    expect(tabStatusFor(entry())).toBe('working')
  })

  it('shows done for a background-only pane', () => {
    expect(tabStatusFor(entry({ backgroundOnly: true }))).toBe('done')
  })
})

describe('sidebar agent row dot', () => {
  it('renders a foreground working pane with the spinner state', () => {
    const rows = rowsFor(entry())
    expect(getAgentDotState(rows[0])).toBe('working')
  })

  it('renders a background-only pane as background work', () => {
    const rows = rowsFor(entry({ backgroundOnly: true }))
    expect(getAgentDotState(rows[0])).toBe('background')
  })

  it('keeps live subagent child rows working under a background-only parent', () => {
    const rows = rowsFor(
      entry({
        backgroundOnly: true,
        subagents: [{ id: 'a1', state: 'working', startedAt: NOW - 1_000, agentType: 'explore' }]
      })
    )
    const child = rows.find((row) => row.rowSource === 'subagent')
    expect(child).toBeDefined()
    // Why: muting the parent must not pretend the background child is dead.
    expect(getAgentDotState(child!)).toBe('working')
  })

  it('still reports an interrupted pane as interrupted', () => {
    const rows = rowsFor(entry({ state: 'done', interrupted: true }))
    expect(getAgentDotState(rows[0])).toBe('interrupted')
  })
})

describe('liveness is unchanged', () => {
  it('keeps the pane a fresh non-done row so keep-awake and hibernation still see live work', async () => {
    const { isFreshNonDoneAgentStatus } = await import('../../../../shared/agent-status-types')
    const row = entry({ backgroundOnly: true })
    expect(row.state).toBe('working')
    expect(isFreshNonDoneAgentStatus(row, NOW)).toBe(true)
  })
})
