import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DaemonServer } from './daemon-server'
import type { DaemonStreamDataBatcher } from './daemon-stream-data-batcher'
import type { BackgroundTransientFactRelay } from './daemon-background-transient-facts'
import type { PendingStreamDataBatch } from './daemon-stream-keep-tail-drop'
import type { SubprocessHandle } from './session'
import type { DaemonRequest } from './types'
import {
  sameTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthorityPtyOwner } from '../session-authority/terminal-session-authority-pty-owner'
import { TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY } from './daemon-hello-protocol'

type MockSubprocess = SubprocessHandle & {
  emitData(data: string): void
  emitExit(code: number): void
}

type DaemonLifecyclePrivate = {
  clients: Map<
    string,
    {
      clientId: string
      controlSocket: Socket
      streamSocket: Socket | null
      authenticatedPairEstablished: boolean
      capabilities?: {
        terminalSessionAuthority: 1
        terminalAuthorityConsumerProof?: { version: 1; authorityHostId: string }
      }
      authorityConsumerTransport?: { token: object }
      authorityNamespaceSessions?: Map<
        string,
        { session: { policyConsumer: unknown; disconnect(): void }; acceptances: { close(): void } }
      >
    }
  >
  host: {
    getPartialEscapeTailAnsi(sessionId: string): string
  }
  routeRequest(clientId: string, request: DaemonRequest): Promise<unknown>
  streamDataBatcher: DaemonStreamDataBatcher
  transientFactRelay: BackgroundTransientFactRelay
  streamClientIdBySessionId: Map<string, string>
}

function createMockSubprocess(): MockSubprocess {
  let onData: ((data: string) => void) | undefined
  let onExit: ((code: number) => void) | undefined
  return {
    pid: 55_555,
    getForegroundProcess: () => null,
    write: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(() => onExit?.(0)),
    forceKill: vi.fn(() => onExit?.(137)),
    signal: vi.fn(),
    onData(callback) {
      onData = callback
    },
    onExit(callback) {
      onExit = callback
    },
    dispose: vi.fn(),
    emitData(data) {
      onData?.(data)
    },
    emitExit(code) {
      onExit?.(code)
    }
  }
}

function createServerHarness(
  terminalSessionAuthority?: ConstructorParameters<
    typeof DaemonServer
  >[0]['terminalSessionAuthority']
) {
  const subprocesses: MockSubprocess[] = []
  const unique = randomUUID()
  const server = new DaemonServer({
    socketPath: join(tmpdir(), `orca-droppability-${unique}.sock`),
    tokenPath: join(tmpdir(), `orca-droppability-${unique}.token`),
    spawnSubprocess: () => {
      const subprocess = createMockSubprocess()
      subprocesses.push(subprocess)
      return subprocess
    },
    ...(terminalSessionAuthority
      ? {
          terminalSessionAuthority,
          terminalSessionAuthorityCapabilityReadiness: {
            hostEffectConsumerInstalled: () => true
          }
        }
      : {})
  })
  return {
    server,
    daemon: server as unknown as DaemonLifecyclePrivate,
    subprocesses
  }
}

function addClient(
  daemon: DaemonLifecyclePrivate,
  writableLength = 0,
  authority = false
): Socket & { write: ReturnType<typeof vi.fn>; writableLength: number } {
  const controlSocket = { destroy: vi.fn() } as unknown as Socket
  const streamSocket = {
    destroyed: false,
    writableLength,
    destroy: vi.fn(),
    write: vi.fn(() => true)
  } as unknown as Socket & {
    write: ReturnType<typeof vi.fn>
    writableLength: number
  }
  const policyIdentity = {
    consumerId: 'app-profile:droppability-test',
    consumerIncarnationId: 'app-process:droppability-test'
  }
  // Authority admission is proof-only, so the client carries a negotiated proof grant and one
  // already-admitted namespace session rather than a self-named consumer.
  const policyConsumer = {
    identity: policyIdentity,
    assertInstalled: () => {},
    isInstalled: () => true,
    disconnect: () => {}
  }
  daemon.clients.set('client-1', {
    clientId: 'client-1',
    controlSocket,
    streamSocket,
    authenticatedPairEstablished: true,
    ...(authority
      ? {
          capabilities: {
            terminalSessionAuthority: TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY,
            terminalAuthorityConsumerProof: { version: 1 as const, authorityHostId: 'host-a' }
          },
          authorityConsumerTransport: { token: Object.freeze({}) },
          authorityNamespaceSessions: new Map([
            [
              JSON.stringify(['host-a', 'namespace-a']),
              {
                session: { policyConsumer, disconnect: () => {} },
                acceptances: { close: () => {} }
              }
            ]
          ])
        }
      : {})
  })
  return streamSocket
}

function pendingBatch(batcher: DaemonStreamDataBatcher): PendingStreamDataBatch {
  const pending = (
    batcher as unknown as {
      pendingByClient: Map<string, PendingStreamDataBatch>
    }
  ).pendingByClient.get('client-1')
  if (!pending) {
    throw new Error('Missing client-1 stream batch')
  }
  return pending
}

describe('daemon stream droppability lifecycle', () => {
  let server: DaemonServer | undefined

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    await server?.shutdown()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('refreshes after every background mutation and before changed markers', async () => {
    const harness = createServerHarness()
    server = harness.server
    const { daemon } = harness
    addClient(daemon)
    daemon.streamClientIdBySessionId.set('session-toggle', 'client-1')
    vi.spyOn(daemon.host, 'getPartialEscapeTailAnsi').mockReturnValue('')
    const lifecycle: string[] = []
    vi.spyOn(daemon.streamDataBatcher, 'refreshSessionDroppability').mockImplementation(
      (sessionId) => {
        lifecycle.push(`refresh:${String(daemon.transientFactRelay.isBackgrounded(sessionId))}`)
      }
    )
    vi.spyOn(daemon.streamDataBatcher, 'enqueueControlEvent').mockImplementation(
      (_clientId, _sessionId, control) => {
        lifecycle.push(
          `marker:${String(
            control.event === 'sessionBackgroundMarker' && control.payload.background
          )}`
        )
      }
    )

    await daemon.routeRequest('client-1', {
      id: 'background',
      type: 'setSessionBackground',
      payload: { sessionId: 'session-toggle', background: true }
    })
    expect(lifecycle).toEqual(['refresh:true', 'marker:true'])

    lifecycle.length = 0
    await daemon.routeRequest('client-1', {
      id: 'duplicate-background',
      type: 'setSessionBackground',
      payload: { sessionId: 'session-toggle', background: true }
    })
    expect(lifecycle).toEqual(['refresh:true'])

    lifecycle.length = 0
    await daemon.routeRequest('client-1', {
      id: 'foreground',
      type: 'setSessionBackground',
      payload: { sessionId: 'session-toggle', background: false }
    })
    expect(lifecycle).toEqual(['refresh:false', 'marker:false'])
  })

  it('returns a provisional 2031 subscribe with the foreground handoff marker', async () => {
    const harness = createServerHarness()
    server = harness.server
    const { daemon } = harness
    addClient(daemon)
    daemon.streamClientIdBySessionId.set('session-toggle', 'client-1')
    daemon.transientFactRelay.setSessionBackground('session-toggle', true)
    daemon.transientFactRelay.onSessionData('session-toggle', '\x1b[?2031h\x1b[?')
    vi.spyOn(daemon.host, 'getPartialEscapeTailAnsi').mockReturnValue('\x1b[?')
    const enqueue = vi.spyOn(daemon.streamDataBatcher, 'enqueueControlEvent')

    await daemon.routeRequest('client-1', {
      id: 'foreground',
      type: 'setSessionBackground',
      payload: { sessionId: 'session-toggle', background: false }
    })

    expect(enqueue).toHaveBeenCalledWith(
      'client-1',
      'session-toggle',
      expect.objectContaining({
        event: 'sessionBackgroundMarker',
        payload: {
          background: false,
          scanSeedAnsi: '\x1b[?',
          mode2031PendingSubscribe: true
        }
      })
    )
  })

  it('routes an attached session before refresh and emits its background marker after', async () => {
    const harness = createServerHarness()
    server = harness.server
    const { daemon } = harness
    addClient(daemon)
    daemon.transientFactRelay.setSessionBackground('session-attach', true)
    const lifecycle: string[] = []
    vi.spyOn(daemon.streamDataBatcher, 'refreshSessionDroppability').mockImplementation(
      (sessionId) => {
        lifecycle.push(`refresh:${daemon.streamClientIdBySessionId.get(sessionId) ?? 'unrouted'}`)
      }
    )
    vi.spyOn(daemon.streamDataBatcher, 'enqueueControlEvent').mockImplementation(
      (_clientId, _sessionId, control) => {
        lifecycle.push(`marker:${control.event}`)
      }
    )

    await daemon.routeRequest('client-1', {
      id: 'attach',
      type: 'createOrAttach',
      payload: { sessionId: 'session-attach', cols: 80, rows: 24 }
    })

    expect(lifecycle).toEqual(['refresh:client-1', 'marker:sessionBackgroundMarker'])
  })

  it('keeps legacy transient facts on the existing ordered stream', async () => {
    const harness = createServerHarness()
    server = harness.server
    const { daemon, subprocesses } = harness
    addClient(daemon)
    daemon.transientFactRelay.setSessionBackground('legacy-session', true)
    const enqueue = vi.spyOn(daemon.streamDataBatcher, 'enqueueControlEvent')

    await daemon.routeRequest('client-1', {
      id: 'attach',
      type: 'createOrAttach',
      payload: { sessionId: 'legacy-session', cols: 80, rows: 24 }
    })
    subprocesses[0]!.emitData('ding\x07')

    expect(enqueue).toHaveBeenCalledWith('client-1', 'legacy-session', {
      type: 'event',
      event: 'transientFact',
      sessionId: 'legacy-session',
      payload: { kind: 'bell' }
    })
  })

  it('persists authoritative facts against the captured binding without legacy publication', async () => {
    let currentAccess: TerminalSessionAuthorityPtyAccess | null = null
    const recordSemanticOutcome = vi.fn(
      async (_sessionId: string, access: TerminalSessionAuthorityPtyAccess) =>
        sameTerminalSessionAuthorityPtyAccess(currentAccess, access)
    )
    const owner = {
      prepareSpawn: vi.fn(async () => ({ kind: 'spawn', prepared: {} })),
      commitSpawn: vi.fn(async (_prepared: unknown, incarnationId: string) => {
        currentAccess = authorityAccess(incarnationId)
        return currentAccess
      }),
      cancelSpawn: vi.fn(async () => undefined),
      accessFor: vi.fn(() => currentAccess),
      admits: vi.fn((_id: string, access: TerminalSessionAuthorityPtyAccess) =>
        sameTerminalSessionAuthorityPtyAccess(currentAccess, access)
      ),
      recordSemanticOutcome,
      recordExit: vi.fn(async () => {
        currentAccess = null
      }),
      releaseAuthenticatedPolicyConsumerTransport: vi.fn(),
      close: vi.fn(async () => true),
      adopt: vi.fn()
    } as unknown as TerminalSessionAuthorityPtyOwner
    const harness = createServerHarness({ ptyOwner: owner })
    server = harness.server
    const { daemon, subprocesses } = harness
    addClient(daemon, 0, true)
    daemon.transientFactRelay.setSessionBackground('authority-session', true)
    const enqueue = vi.spyOn(daemon.streamDataBatcher, 'enqueueControlEvent')

    const result = (await daemon.routeRequest('client-1', {
      id: 'attach',
      type: 'createOrAttach',
      payload: {
        sessionId: 'authority-session',
        cols: 80,
        rows: 24,
        terminalSessionAuthorityVersion: 1,
        terminalSessionAuthorityOperationId: 'spawn-a',
        worktreeId: 'repo::/srv/repo',
        paneKey: 'pane-a',
        paneGeneration: 1
      }
    })) as { terminalSessionAuthorityAccess: TerminalSessionAuthorityPtyAccess }
    subprocesses[0]!.emitData('ding\x07')

    await vi.waitFor(() => expect(recordSemanticOutcome).toHaveBeenCalledOnce())
    expect(recordSemanticOutcome).toHaveBeenCalledWith(
      'authority-session',
      result.terminalSessionAuthorityAccess,
      { kind: 'bell' }
    )
    expect(enqueue.mock.calls.some(([, , event]) => event.event === 'transientFact')).toBe(false)
  })

  it('invalidates droppable membership for final output held behind a deep socket', async () => {
    const harness = createServerHarness()
    server = harness.server
    const { daemon, subprocesses } = harness
    addClient(daemon, 128 * 1024)
    daemon.transientFactRelay.setSessionBackground('session-exit', true)

    await daemon.routeRequest('client-1', {
      id: 'attach',
      type: 'createOrAttach',
      payload: { sessionId: 'session-exit', cols: 80, rows: 24 }
    })
    const subprocess = subprocesses[0]
    subprocess.emitData('final-output'.repeat(1024))
    expect(pendingBatch(daemon.streamDataBatcher).droppableQueuedSessionIds).toContain(
      'session-exit'
    )

    subprocess.emitExit(42)

    const batch = pendingBatch(daemon.streamDataBatcher)
    expect(batch.droppableQueuedSessionIds).not.toContain('session-exit')
    expect(batch.queuedCharsBySession.get('session-exit')).toBeGreaterThan(0)
    expect(batch.queue.at(-1)?.control).toMatchObject({
      event: 'exit',
      payload: { code: 42 }
    })
    expect(daemon.transientFactRelay.isBackgrounded('session-exit')).toBe(false)
    expect(daemon.streamClientIdBySessionId.has('session-exit')).toBe(false)
  })
})

function authorityAccess(ptyIncarnationId: string): TerminalSessionAuthorityPtyAccess {
  return {
    namespace: { authorityHostId: 'host-a', namespaceId: 'namespace-a' },
    pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:1' },
    binding: {
      ownerIncarnationId: 'owner-a',
      physicalPtyId: 'authority-session',
      ptyIncarnationId
    }
  }
}
