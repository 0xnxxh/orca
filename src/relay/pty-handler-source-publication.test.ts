import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PTY_STARTUP_INGRESS_VERSION } from '../shared/pty-startup-ingress'
import {
  RelayDispatcher,
  type RelayClientSessionIdentity,
  type SinkWriteSettlement
} from './dispatcher'
import { encodeJsonRpcFrame, MessageType } from './protocol'
import { PtyHandler } from './pty-handler'
import { RelayPtySourcePublication } from './relay-pty-source-publication'
import { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'

const { mockPtySpawn } = vi.hoisted(() => ({ mockPtySpawn: vi.fn() }))

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))

const endpointIdentity: RelayClientSessionIdentity = {
  principal: 'endpoint-principal',
  authenticated: true,
  allowSessionOwner: true,
  authenticationKind: 'endpoint-credential'
}

type Notification = { method: string; params: Record<string, unknown> }

function requestFrame(id: number, method: string, params: Record<string, unknown>): Buffer {
  return encodeJsonRpcFrame({ jsonrpc: '2.0', id, method, params }, id, 0)
}

function notification(buffer: Buffer): Notification | null {
  if (buffer[0] !== MessageType.Regular) {
    return null
  }
  const length = buffer.readUInt32BE(9)
  const message = JSON.parse(buffer.subarray(13, 13 + length).toString('utf8'))
  return typeof message.method === 'string' && message.id === undefined ? message : null
}

function responseResult(buffer: Buffer, id: number): Record<string, unknown> | null {
  if (buffer[0] !== MessageType.Regular) {
    return null
  }
  const length = buffer.readUInt32BE(9)
  const message = JSON.parse(buffer.subarray(13, 13 + length).toString('utf8'))
  return message.id === id ? (message.result ?? null) : null
}

describe('PtyHandler negotiated source publication', () => {
  let dispatcher: RelayDispatcher
  let handler: PtyHandler
  let publication: RelayPtySourcePublication
  let dataCallback: ((data: string) => void) | undefined
  let originalPlatform: PropertyDescriptor | undefined
  let writes: Buffer[]
  let heldResponseId: number | null
  let heldResponseSettlements: ((result: SinkWriteSettlement) => void)[]
  let adapter: SshPtyConsumerSessionAdapter

  beforeEach(async () => {
    vi.useFakeTimers()
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    writes = []
    heldResponseId = null
    heldResponseSettlements = []
    dataCallback = undefined
    mockPtySpawn.mockReset()
    mockPtySpawn.mockReturnValue({
      pid: process.pid,
      onData: vi.fn((callback: (data: string) => void) => {
        dataCallback = callback
      }),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      clear: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn()
    })
    dispatcher = new RelayDispatcher(
      (data, settle) => {
        writes.push(Buffer.from(data))
        if (heldResponseId !== null && responseResult(data, heldResponseId)) {
          heldResponseSettlements.push(settle)
          return true
        }
        settle({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    handler = new PtyHandler(dispatcher)
    adapter = new SshPtyConsumerSessionAdapter(dispatcher, 'build-a', undefined, (id) =>
      publication.onCreditAvailable(id)
    )
    publication = new RelayPtySourcePublication(dispatcher, adapter, (id) =>
      handler.handleSourcePublicationCapacity(id)
    )
    handler.setSourcePublication(publication)
    dispatcher.feed(
      requestFrame(1, 'pty.openClient', {
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        capabilities: { outputFlowControl: { versions: [1], requestedWindowSu: 1024 } }
      })
    )
    await vi.advanceTimersByTimeAsync(0)
  })

  afterEach(async () => {
    await handler.dispose({ waitForPhysicalExit: false }).catch(() => {})
    dispatcher.dispose()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    vi.useRealTimers()
  })

  async function spawn(params: Record<string, unknown>): Promise<void> {
    dispatcher.feed(requestFrame(2, 'pty.spawn', params))
    await vi.advanceTimersByTimeAsync(0)
    expect(dataCallback).toBeTypeOf('function')
  }

  function sourceDataFrames(): Notification[] {
    return writes
      .map(notification)
      .filter((frame): frame is Notification => frame?.method === 'pty.data')
  }

  it('settles a consumed POSIX startup query before publishing its prompt', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    await spawn({
      startupIngressVersion: PTY_STARTUP_INGRESS_VERSION,
      startupIngress: {
        colors: { foreground: '#2e3434', background: '#ffffff' },
        deadlineMs: 5_000
      }
    })
    const query = '\x1b]10;?\x07'

    dataCallback!(query)
    dataCallback!('prompt')
    await vi.advanceTimersByTimeAsync(9)

    expect(sourceDataFrames().map((frame) => frame.params)).toEqual([
      expect.objectContaining({
        data: '',
        rawLength: query.length,
        transformed: true,
        sourceLengthSu: query.length,
        sourceEndSu: query.length
      }),
      expect.objectContaining({
        data: 'prompt',
        rawLength: 6,
        sourceLengthSu: 6,
        sourceEndSu: query.length + 6
      })
    ])
    expect(publication.getDebugSnapshot()).toMatchObject({ sendCommitted: 2 })
  })

  it('settles a suppressed ConPTY query before publishing its prompt', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    await spawn({ shellOverride: 'powershell.exe' })
    const query = '\x1b]10;?\x07'

    dataCallback!(query)
    dataCallback!('PS> ')
    await vi.advanceTimersByTimeAsync(9)

    expect(sourceDataFrames().map((frame) => frame.params)).toEqual([
      expect.objectContaining({
        data: '',
        rawLength: query.length,
        transformed: true,
        sourceLengthSu: query.length,
        sourceEndSu: query.length
      }),
      expect.objectContaining({
        data: 'PS> ',
        rawLength: 4,
        sourceLengthSu: 4,
        sourceEndSu: query.length + 4
      })
    ])
    expect(publication.getDebugSnapshot()).toMatchObject({ sendCommitted: 2 })
  })

  it('activates a fresh source consumer when an operation response is lost and retried', async () => {
    const operationId = 'a'.repeat(43)
    const grant = writes.map((buffer) => responseResult(buffer, 1)).find(Boolean)!
    heldResponseId = 2
    dispatcher.feed(
      requestFrame(2, 'pty.spawn', {
        agentSessionCreateOperationId: operationId
      })
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(heldResponseSettlements).toHaveLength(1)

    dispatcher.invalidateClient()
    expect(adapter.getDebugSnapshot()).toMatchObject({ deliveryTokens: 0 })

    const replacementWrites: Buffer[] = []
    const replacementClientId = dispatcher.attachClient(
      (data, settle) => {
        replacementWrites.push(Buffer.from(data))
        settle({ ok: true })
        return true
      },
      { supportsWriteCallback: true },
      endpointIdentity
    )
    dispatcher.feedClient(
      replacementClientId,
      requestFrame(3, 'pty.openClient', {
        protocolVersion: 1,
        clientInstanceId: 'client-1',
        requestedRole: 'session-owner',
        resume: {
          ownerGeneration: grant.ownerGeneration,
          ownerLease: grant.ownerLease
        },
        capabilities: { outputFlowControl: { versions: [1], requestedWindowSu: 1024 } }
      })
    )
    await vi.advanceTimersByTimeAsync(0)
    dispatcher.feedClient(
      replacementClientId,
      requestFrame(4, 'pty.spawn', {
        agentSessionCreateOperationId: operationId
      })
    )
    await vi.advanceTimersByTimeAsync(0)

    dataCallback!('prompt')
    await vi.advanceTimersByTimeAsync(8)

    expect(mockPtySpawn).toHaveBeenCalledOnce()
    expect(
      responseResult(replacementWrites.find((buffer) => responseResult(buffer, 4))!, 4)
    ).toEqual({ id: 'pty-1', incarnationId: expect.any(String) })
    expect(
      replacementWrites.map(notification).find((frame) => frame?.method === 'pty.data')?.params
    ).toMatchObject({
      id: 'pty-1',
      data: 'prompt',
      sourceLengthSu: 6,
      sourceEndSu: 6
    })
    expect(adapter.getDebugSnapshot()).toMatchObject({ deliveryTokens: 1 })
  })
})
