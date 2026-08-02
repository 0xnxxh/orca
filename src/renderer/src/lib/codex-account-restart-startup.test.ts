import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import {
  CODEX_ACCOUNT_RESTART_STARTUP,
  resolveCodexAccountRestartStartup
} from './codex-session-restart'

describe('resolveCodexAccountRestartStartup', () => {
  const originalWindow = (globalThis as { window?: typeof window }).window
  const PANE_KEY = 'tab-1:leaf-1'
  const THREAD_ID = '123e4567-e89b-42d3-a456-426614174000'
  const prepareAccountSwitchResume = vi.fn()

  function seedCodexStatus(overrides: Partial<AgentStatusEntry> = {}): void {
    useAppStore.setState({
      agentStatusByPaneKey: {
        [PANE_KEY]: {
          state: 'working',
          prompt: 'ship it',
          updatedAt: 1,
          stateStartedAt: 1,
          paneKey: PANE_KEY,
          stateHistory: [],
          agentType: 'codex',
          providerSession: { key: 'session_id', id: THREAD_ID },
          ...overrides
        } as AgentStatusEntry
      }
    })
  }

  beforeEach(() => {
    prepareAccountSwitchResume.mockReset()
    prepareAccountSwitchResume.mockResolvedValue({ outcome: 'resume', threadId: THREAD_ID })
    useAppStore.setState({ agentStatusByPaneKey: {} })
    ;(globalThis as { window: typeof window }).window = {
      ...originalWindow,
      api: {
        ...originalWindow?.api,
        codexAccounts: {
          ...originalWindow?.api?.codexAccounts,
          prepareAccountSwitchResume
        }
      }
    } as unknown as typeof window
  })

  afterEach(() => {
    useAppStore.setState({ agentStatusByPaneKey: {} })
    if (originalWindow) {
      ;(globalThis as { window: typeof window }).window = originalWindow
    } else {
      delete (globalThis as { window?: typeof window }).window
    }
  })

  it('resumes the pane thread once main confirms the bridge', async () => {
    seedCodexStatus({
      providerSession: {
        key: 'session_id',
        id: THREAD_ID,
        transcriptPath: '/old/home/sessions/2026/07/20/rollout-x.jsonl'
      }
    })

    const startup = await resolveCodexAccountRestartStartup({ ptyId: 'pty-1', paneKey: PANE_KEY })

    expect(startup).toEqual({
      command: `codex resume ${THREAD_ID}`,
      startupCommandDelivery: 'shell-ready'
    })
    expect(prepareAccountSwitchResume).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      threadId: THREAD_ID,
      transcriptPath: '/old/home/sessions/2026/07/20/rollout-x.jsonl'
    })
  })

  it('omits an absent transcript path from the preparation request', async () => {
    seedCodexStatus()

    await resolveCodexAccountRestartStartup({ ptyId: 'pty-1', paneKey: PANE_KEY })

    expect(prepareAccountSwitchResume).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      threadId: THREAD_ID
    })
  })

  // Why toEqual against the literal: the fallback contract is BYTE-identical to
  // today's fresh startup — plain `codex`, delivered once the shell is ready.
  const TODAYS_STARTUP = { command: 'codex', startupCommandDelivery: 'shell-ready' }

  it.each([
    ['the pane has no agent status', (): void => {}],
    ['the pane runs a different agent', (): void => seedCodexStatus({ agentType: 'claude' })],
    [
      'the status came over a remote connection',
      (): void => seedCodexStatus({ connectionId: 'conn-1' })
    ],
    ['the session has no provider id', (): void => seedCodexStatus({ providerSession: undefined })],
    [
      'the provider id is not a session id',
      (): void =>
        seedCodexStatus({
          providerSession: { key: 'conversation_id', id: THREAD_ID }
        })
    ],
    [
      'the session id is not a bare rollout UUID',
      (): void => seedCodexStatus({ providerSession: { key: 'session_id', id: 'nested); rm -rf' } })
    ]
  ])("falls back to today's exact startup when %s", async (_label, seed) => {
    seed()

    const startup = await resolveCodexAccountRestartStartup({ ptyId: 'pty-1', paneKey: PANE_KEY })

    expect(startup).toEqual(TODAYS_STARTUP)
    expect(startup).toBe(CODEX_ACCOUNT_RESTART_STARTUP)
    expect(prepareAccountSwitchResume).not.toHaveBeenCalled()
  })

  it('never asks main about a pane on another machine', async () => {
    seedCodexStatus()

    const startup = await resolveCodexAccountRestartStartup({
      ptyId: 'ssh:my-box@@pty-7',
      paneKey: PANE_KEY
    })

    expect(startup).toEqual(TODAYS_STARTUP)
    expect(prepareAccountSwitchResume).not.toHaveBeenCalled()
  })

  it('falls back when the preload predates the preparation handler', async () => {
    seedCodexStatus()
    ;(
      window.api.codexAccounts as unknown as { prepareAccountSwitchResume?: unknown }
    ).prepareAccountSwitchResume = undefined

    expect(await resolveCodexAccountRestartStartup({ ptyId: 'pty-1', paneKey: PANE_KEY })).toEqual(
      TODAYS_STARTUP
    )
  })

  it('falls back when the preparation IPC rejects', async () => {
    seedCodexStatus()
    prepareAccountSwitchResume.mockRejectedValue(new Error('no handler'))

    expect(await resolveCodexAccountRestartStartup({ ptyId: 'pty-1', paneKey: PANE_KEY })).toEqual(
      TODAYS_STARTUP
    )
  })

  it('falls back when main declines the resume', async () => {
    seedCodexStatus()
    prepareAccountSwitchResume.mockResolvedValue({ outcome: 'fresh', reason: 'non-host-lane' })

    expect(await resolveCodexAccountRestartStartup({ ptyId: 'pty-1', paneKey: PANE_KEY })).toEqual(
      TODAYS_STARTUP
    )
  })

  it('falls back when main answers for a different thread', async () => {
    seedCodexStatus()
    prepareAccountSwitchResume.mockResolvedValue({ outcome: 'resume', threadId: 'other-thread' })

    expect(await resolveCodexAccountRestartStartup({ ptyId: 'pty-1', paneKey: PANE_KEY })).toEqual(
      TODAYS_STARTUP
    )
  })
})
