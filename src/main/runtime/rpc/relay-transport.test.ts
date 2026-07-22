import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocketClient, { WebSocketServer, type WebSocket } from 'ws'
import { CloudRelayTransport } from './relay-transport'

function nextMessage(ws: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
  return new Promise((resolve) => {
    ws.once('message', (data, isBinary) => resolve({ data: Buffer.from(data as Buffer), isBinary }))
  })
}

describe('CloudRelayTransport', () => {
  const servers: WebSocketServer[] = []
  const transports: CloudRelayTransport[] = []

  afterEach(async () => {
    await Promise.all(transports.splice(0).map((transport) => transport.stop()))
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            for (const client of server.clients) {
              client.terminate()
            }
            server.close(() => resolve())
          })
      )
    )
  })

  it('authenticates one query-free host-data socket and forwards messages verbatim', async () => {
    const server = new WebSocketServer({ port: 0, perMessageDeflate: false })
    servers.push(server)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (typeof address === 'string' || address === null) {
      throw new Error('expected TCP relay test server')
    }
    const accepted = new Promise<{ socket: WebSocket; path: string }>((resolve) => {
      server.once('connection', (socket, request) => resolve({ socket, path: request.url ?? '' }))
    })
    let clientSocket: WebSocketClient | null = null
    const onConnectionClosed = vi.fn()
    const transport = new CloudRelayTransport({
      cellUrl: `http://127.0.0.1:${address.port}`,
      relayHostId: 'AbCdEf0123_-xyZ9',
      generation: 7,
      createSocket: (url) => {
        clientSocket = new WebSocketClient(url, { perMessageDeflate: false })
        return clientSocket
      },
      onConnectionClosed
    })
    transports.push(transport)
    const received: (string | Uint8Array<ArrayBufferLike>)[] = []
    transport.onMessage((message) => received.push(message))
    transport.onConnectionClose(vi.fn())
    await transport.start()
    const opening = transport.openConnection({
      connId: 'conn/with spaces',
      connTicket: 'ticket-1',
      kind: 'resume',
      relayDeviceId: 'device-1',
      attachDeadlineMs: 1_000
    })
    const { socket, path } = await accepted
    const auth = await nextMessage(socket)
    await opening

    expect(path).toBe('/v1/host/data/conn%2Fwith%20spaces')
    expect(auth.isBinary).toBe(false)
    expect(JSON.parse(auth.data.toString())).toEqual({
      type: 'host-data-auth',
      v: 1,
      connTicket: 'ticket-1',
      generation: 7
    })
    socket.send('e2ee-hello')
    socket.send(Buffer.from([1, 2, 3]), { binary: true })
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(received[0]).toBe('e2ee-hello')
    expect(received[1]).toEqual(new Uint8Array([1, 2, 3]))

    expect(clientSocket).not.toBeNull()
    const metadata = transport.metadataFor(clientSocket!)
    expect(metadata).toEqual({
      transport: 'relay',
      relayHostId: 'AbCdEf0123_-xyZ9',
      relayDeviceId: 'device-1',
      basisConnId: 'conn/with spaces',
      credentialKind: 'resume'
    })
    socket.close()
    await vi.waitFor(() => expect(onConnectionClosed).toHaveBeenCalledWith('conn/with spaces'))
  })

  it('stop() resolves after the close timeout when a socket never emits close', async () => {
    vi.useFakeTimers()
    try {
      const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
      const addListener = (event: string, fn: (...args: unknown[]) => void): void => {
        const existing = listeners.get(event) ?? []
        existing.push(fn)
        listeners.set(event, existing)
      }
      const removeListener = (event: string, fn: (...args: unknown[]) => void): void => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((listener) => listener !== fn)
        )
      }
      const emit = (event: string, ...args: unknown[]): void => {
        for (const fn of listeners.get(event) ?? []) {
          fn(...args)
        }
      }
      // Why: models a half-open post-sleep relay socket — terminate() never
      // produces a 'close' event, which previously hung stop() forever.
      const fakeSocket = {
        readyState: 1,
        OPEN: 1,
        CLOSED: 3,
        on: addListener,
        once: addListener,
        off: removeListener,
        send: () => {},
        terminate: () => {}
      }
      const onConnectionClosed = vi.fn()
      const transport = new CloudRelayTransport({
        cellUrl: 'http://127.0.0.1:9',
        relayHostId: 'AbCdEf0123_-xyZ9',
        generation: 1,
        createSocket: () => fakeSocket as unknown as WebSocketClient,
        onConnectionClosed
      })
      const opening = transport.openConnection({
        connId: 'conn-1',
        connTicket: 'ticket-1',
        kind: 'resume',
        relayDeviceId: 'device-1',
        attachDeadlineMs: 1_000
      })
      emit('open')
      await opening

      let stopped = false
      const stopPromise = transport.stop().then(() => {
        stopped = true
      })
      await vi.advanceTimersByTimeAsync(4_999)
      expect(stopped).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await stopPromise
      expect(stopped).toBe(true)
      expect(onConnectionClosed).toHaveBeenCalledWith('conn-1')
      expect(() => transport.metadataFor(fakeSocket as unknown as WebSocketClient)).toThrow(
        'unknown_relay_socket'
      )
      expect(() => transport.setGeneration(2)).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('observes a synchronous close emitted by terminate without waiting for the deadline', async () => {
    vi.useFakeTimers()
    try {
      const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
      const addListener = (event: string, fn: (...args: unknown[]) => void): void => {
        listeners.set(event, [...(listeners.get(event) ?? []), fn])
      }
      const emit = (event: string): void => {
        for (const fn of listeners.get(event) ?? []) {
          fn()
        }
      }
      const fakeSocket = {
        readyState: 1,
        OPEN: 1,
        CLOSED: 3,
        on: addListener,
        once: addListener,
        off: vi.fn(),
        send: () => {},
        terminate: () => emit('close')
      }
      const transport = new CloudRelayTransport({
        cellUrl: 'http://127.0.0.1:9',
        relayHostId: 'AbCdEf0123_-xyZ9',
        generation: 1,
        createSocket: () => fakeSocket as unknown as WebSocketClient
      })
      const opening = transport.openConnection({
        connId: 'conn-sync-close',
        connTicket: 'ticket-1',
        kind: 'resume',
        relayDeviceId: 'device-1',
        attachDeadlineMs: 1_000
      })
      emit('open')
      await opening

      await transport.stop()

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects non-origin cell URLs before opening a socket', () => {
    expect(
      () =>
        new CloudRelayTransport({
          cellUrl: 'https://relay.example/path?credential=forbidden',
          relayHostId: 'AbCdEf0123_-xyZ9',
          generation: 1
        })
    ).toThrow('relay_cell_url_must_be_an_origin')
  })
})
