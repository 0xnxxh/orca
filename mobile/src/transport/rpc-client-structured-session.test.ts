import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from './rpc-client'
import {
  MockWebSocket,
  mockSockets,
  originalWebSocket,
  sentRequest
} from './rpc-client-test-websocket'

vi.mock('./e2ee', () => ({
  generateKeyPair: () => ({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32)
  }),
  deriveSharedKey: () => new Uint8Array(32),
  publicKeyFromBase64: () => new Uint8Array(32),
  publicKeyToBase64: () => 'client-public-key',
  encrypt: (plaintext: string) => `encrypted:${plaintext}`,
  decrypt: (raw: string) => raw.replace(/^encrypted:/, ''),
  decryptBytes: (bytes: Uint8Array) => bytes
}))

describe('structured session RPC transport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSockets.length = 0
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  it('advertises structured agent sessions in encrypted authentication', () => {
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    const socket = mockSockets[0]!
    socket.open()
    socket.receive(JSON.stringify({ type: 'e2ee_ready' }))
    const auth = socket.sent
      .map((payload) => JSON.parse(payload.replace(/^encrypted:/, '')) as Record<string, unknown>)
      .find((payload) => payload.type === 'e2ee_auth')

    expect(auth).toEqual({
      type: 'e2ee_auth',
      deviceToken: 'token',
      clientCapabilities: ['agent-session.structured.v1']
    })
    client.close()
  })

  it('rebuilds a structured stream cursor when the transport reconnects', () => {
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    const first = mockSockets[0]!
    first.open()
    first.receive(JSON.stringify({ type: 'e2ee_ready' }))
    first.receive('encrypted:{"type":"e2ee_authenticated"}')
    let sequence = 4
    client.subscribe(
      'agentSession.subscribe',
      { sessionId: 'session-a', cursor: { epoch: 'epoch-a', sequence } },
      () => {},
      {
        paramsForReconnect: () => ({
          sessionId: 'session-a',
          cursor: { epoch: 'epoch-a', sequence }
        })
      }
    )
    sequence = 9
    first.close()
    vi.advanceTimersByTime(500)
    const second = mockSockets[1]!
    second.open()
    second.receive(JSON.stringify({ type: 'e2ee_ready' }))
    second.receive('encrypted:{"type":"e2ee_authenticated"}')

    expect(sentRequest(second, 'agentSession.subscribe').params).toEqual({
      sessionId: 'session-a',
      cursor: { epoch: 'epoch-a', sequence: 9 }
    })
    client.close()
  })

  it('unsubscribes a structured stream by its request-scoped subscription id', () => {
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    const socket = mockSockets[0]!
    socket.open()
    socket.receive(JSON.stringify({ type: 'e2ee_ready' }))
    socket.receive('encrypted:{"type":"e2ee_authenticated"}')
    const dispose = client.subscribe('agentSession.subscribe', { sessionId: 'session-a' }, () => {})
    const subscribe = sentRequest(socket, 'agentSession.subscribe')

    dispose()

    expect(sentRequest(socket, 'agentSession.unsubscribe').params).toEqual({
      sessionId: 'session-a',
      subscriptionId: subscribe.id
    })
    client.close()
  })
})
