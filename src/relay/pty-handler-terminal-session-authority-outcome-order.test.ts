import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockPtySpawn } = vi.hoisted(() => ({ mockPtySpawn: vi.fn() }))

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))
vi.mock('../main/pty/posix-pty-process-groups', () => ({
  forceKillPosixPtyProcessGroups: vi.fn((_pid: number, fallback: () => void) => fallback())
}))

import type { TerminalSessionAuthorityPtyLifecycle } from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import type { TerminalAuthorityExactPtyAccessResolver } from './terminal-authority-exact-pty-access'
import type { RelayDispatcher } from './dispatcher'
import { PtyHandler } from './pty-handler'
import {
  authorityLifecycleMock,
  authorityPolicyConsumer,
  authorityRequestContext,
  authoritySpawnParams,
  createAuthorityDispatcher,
  createAuthorityTerm,
  terminalExitOutcome
} from './__tests__/pty-handler-terminal-session-authority-fixture'

describe('PtyHandler authority outcome ordering', () => {
  let handlers: PtyHandler[] = []

  afterEach(async () => {
    await Promise.allSettled(
      handlers.splice(0).map((handler) => handler.dispose({ waitForPhysicalExit: false }))
    )
    vi.restoreAllMocks()
  })

  it('orders final output before a capability-gated authority outcome exit', async () => {
    const events: string[] = []
    const term = createAuthorityTerm(events)
    mockPtySpawn.mockReturnValue(term)
    const lifecycle = authorityLifecycleMock()
    let keepOutcomePending!: () => void
    lifecycle.recordExit.mockImplementation(
      async () => await new Promise<void>((resolve) => (keepOutcomePending = resolve))
    )
    const namespace = { authorityHostId: 'host-a', namespaceId: 'namespace-a' }
    lifecycle.commitSpawn.mockImplementation(async (_prepared, incarnationId: string) => ({
      runtime: { service: { namespace } },
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
      binding: {
        ownerIncarnationId: 'owner-a',
        physicalPtyId: 'pty-1',
        ptyIncarnationId: incarnationId
      }
    }))
    const dispatcher = createAuthorityDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: {
        classify: async () => 'current-owner'
      } as TerminalAuthorityExactPtyAccessResolver
    })
    handlers.push(handler)
    handler.setTerminalAuthorityPolicyConsumerForClient(() => authorityPolicyConsumer())
    const spawned = (await dispatcher.callRequest(
      'pty.spawn',
      authoritySpawnParams(),
      authorityRequestContext(1)
    )) as {
      id: string
      incarnationId: string
    }
    const dataListener = term.onData.mock.calls.at(-1)?.[0] as ((data: string) => void) | undefined
    dataListener?.('last output')
    const exitListener = term.onExit.mock.calls.at(-1)?.[0] as
      | ((event: { exitCode: number }) => void)
      | undefined
    exitListener?.({ exitCode: 7 })
    await vi.waitFor(() => expect(lifecycle.recordExit).toHaveBeenCalledOnce())
    const authorityOutcome = terminalExitOutcome(spawned.incarnationId)
    const effect = authorityOutcome.result.effects.find(
      (candidate) => candidate.kind === 'terminal-exited'
    )!
    const attempt = {
      identity: {
        version: 1 as const,
        namespace,
        pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
        binding: effect.binding,
        consumerId: authorityOutcome.consumerId,
        outcomeId: authorityOutcome.outcomeId,
        sequence: authorityOutcome.sequence
      },
      supportsClient: () => true,
      markPublished: vi.fn(),
      markOrderedComplete: vi.fn()
    }

    expect(handler.publishTerminalSessionAuthorityOutcome(authorityOutcome, effect, attempt)).toBe(
      true
    )
    expect(dispatcher.notify.mock.calls.map(([method]) => method)).toEqual(['pty.data', 'pty.exit'])
    expect(dispatcher.notify).toHaveBeenLastCalledWith(
      'pty.exit',
      expect.objectContaining({
        id: spawned.id,
        incarnationId: spawned.incarnationId,
        authorityOutcome: expect.objectContaining({ outcomeId: authorityOutcome.outcomeId })
      })
    )
    expect(attempt.markPublished).toHaveBeenCalledWith([1])
    expect(attempt.markOrderedComplete).toHaveBeenCalledOnce()
    keepOutcomePending()
  })
})
