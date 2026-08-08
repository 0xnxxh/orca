import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPtySpawn } = vi.hoisted(() => ({ mockPtySpawn: vi.fn() }))

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))
vi.mock('../main/pty/posix-pty-process-groups', () => ({
  forceKillPosixPtyProcessGroups: vi.fn((_pid: number, fallback: () => void) => fallback())
}))

import type { RelayDispatcher } from './dispatcher'
import { PtyHandler } from './pty-handler'
import type { TerminalSessionAuthorityPtyLifecycle } from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import type { TerminalAuthorityExactPtyAccessResolver } from './terminal-authority-exact-pty-access'
import {
  authorityAttachParams as attachParams,
  authorityLifecycleMock,
  authorityPolicyConsumer,
  authorityRequestContext as requestContext,
  authoritySpawnParams as spawnParams,
  createAuthorityDispatcher as createDispatcher,
  createAuthorityTerm as createTerm
} from './__tests__/pty-handler-terminal-session-authority-fixture'

function currentOwnerResolver(): TerminalAuthorityExactPtyAccessResolver {
  return { classify: async () => 'current-owner' }
}

describe('PtyHandler terminal session authority identity and shutdown', () => {
  let handlers: PtyHandler[] = []

  function registerHandler(
    handler: PtyHandler,
    resolve = (clientId: number) => (clientId === 7 ? authorityPolicyConsumer() : null)
  ): void {
    handler.setTerminalAuthorityPolicyConsumerForClient(resolve)
    handlers.push(handler)
  }

  beforeEach(() => {
    mockPtySpawn.mockReset()
  })

  afterEach(async () => {
    await Promise.allSettled(
      handlers.splice(0).map((handler) => handler.dispose({ waitForPhysicalExit: false }))
    )
    vi.restoreAllMocks()
  })

  it('requires the exact managed worktree, pane generation, and PTY incarnation', async () => {
    const events: string[] = []
    mockPtySpawn.mockReturnValue(createTerm(events))
    const lifecycle = authorityLifecycleMock()
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver()
    })
    registerHandler(handler)
    const spawned = (await dispatcher.callRequest(
      'pty.spawn',
      spawnParams(),
      requestContext(7)
    )) as {
      id: string
      incarnationId: string
    }

    await expect(
      dispatcher.callRequest(
        'pty.attach',
        attachParams(spawned.id, spawned.incarnationId),
        requestContext(7)
      )
    ).resolves.toMatchObject({ incarnationId: spawned.incarnationId })
    for (const stale of [
      { expectedWorktreeId: 'repo::/srv/other' },
      { expectedPaneGeneration: 2 },
      { expectedPtyIncarnationId: 'stale-incarnation' }
    ]) {
      await expect(
        dispatcher.callRequest(
          'pty.attach',
          attachParams(spawned.id, spawned.incarnationId, stale),
          requestContext(7)
        )
      ).rejects.toThrow('authority identity mismatch')
    }
    await expect(
      dispatcher.callRequest('pty.attach', { id: spawned.id }, requestContext(7))
    ).rejects.toThrow('attach_identity_required')
  })

  it('accepts renderer pane generation zero as an exact identity', async () => {
    const events: string[] = []
    mockPtySpawn.mockReturnValue(createTerm(events))
    const lifecycle = authorityLifecycleMock(0)
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver()
    })
    registerHandler(handler)
    const spawned = (await dispatcher.callRequest(
      'pty.spawn',
      spawnParams(0),
      requestContext(7)
    )) as {
      id: string
      incarnationId: string
    }

    await expect(
      dispatcher.callRequest(
        'pty.attach',
        attachParams(spawned.id, spawned.incarnationId, { expectedPaneGeneration: 0 }),
        requestContext(7)
      )
    ).resolves.toMatchObject({ incarnationId: spawned.incarnationId })
  })

  it('keeps a lost authority spawn response adoptable without killing its PTY', async () => {
    const events: string[] = []
    const term = createTerm(events)
    mockPtySpawn.mockReturnValue(term)
    const lifecycle = authorityLifecycleMock()
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver()
    })
    registerHandler(handler)
    const spawned = (await dispatcher.callRequest('pty.spawn', spawnParams(), {
      clientId: 7,
      isStale: () => mockPtySpawn.mock.calls.length > 0
    })) as { id: string; incarnationId: string }
    const committed = await lifecycle.commitSpawn.mock.results[0].value
    ;(
      lifecycle.prepareSpawn as unknown as {
        mockResolvedValueOnce: (value: unknown) => void
      }
    ).mockResolvedValueOnce({
      kind: 'adopt',
      runtime: committed.runtime,
      pane: committed.pane,
      binding: committed.binding
    })

    const adopted = await dispatcher.callRequest('pty.spawn', spawnParams(), requestContext(7))

    expect(adopted).toMatchObject(spawned)
    expect(mockPtySpawn).toHaveBeenCalledOnce()
    expect(term.kill).not.toHaveBeenCalled()
    expect(lifecycle.closePty).not.toHaveBeenCalled()
  })

  it('records exit before retiring an authority binding during shutdown', async () => {
    const events: string[] = []
    const term = createTerm(events)
    mockPtySpawn.mockReturnValue(term)
    const lifecycle = authorityLifecycleMock()
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver()
    })
    registerHandler(handler)
    const spawned = (await dispatcher.callRequest(
      'pty.spawn',
      spawnParams(),
      requestContext(7)
    )) as { id: string }

    const shutdown = dispatcher.callRequest('pty.shutdown', {
      id: spawned.id,
      immediate: true
    })
    expect(lifecycle.closePty).not.toHaveBeenCalled()
    const exitListener = term.onExit.mock.calls.at(-1)?.[0] as
      | ((event: { exitCode: number }) => void)
      | undefined
    exitListener?.({ exitCode: 137 })
    await shutdown

    expect(lifecycle.recordExit).toHaveBeenCalledWith(expect.anything(), 137)
    expect(lifecycle.closePty).not.toHaveBeenCalled()
  })
})
