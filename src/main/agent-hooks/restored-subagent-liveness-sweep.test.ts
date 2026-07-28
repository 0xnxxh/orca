import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSubagentSnapshot } from '../../shared/agent-status-types'
import { makePaneKey } from '../../shared/stable-pane-id'
import { toAppSshPtyId } from '../../shared/ssh-pty-id'
import { AgentHookServer } from './server'
import {
  indexPersistedPaneKeyPtyIds,
  sweepRestoredSubagentsWithoutLiveAgent
} from './restored-subagent-liveness-sweep'

const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE = makePaneKey('tab-1', LEAF)
const PTY = 'wt-1__pty-1'
const WORKING_CHILD: AgentSubagentSnapshot = {
  id: 'areview-loop-c237a4c577493352',
  state: 'working',
  startedAt: 1_000
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-restored-subagent-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Persist a pane whose lead has finished but whose roster still holds a working
 *  child, then restart into a fresh server — the shape a machine sleep leaves
 *  behind when the child's SubagentStop is lost while Orca is down. */
async function restartWithInFlightSubagent(options?: {
  connectionId?: string
  subagents?: AgentSubagentSnapshot[]
}): Promise<AgentHookServer> {
  const first = new AgentHookServer()
  await first.start({ env: 'production', userDataPath: dir })
  first.ingestTerminalStatus({
    paneKey: PANE,
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    connectionId: options?.connectionId ?? null,
    payload: {
      state: 'working',
      prompt: 'review the PR',
      agentType: 'claude',
      subagents: options?.subagents ?? [WORKING_CHILD]
    }
  })
  first.flushStatusPersistSync()
  first.stop()

  const restarted = new AgentHookServer()
  await restarted.start({ env: 'production', userDataPath: dir })
  return restarted
}

function sweepWith(
  server: AgentHookServer,
  overrides: {
    livePtyIds?: readonly string[] | null
    boundPtyIdByPaneKey?: Record<string, string>
    persistedPtyIdByPaneKey?: Record<string, string>
  } = {}
): Promise<number> {
  return sweepRestoredSubagentsWithoutLiveAgent({
    listLiveLocalPtyIds: async () =>
      overrides.livePtyIds === undefined ? [] : overrides.livePtyIds,
    getBoundPtyIdForPaneKey: (paneKey) => overrides.boundPtyIdByPaneKey?.[paneKey],
    getPersistedPtyIdForPaneKey: (paneKey) => overrides.persistedPtyIdByPaneKey?.[paneKey],
    reap: (isLocalPaneAgentLive) =>
      server.reapRestoredClaudeSubagentsWithoutLiveAgent(isLocalPaneAgentLive)
  })
}

function paneStatus(
  server: AgentHookServer,
  paneKey = PANE
): { state: string; subagents?: AgentSubagentSnapshot[] } {
  const entry = server.getStatusSnapshotForPane(paneKey)[0]
  return { state: entry?.state ?? 'missing', subagents: entry?.subagents }
}

describe('restored subagent liveness sweep', () => {
  it('reaps the phantom seed so a slept-through pane reaches done', async () => {
    const server = await restartWithInFlightSubagent()
    try {
      expect(paneStatus(server)).toEqual({ state: 'working', subagents: [WORKING_CHILD] })

      await expect(sweepWith(server, { persistedPtyIdByPaneKey: { [PANE]: PTY } })).resolves.toBe(1)

      expect(paneStatus(server)).toEqual({ state: 'done', subagents: undefined })
    } finally {
      server.stop()
    }
  })

  it('keeps a seed whose pane still has a live local PTY', async () => {
    const server = await restartWithInFlightSubagent()
    try {
      await expect(
        sweepWith(server, { livePtyIds: [PTY], persistedPtyIdByPaneKey: { [PANE]: PTY } })
      ).resolves.toBe(0)

      expect(paneStatus(server)).toEqual({ state: 'working', subagents: [WORKING_CHILD] })
    } finally {
      server.stop()
    }
  })

  it('keeps a seed whose PTY is bound in this session but not listed yet', async () => {
    const server = await restartWithInFlightSubagent()
    try {
      await expect(
        sweepWith(server, { livePtyIds: [PTY], boundPtyIdByPaneKey: { [PANE]: PTY } })
      ).resolves.toBe(0)

      expect(paneStatus(server).state).toBe('working')
    } finally {
      server.stop()
    }
  })

  it('never reaps an SSH-launched pane, whose agent cannot appear in a local scan', async () => {
    const sshPtyId = toAppSshPtyId('conn-1', PTY)
    const server = await restartWithInFlightSubagent()
    try {
      await expect(
        sweepWith(server, { livePtyIds: [], persistedPtyIdByPaneKey: { [PANE]: sshPtyId } })
      ).resolves.toBe(0)

      expect(paneStatus(server)).toEqual({ state: 'working', subagents: [WORKING_CHILD] })
    } finally {
      server.stop()
    }
  })

  it('never reaps a relay-owned pane even with no local PTY at all', async () => {
    const server = await restartWithInFlightSubagent({ connectionId: 'conn-1' })
    try {
      await expect(sweepWith(server)).resolves.toBe(0)

      expect(paneStatus(server).state).toBe('working')
    } finally {
      server.stop()
    }
  })

  it('does nothing when the PTY inventory cannot be read', async () => {
    const server = await restartWithInFlightSubagent()
    try {
      await expect(sweepWith(server, { livePtyIds: null })).resolves.toBe(0)

      expect(paneStatus(server).state).toBe('working')
    } finally {
      server.stop()
    }
  })

  it('skips panes that have reported to this runtime', async () => {
    const server = await restartWithInFlightSubagent()
    try {
      server.ingestTerminalStatus({
        paneKey: PANE,
        tabId: 'tab-1',
        worktreeId: 'wt-1',
        payload: {
          state: 'working',
          prompt: 'now reviewing round two',
          agentType: 'claude',
          subagents: [WORKING_CHILD]
        }
      })

      await expect(sweepWith(server)).resolves.toBe(0)
      expect(paneStatus(server).state).toBe('working')
    } finally {
      server.stop()
    }
  })

  it('leaves a pane whose lead is genuinely mid-turn at working', async () => {
    const server = await restartWithInFlightSubagent()
    try {
      // Why: the lead's own tool event proves the process is alive; only the
      // child-gated 'working' may be re-derived, so the state must survive.
      server.ingestTerminalStatus({
        paneKey: makePaneKey('tab-2', LEAF),
        tabId: 'tab-2',
        worktreeId: 'wt-1',
        payload: { state: 'working', prompt: 'still going', agentType: 'claude' }
      })

      await sweepWith(server)

      expect(paneStatus(server, makePaneKey('tab-2', LEAF)).state).toBe('working')
    } finally {
      server.stop()
    }
  })

  it('reports zero and leaves state alone when the listing throws', async () => {
    const server = await restartWithInFlightSubagent()
    const listLiveLocalPtyIds = vi.fn(async () => {
      throw new Error('daemon unreachable')
    })
    try {
      await expect(
        sweepRestoredSubagentsWithoutLiveAgent({
          listLiveLocalPtyIds,
          getBoundPtyIdForPaneKey: () => undefined,
          getPersistedPtyIdForPaneKey: () => undefined,
          reap: (probe) => server.reapRestoredClaudeSubagentsWithoutLiveAgent(probe)
        })
      ).rejects.toThrow('daemon unreachable')

      expect(paneStatus(server).state).toBe('working')
    } finally {
      server.stop()
    }
  })
})

describe('indexPersistedPaneKeyPtyIds', () => {
  it('maps layout leaves to pane keys and ignores empty bindings', () => {
    expect(
      indexPersistedPaneKeyPtyIds({
        'tab-1': { ptyIdsByLeafId: { [LEAF]: PTY, 'leaf-empty': '' } },
        'tab-2': undefined,
        'tab-3': {}
      })
    ).toEqual(new Map([[PANE, PTY]]))
  })
})
