import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from './server'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  isFreshNonDoneAgentStatus
} from '../../shared/agent-status-types'
import { makePaneKey } from '../../shared/stable-pane-id'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn(() => ({})) }))

const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const PANE = makePaneKey('tab-1', LEAF_1)
const T0 = 1_700_000_000_000

const workingEvent = {
  paneKey: PANE,
  hookEventName: 'PreToolUse',
  payload: {
    state: 'working' as const,
    prompt: 'fix the typecheck failures',
    agentType: 'claude' as const,
    toolName: 'Bash',
    toolInput: 'pnpm run typecheck'
  }
}

/** The sidebar reads the IPC row; mirror its freshness gate on the real snapshot. */
function paneRow(server: AgentHookServer): {
  state: string
  updatedAt: number
  stateStartedAt: number
} {
  const row = server.getStatusSnapshot()[0]
  if (!row) {
    throw new Error('expected a cached status row')
  }
  return {
    state: row.state,
    updatedAt: row.receivedAt,
    stateStartedAt: row.stateStartedAt
  }
}

function isRenderedAsWorking(server: AgentHookServer, now: number): boolean {
  const row = paneRow(server)
  return isFreshNonDoneAgentStatus({ state: row.state as 'working', updatedAt: row.updatedAt }, now)
}

describe('reconnect replay does not re-arm agent status freshness (STA-4144)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a replayed unchanged working row stale so it decays to idle', () => {
    const server = new AgentHookServer()
    server.ingestRemote(workingEvent, 'conn-1')
    expect(isRenderedAsWorking(server, Date.now())).toBe(true)

    // The turn ends while the relay is disconnected (sleep / restart), so the
    // matching Stop never reaches this client and the row freezes at working.
    const afterStaleWindow = T0 + AGENT_STATUS_STALE_AFTER_MS + 60_000
    vi.setSystemTime(afterStaleWindow)
    expect(isRenderedAsWorking(server, afterStaleWindow)).toBe(false)

    // Reconnect: the host replays its cached statuses one frame per pane.
    server.ingestRemote({ ...workingEvent, isReplay: true }, 'conn-1')

    const row = paneRow(server)
    // Regression: the replay must not look newer than the evidence behind it.
    expect(row.updatedAt).toBe(T0)
    expect(row.stateStartedAt).toBe(T0)
    expect(isRenderedAsWorking(server, afterStaleWindow)).toBe(false)
  })

  it('still lets a replay deliver a completion this client never saw', () => {
    const server = new AgentHookServer()
    server.ingestRemote(workingEvent, 'conn-1')

    const later = T0 + AGENT_STATUS_STALE_AFTER_MS + 60_000
    vi.setSystemTime(later)
    server.ingestRemote(
      {
        ...workingEvent,
        isReplay: true,
        payload: { ...workingEvent.payload, state: 'done' as const }
      },
      'conn-1'
    )

    const row = paneRow(server)
    expect(row.state).toBe('done')
    expect(row.updatedAt).toBe(later)
  })

  it('still refreshes freshness for a live same-state working ping', () => {
    const server = new AgentHookServer()
    server.ingestRemote(workingEvent, 'conn-1')

    const later = T0 + 20 * 60_000
    vi.setSystemTime(later)
    server.ingestRemote(workingEvent, 'conn-1')

    const row = paneRow(server)
    expect(row.updatedAt).toBe(later)
    // A genuinely active agent stays working past the original stale deadline.
    expect(isRenderedAsWorking(server, T0 + AGENT_STATUS_STALE_AFTER_MS + 60_000)).toBe(true)
    // The displayed age still tracks when the state began, not the last ping.
    expect(row.stateStartedAt).toBe(T0)
  })
})
