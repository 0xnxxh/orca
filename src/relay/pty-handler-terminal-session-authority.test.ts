import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPtySpawn } = vi.hoisted(() => ({ mockPtySpawn: vi.fn() }))

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))
vi.mock('../main/pty/posix-pty-process-groups', () => ({
  forceKillPosixPtyProcessGroups: vi.fn((_pid: number, fallback: () => void) => fallback())
}))

import type { RelayDispatcher } from './dispatcher'
import * as ptyShellUtils from './pty-shell-utils'
import { PtyHandler, TERMINAL_SESSION_AUTHORITY_BINDING_UNKNOWN_ERROR } from './pty-handler'
import { TERMINAL_AUTHORITY_EARLY_OUTPUT_MAX_BYTES } from './terminal-authority-early-output-buffer'
import type {
  LegacyPhysicalWorkerAttachRouter,
  LegacyPhysicalWorkerPtyRouter
} from './legacy-physical-worker-attach-router'
import type { TerminalSessionAuthorityPtyLifecycle } from '../main/session-authority/terminal-session-authority-pty-lifecycle'
import type { TerminalAuthorityExactPtyAccessResolver } from './terminal-authority-exact-pty-access'
import type { TerminalSessionAuthorityPtyAccess } from '../shared/terminal-session-authority-pty-access'
import {
  authorityAttachParams as attachParams,
  authorityLifecycleMock,
  authorityPolicyConsumer,
  authorityNamespace,
  authorityRequestContext as requestContext,
  authoritySpawnParams as spawnParams,
  createAuthorityDispatcher as createDispatcher,
  createAuthorityTerm as createTerm
} from './__tests__/pty-handler-terminal-session-authority-fixture'

function currentOwnerResolver(): TerminalAuthorityExactPtyAccessResolver {
  return { classify: async () => 'current-owner' }
}

describe('PtyHandler terminal session authority boundary', () => {
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

  it('durably prepares before native spawn and commits the exact incarnation before resume', async () => {
    const events: string[] = []
    const term = createTerm(events)
    mockPtySpawn.mockImplementation(() => {
      events.push('native-spawn')
      return term
    })
    const binding = {
      ownerIncarnationId: 'owner-a',
      physicalPtyId: 'pty-1',
      ptyIncarnationId: 'incarnation-from-commit'
    }
    const lifecycle = {
      prepareSpawn: vi.fn(async () => {
        events.push('durable-prepare')
        return { kind: 'spawn', runtime: {}, pane: {}, allocation: {} }
      }),
      commitSpawn: vi.fn(async (_prepared, incarnationId: string) => {
        events.push('durable-commit')
        const earlyData = term.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined
        earlyData?.('boot output\n')
        binding.ptyIncarnationId = incarnationId
        return {
          runtime: { service: { namespace: authorityNamespace } },
          pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
          binding
        }
      }),
      cancelSpawn: vi.fn(),
      closePty: vi.fn(async () => {}),
      recordExit: vi.fn(async () => {}),
      bindingIsReachable: vi.fn(() => true)
    }
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver()
    })
    registerHandler(handler)

    const result = (await dispatcher.callRequest(
      'pty.spawn',
      spawnParams(),
      requestContext(7)
    )) as {
      id: string
      incarnationId: string
    }

    expect(events).toEqual([
      'durable-prepare',
      'native-spawn',
      'pause',
      'exit-listener',
      'durable-commit',
      'exit-listener',
      'resume'
    ])
    expect(lifecycle.commitSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'spawn' }),
      result.incarnationId
    )
    expect(binding).toMatchObject({
      physicalPtyId: result.id,
      ptyIncarnationId: result.incarnationId
    })
    await dispatcher.callRequest(
      'pty.attach',
      attachParams(result.id, result.incarnationId),
      requestContext(7)
    )
    expect(dispatcher.notify).toHaveBeenCalledWith('pty.replay', {
      id: result.id,
      data: 'boot output\n'
    })

    dispatcher.callNotification('pty.data', { id: result.id, data: 'echo ok\n' })
    dispatcher.callNotification('pty.resize', { id: result.id, cols: 120, rows: 40 })
    expect(term.write).toHaveBeenCalledWith('echo ok\n')
    expect(term.resize).toHaveBeenCalledWith(120, 40)
    expect(lifecycle.prepareSpawn).toHaveBeenCalledOnce()
    expect(lifecycle.commitSpawn).toHaveBeenCalledOnce()
  })

  it('fences creation and invokes fatal handling when commit fails after native spawn', async () => {
    const events: string[] = []
    mockPtySpawn.mockImplementation(() => {
      events.push('native-spawn')
      return createTerm(events)
    })
    const failure = new Error('simulated commit fsync failure')
    const lifecycle = {
      prepareSpawn: vi.fn(async () => ({
        kind: 'spawn',
        runtime: { service: { namespace: authorityNamespace } },
        pane: {},
        allocation: {}
      })),
      commitSpawn: vi.fn(async () => {
        throw failure
      }),
      cancelSpawn: vi.fn(),
      closePty: vi.fn(),
      recordExit: vi.fn(),
      bindingIsReachable: vi.fn(() => true)
    }
    const onFailure = vi.fn()
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver(),
      onTerminalSessionAuthorityFailure: onFailure
    })
    registerHandler(handler)

    await expect(
      dispatcher.callRequest('pty.spawn', spawnParams(), requestContext(7))
    ).rejects.toThrow(failure.message)
    expect(mockPtySpawn).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(failure)
    await expect(
      dispatcher.callRequest('pty.spawn', spawnParams(), requestContext(7))
    ).rejects.toThrow('PTY handler is shutting down')
    expect(mockPtySpawn).toHaveBeenCalledOnce()
  })

  it('fails closed when pre-commit PTY output exceeds its bound', async () => {
    const events: string[] = []
    const term = createTerm(events)
    mockPtySpawn.mockReturnValue(term)
    const lifecycle = authorityLifecycleMock()
    lifecycle.commitSpawn.mockImplementation(async (_prepared, incarnationId: string) => {
      const earlyData = term.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined
      earlyData?.('x'.repeat(TERMINAL_AUTHORITY_EARLY_OUTPUT_MAX_BYTES + 1))
      return {
        runtime: { service: { namespace: authorityNamespace } },
        pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
        binding: {
          ownerIncarnationId: 'owner-a',
          physicalPtyId: 'pty-1',
          ptyIncarnationId: incarnationId
        }
      }
    })
    const onFailure = vi.fn()
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver(),
      onTerminalSessionAuthorityFailure: onFailure
    })
    registerHandler(handler)

    await expect(
      dispatcher.callRequest('pty.spawn', spawnParams(), requestContext(7))
    ).rejects.toThrow('terminal_session_authority_early_output_capacity_exceeded')
    expect(onFailure).toHaveBeenCalledOnce()
    expect(term.resume).not.toHaveBeenCalled()
    await expect(
      dispatcher.callRequest('pty.spawn', spawnParams(), requestContext(7))
    ).rejects.toThrow('PTY handler is shutting down')
  })

  it('does not turn an absent legacy authority binding into PTY death', async () => {
    const dispatcher = createDispatcher()
    const lifecycle = {
      missingPtyState: vi.fn(async () => ({ kind: 'unknown' as const }))
    }
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver()
    })
    registerHandler(handler)

    const params = attachParams('legacy-pty', 'legacy-incarnation')
    await expect(dispatcher.callRequest('pty.attach', params, requestContext(7))).rejects.toThrow(
      TERMINAL_SESSION_AUTHORITY_BINDING_UNKNOWN_ERROR
    )
    expect(lifecycle.missingPtyState).toHaveBeenCalledWith(params, 'legacy-pty')
  })

  it('reports not-found only after the durable authority proves retirement', async () => {
    const dispatcher = createDispatcher()
    const lifecycle = {
      missingPtyState: vi.fn(async () => ({ kind: 'retired' as const }))
    }
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver()
    })
    registerHandler(handler)

    await expect(
      dispatcher.callRequest(
        'pty.attach',
        attachParams('retired-pty', 'retired-incarnation'),
        requestContext(7)
      )
    ).rejects.toThrow('PTY "retired-pty" not found')
  })

  it('keeps an unreachable imported predecessor distinct from PTY death', async () => {
    const dispatcher = createDispatcher()
    const lifecycle = {
      missingPtyState: vi.fn(async () => ({
        kind: 'unreachable-predecessor' as const,
        pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
        binding: {
          ownerIncarnationId: 'legacy-owner',
          physicalPtyId: 'legacy-pty',
          ptyIncarnationId: 'legacy-incarnation'
        }
      }))
    }
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver()
    })
    registerHandler(handler)

    await expect(
      dispatcher.callRequest(
        'pty.attach',
        attachParams('legacy-pty', 'legacy-incarnation'),
        requestContext(7)
      )
    ).rejects.toThrow('terminal_session_authority_binding_unreachable')
  })

  it('routes an imported reachable binding with its exact owner and renderer generation', async () => {
    const dispatcher = createDispatcher()
    const binding = {
      ownerIncarnationId: 'legacy-owner',
      physicalPtyId: 'legacy-pty',
      ptyIncarnationId: 'legacy-incarnation'
    }
    const lifecycle = {
      missingPtyState: vi.fn(async () => ({
        kind: 'reachable-record' as const,
        pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
        binding
      }))
    }
    const router = {
      attachReachablePty: vi.fn(async () => ({ incarnationId: binding.ptyIncarnationId }))
    }
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: currentOwnerResolver(),
      legacyPhysicalWorkerAttachRouter: router as LegacyPhysicalWorkerAttachRouter
    })
    registerHandler(handler)

    await expect(
      dispatcher.callRequest(
        'pty.attach',
        attachParams(binding.physicalPtyId, binding.ptyIncarnationId),
        requestContext(7)
      )
    ).resolves.toEqual({ incarnationId: binding.ptyIncarnationId })
    expect(router.attachReachablePty).toHaveBeenCalledWith(
      expect.objectContaining({
        pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
        binding,
        worktreeId: 'repo::/srv/repo'
      })
    )
  })

  it('publishes authority access only to a client with the additive grant', async () => {
    const events: string[] = []
    mockPtySpawn.mockReturnValue(createTerm(events))
    const lifecycle = authorityLifecycleMock()
    const resolver = {
      classify: vi.fn(async () => 'current-owner' as const)
    }
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: resolver as TerminalAuthorityExactPtyAccessResolver
    })
    const policyConsumer = authorityPolicyConsumer()
    registerHandler(handler, (clientId) => (clientId === 7 ? policyConsumer : null))

    const spawned = (await dispatcher.callRequest(
      'pty.spawn',
      spawnParams(),
      requestContext(7)
    )) as Record<string, unknown>
    expect(spawned.terminalSessionAuthorityAccess).toMatchObject({
      namespace: authorityNamespace,
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
      binding: {
        physicalPtyId: spawned.id,
        ptyIncarnationId: spawned.incarnationId
      }
    })

    const grantedInventory = (await dispatcher.callRequest(
      'pty.listProcesses',
      {},
      requestContext(7)
    )) as Record<string, unknown>[]
    const legacyInventory = (await dispatcher.callRequest(
      'pty.listProcesses',
      {},
      requestContext(8)
    )) as Record<string, unknown>[]
    expect(grantedInventory[0].terminalSessionAuthorityAccess).toEqual(
      spawned.terminalSessionAuthorityAccess
    )
    expect(legacyInventory[0].terminalSessionAuthorityAccess).toBeUndefined()
  })

  it('applies all five mutations only to the exact current authority binding', async () => {
    const events: string[] = []
    const term = createTerm(events)
    mockPtySpawn.mockReturnValue(term)
    const lifecycle = authorityLifecycleMock()
    let closed = false
    lifecycle.closePty.mockImplementation(async () => {
      closed = true
    })
    lifecycle.bindingIsReachable.mockImplementation(() => !closed)
    const resolver = {
      classify: vi.fn(async () => 'current-owner-closed' as const)
    }
    const onFailure = vi.fn()
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: resolver as TerminalAuthorityExactPtyAccessResolver,
      onTerminalSessionAuthorityFailure: onFailure
    })
    const policyConsumer = authorityPolicyConsumer()
    registerHandler(handler, () => policyConsumer)
    const spawned = (await dispatcher.callRequest(
      'pty.spawn',
      spawnParams(),
      requestContext(7)
    )) as Record<string, unknown>
    const exact = {
      id: spawned.id,
      terminalSessionAuthorityAccess: spawned.terminalSessionAuthorityAccess
    }

    dispatcher.callNotification(
      'pty.dataAuthorityExact',
      { ...exact, data: 'input' },
      requestContext(7)
    )
    dispatcher.callNotification(
      'pty.resizeAuthorityExact',
      { ...exact, cols: 120, rows: 40 },
      requestContext(7)
    )
    await expect(
      dispatcher.callRequest(
        'pty.sendSignalAuthorityExact',
        { ...exact, signal: 'SIGINT' },
        requestContext(7)
      )
    ).resolves.toEqual({ accepted: true })
    await expect(
      dispatcher.callRequest('pty.clearBufferAuthorityExact', exact, requestContext(7))
    ).resolves.toEqual({ accepted: true })

    expect(term.write).toHaveBeenCalledWith('input')
    expect(term.resize).toHaveBeenCalledWith(120, 40)
    expect(term.kill).toHaveBeenCalledWith('SIGINT')
    expect(term.clear).toHaveBeenCalledOnce()

    const stale = {
      ...exact,
      terminalSessionAuthorityAccess: {
        ...(spawned.terminalSessionAuthorityAccess as Record<string, unknown>),
        pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:4' }
      }
    }
    dispatcher.callNotification(
      'pty.dataAuthorityExact',
      { ...stale, data: 'stale' },
      requestContext(7)
    )
    await expect(
      dispatcher.callRequest(
        'pty.sendSignalAuthorityExact',
        { ...stale, signal: 'SIGTERM' },
        requestContext(7)
      )
    ).resolves.toEqual({ accepted: false })
    expect(term.write).toHaveBeenCalledOnce()
    expect(term.kill).toHaveBeenCalledOnce()

    dispatcher.callNotification('pty.data', { id: spawned.id, data: 'legacy' }, requestContext(7))
    dispatcher.callNotification(
      'pty.dataExact',
      { id: spawned.id, incarnationId: spawned.incarnationId, data: 'incarnation-only' },
      requestContext(7)
    )
    await expect(
      dispatcher.callRequest(
        'pty.sendSignalExact',
        { id: spawned.id, incarnationId: spawned.incarnationId, signal: 'SIGTERM' },
        requestContext(7)
      )
    ).rejects.toThrow('terminal_authority_incarnation_mutation_rejected')
    await expect(
      dispatcher.callRequest('pty.shutdown', { id: spawned.id, immediate: true }, requestContext(7))
    ).rejects.toThrow('terminal_authority_legacy_mutation_rejected')
    expect(term.write).toHaveBeenCalledOnce()
    expect(term.kill).toHaveBeenCalledOnce()

    await expect(
      dispatcher.callRequest(
        'pty.shutdownAuthorityExact',
        {
          ...exact,
          immediate: false,
          keepHistory: true
        },
        requestContext(7)
      )
    ).resolves.toEqual({ accepted: true })
    await expect(
      dispatcher.callRequest(
        'pty.shutdownAuthorityExact',
        {
          ...exact,
          immediate: false,
          keepHistory: true
        },
        requestContext(7)
      )
    ).resolves.toEqual({ accepted: true })
    expect(term.kill).toHaveBeenCalledWith('SIGTERM')
    expect(term.kill).toHaveBeenCalledTimes(2)
    expect(lifecycle.closePty).toHaveBeenCalledTimes(2)
    expect(lifecycle.closePty.mock.invocationCallOrder[0]).toBeLessThan(
      term.kill.mock.invocationCallOrder[1]
    )
    expect(resolver.classify).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('re-ensures a durably retired current binding without closing topology again', async () => {
    const events: string[] = []
    const term = createTerm(events)
    mockPtySpawn.mockReturnValue(term)
    const lifecycle = authorityLifecycleMock()
    const resolver = { classify: vi.fn(async () => 'exited' as const) }
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: resolver as TerminalAuthorityExactPtyAccessResolver
    })
    registerHandler(handler)
    const spawned = (await dispatcher.callRequest(
      'pty.spawn',
      spawnParams(),
      requestContext(7)
    )) as Record<string, unknown>
    const access: TerminalSessionAuthorityPtyAccess = {
      namespace: authorityNamespace,
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
      binding: {
        ownerIncarnationId: 'owner-a',
        physicalPtyId: String(spawned.id),
        ptyIncarnationId: String(spawned.incarnationId)
      }
    }
    const exit = term.onExit.mock.calls.at(-1)?.[0] as
      | ((event: { exitCode: number }) => void)
      | undefined
    const kill = term.kill
    kill.mockImplementation(() => exit?.({ exitCode: 137 }))

    await expect(
      handler.ensureTerminalSessionAuthorityBindingRetired(access, 'close')
    ).resolves.toBeUndefined()
    await expect(
      handler.ensureTerminalSessionAuthorityBindingRetired(access, 'close')
    ).resolves.toBeUndefined()

    expect(kill).toHaveBeenCalledWith('SIGKILL')
    expect(lifecycle.closePty).not.toHaveBeenCalled()
    expect(lifecycle.recordExit).toHaveBeenCalledWith(expect.anything(), 137)
  })

  it('never retargets a retired effect at a successor reusing the physical ID', async () => {
    const events: string[] = []
    const term = createTerm(events)
    mockPtySpawn.mockReturnValue(term)
    const lifecycle = authorityLifecycleMock()
    const resolver = { classify: vi.fn(async () => 'current-owner-closed' as const) }
    const dispatcher = createDispatcher()
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: resolver as TerminalAuthorityExactPtyAccessResolver
    })
    registerHandler(handler)
    const spawned = (await dispatcher.callRequest(
      'pty.spawn',
      spawnParams(),
      requestContext(7)
    )) as Record<string, unknown>
    const retired: TerminalSessionAuthorityPtyAccess = {
      namespace: authorityNamespace,
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:2' },
      binding: {
        ownerIncarnationId: 'owner-a',
        physicalPtyId: String(spawned.id),
        ptyIncarnationId: 'retired-incarnation'
      }
    }

    await expect(
      handler.ensureTerminalSessionAuthorityBindingRetired(retired, 'close')
    ).resolves.toBeUndefined()
    expect(term.kill).not.toHaveBeenCalled()
    expect(resolver.classify).toHaveBeenCalledWith(retired)
  })

  it('replays an imported retirement only through the captured exact worker route', async () => {
    const dispatcher = createDispatcher()
    const lifecycle = authorityLifecycleMock()
    const access: TerminalSessionAuthorityPtyAccess = {
      namespace: authorityNamespace,
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
      binding: {
        ownerIncarnationId: 'legacy-owner',
        physicalPtyId: 'legacy-pty',
        ptyIncarnationId: 'legacy-incarnation'
      }
    }
    const ensureAuthorityShutdown = vi.fn(async () => true)
    const router = {
      attachReachablePty: vi.fn(),
      dispatchMutation: vi.fn(),
      dispatchAuthorityMutation: vi.fn(),
      dispatchAuthorityShutdown: vi.fn(),
      ensureAuthorityShutdown,
      setDeliveryPaused: vi.fn(() => false),
      handleDownstreamCredit: vi.fn(() => false),
      reservesPhysicalPtyId: vi.fn(() => false),
      reservesPublicPtyIdentity: vi.fn(() => false),
      dispose: vi.fn()
    }
    const resolver = { classify: vi.fn(async () => 'imported-owner-closed' as const) }
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: resolver as TerminalAuthorityExactPtyAccessResolver,
      legacyPhysicalWorkerPtyRouter: router as unknown as LegacyPhysicalWorkerPtyRouter
    })
    registerHandler(handler)

    await expect(
      handler.ensureTerminalSessionAuthorityBindingRetired(access, 'supersede')
    ).resolves.toBeUndefined()
    expect(ensureAuthorityShutdown).toHaveBeenCalledWith(access, {
      kind: 'shutdown',
      immediate: true
    })

    ensureAuthorityShutdown.mockResolvedValue(false)
    await expect(
      handler.ensureTerminalSessionAuthorityBindingRetired(access, 'supersede')
    ).rejects.toThrow('terminal_session_authority_physical_shutdown_pending')
  })

  it('keeps ID-only mutations local while exact imported mutations use the worker route', async () => {
    const dispatcher = createDispatcher()
    const lifecycle = authorityLifecycleMock()
    const access = {
      namespace: authorityNamespace,
      pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
      binding: {
        ownerIncarnationId: 'legacy-owner',
        physicalPtyId: 'legacy-pty',
        ptyIncarnationId: 'legacy-incarnation'
      }
    }
    const router = {
      attachReachablePty: vi.fn(),
      dispatchMutation: vi.fn(async () => true),
      dispatchAuthorityMutation: vi.fn(async () => true),
      dispatchAuthorityShutdown: vi.fn(
        async (_access, _mutation, persistClose: () => Promise<void>) => {
          await persistClose()
          return true
        }
      ),
      setDeliveryPaused: vi.fn(() => false),
      handleDownstreamCredit: vi.fn(() => false),
      reservesPhysicalPtyId: vi.fn(() => false),
      reservesPublicPtyIdentity: vi.fn(() => false),
      dispose: vi.fn()
    }
    const resolver = { classify: vi.fn(async () => 'imported-owner' as const) }
    const handler = new PtyHandler(dispatcher as unknown as RelayDispatcher, undefined, {
      terminalSessionAuthority: lifecycle as unknown as TerminalSessionAuthorityPtyLifecycle,
      terminalAuthorityExactPtyAccessResolver: resolver as TerminalAuthorityExactPtyAccessResolver,
      legacyPhysicalWorkerPtyRouter: router as unknown as LegacyPhysicalWorkerPtyRouter
    })
    const policyConsumer = authorityPolicyConsumer()
    registerHandler(handler, () => policyConsumer)

    await expect(
      dispatcher.callRequest('pty.shutdown', { id: 'legacy-pty', immediate: false })
    ).resolves.toBeUndefined()
    expect(router.dispatchMutation).not.toHaveBeenCalled()

    await expect(
      dispatcher.callRequest('pty.shutdownExact', {
        id: 'legacy-pty',
        incarnationId: 'legacy-incarnation',
        immediate: true,
        keepHistory: true
      })
    ).resolves.toEqual({ accepted: true })
    expect(router.dispatchMutation).toHaveBeenCalledWith('legacy-pty', 'legacy-incarnation', {
      kind: 'shutdown',
      immediate: true,
      keepHistory: true
    })

    await expect(
      dispatcher.callRequest(
        'pty.shutdownAuthorityExact',
        {
          id: 'legacy-pty',
          terminalSessionAuthorityAccess: access,
          immediate: true,
          keepHistory: false
        },
        requestContext(7)
      )
    ).resolves.toEqual({ accepted: true })
    expect(lifecycle.closeExactPtyAccess).toHaveBeenCalledWith(access, policyConsumer)
    expect(router.dispatchAuthorityShutdown).toHaveBeenCalledWith(
      access,
      {
        kind: 'shutdown',
        immediate: true,
        keepHistory: false
      },
      expect.any(Function)
    )
  })

  it('durably records an unknown-code exit when attach proves the managed PID is dead', async () => {
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
    vi.spyOn(ptyShellUtils, 'isProcessAlive').mockReturnValue(false)

    await expect(
      dispatcher.callRequest(
        'pty.attach',
        attachParams(spawned.id, spawned.incarnationId),
        requestContext(7)
      )
    ).rejects.toThrow(`PTY "${spawned.id}" not found`)
    expect(lifecycle.recordExit).toHaveBeenCalledWith(expect.anything(), null)
  })

  it('fences read-only PTY inspection when the durable binding is unreachable', async () => {
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
    )) as { id: string }
    lifecycle.bindingIsReachable.mockReturnValue(false)

    await expect(dispatcher.callRequest('pty.getSize', { id: spawned.id })).resolves.toBeNull()
    await expect(dispatcher.callRequest('pty.getCwd', { id: spawned.id })).rejects.toThrow(
      'not found'
    )
    await expect(dispatcher.callRequest('pty.getInitialCwd', { id: spawned.id })).rejects.toThrow(
      'not found'
    )
    await expect(dispatcher.callRequest('pty.hasChildProcesses', { id: spawned.id })).resolves.toBe(
      false
    )
    await expect(
      dispatcher.callRequest('pty.getForegroundProcess', { id: spawned.id })
    ).resolves.toBeNull()
    await expect(dispatcher.callRequest('pty.inspectProcess', { id: spawned.id })).rejects.toThrow(
      'terminal_gone'
    )
    await expect(dispatcher.callRequest('pty.serialize', { ids: [spawned.id] })).resolves.toBe('[]')
  })
})
