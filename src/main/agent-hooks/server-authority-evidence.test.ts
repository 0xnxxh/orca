import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentHookEventPayload } from '../../shared/agent-hook-listener'
import { makePaneKey } from '../../shared/stable-pane-id'
import { AgentHookServer } from './server'

const PANE_KEY = makePaneKey('tab-authority', '11111111-1111-4111-8111-111111111111')
const SECOND_PANE_KEY = makePaneKey('tab-authority-2', '22222222-2222-4222-8222-222222222222')

describe('AgentHookServer authority evidence', () => {
  const servers: AgentHookServer[] = []

  afterEach(() => {
    for (const server of servers) {
      server.stop()
    }
    servers.length = 0
  })

  it('freezes pre-listen commitments separately from current-runtime observations', async () => {
    const server = new AgentHookServer()
    servers.push(server)
    const hydrated = {
      paneKey: PANE_KEY,
      launchToken: 'launch-before-restart',
      tabId: 'tab-authority',
      worktreeId: 'repo::before',
      connectionId: 'ssh-target',
      payload: { state: 'working', prompt: 'before', agentType: 'codex' },
      receivedAt: 100,
      stateStartedAt: 100
    } satisfies AgentHookEventPayload & { receivedAt: number; stateStartedAt: number }
    server._getStateForTests().lastStatusByPaneKey.set(PANE_KEY, hydrated)

    await server.start()
    const commitments = server.getHydratedAuthorityCommitments()

    expect(commitments).toEqual([
      {
        paneKey: PANE_KEY,
        launchTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        tabId: 'tab-authority',
        worktreeId: 'repo::before',
        connectionId: 'ssh-target',
        observedAt: 100
      }
    ])
    expect(Object.isFrozen(commitments)).toBe(true)
    expect(Object.isFrozen(commitments[0])).toBe(true)
    expect(server.getCurrentAuthorityObservations()).toEqual([])
    expect(
      server.attestCompatibilityAuthority({
        paneKey: PANE_KEY,
        launchTokenHash: createHash('sha256').update('launch-before-restart').digest('hex'),
        connectionId: 'ssh-target'
      })
    ).toEqual({ paneKey: PANE_KEY, source: 'hydrated_commitment' })

    server.ingestRemote(
      {
        paneKey: PANE_KEY,
        launchToken: 'launch-after-restart',
        tabId: 'tab-authority',
        worktreeId: 'repo::after',
        payload: { state: 'working', prompt: 'after', agentType: 'codex' }
      },
      'ssh-target'
    )

    expect(server.getHydratedAuthorityCommitments()).toBe(commitments)
    expect(JSON.stringify(commitments)).not.toContain('launch-before-restart')
    expect(server.getCurrentAuthorityObservations()).toEqual([
      expect.objectContaining({
        paneKey: PANE_KEY,
        launchTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        connectionId: 'ssh-target',
        worktreeId: 'repo::after'
      })
    ])
    expect(JSON.stringify(server.getCurrentAuthorityObservations())).not.toContain(
      'launch-after-restart'
    )
    expect(
      server.attestCompatibilityAuthority({
        paneKey: PANE_KEY,
        launchTokenHash: createHash('sha256').update('launch-before-restart').digest('hex'),
        connectionId: 'ssh-target'
      })
    ).toBeNull()

    expect(
      server.attestCompatibilityAuthority({
        paneKey: PANE_KEY,
        launchTokenHash: createHash('sha256').update('launch-after-restart').digest('hex'),
        connectionId: 'ssh-target'
      })
    ).toBeNull()

    server.ingestRemote(
      {
        paneKey: PANE_KEY,
        launchToken: 'launch-before-restart',
        tabId: 'tab-authority',
        worktreeId: 'repo::current',
        payload: { state: 'working', prompt: 'current', agentType: 'codex' }
      },
      'ssh-target'
    )

    expect(
      server.attestCompatibilityAuthority({
        paneKey: PANE_KEY,
        launchTokenHash: createHash('sha256').update('launch-before-restart').digest('hex'),
        connectionId: 'ssh-target'
      })
    ).toEqual({ paneKey: PANE_KEY, source: 'current_hook' })

    server.ingestRemote(
      {
        paneKey: SECOND_PANE_KEY,
        launchToken: 'launch-before-restart',
        tabId: 'tab-authority-2',
        payload: { state: 'working', prompt: 'duplicate', agentType: 'codex' }
      },
      'ssh-target'
    )

    expect(
      server.attestCompatibilityAuthority({
        paneKey: PANE_KEY,
        launchTokenHash: createHash('sha256').update('launch-before-restart').digest('hex'),
        connectionId: 'ssh-target'
      })
    ).toBeNull()

    server.clearStatusEntriesForConnection('ssh-target')

    expect(server.getHydratedAuthorityCommitments()).toBe(commitments)
    expect(server.getCurrentAuthorityObservations()).toEqual([])
  })
})
