import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  setupDaemonHandshake,
  runConnectHandshake,
  EXIT_CODE_VERSION_MISMATCH,
  type DaemonHandshakeClientRole
} from './relay-handshake'
import {
  encodeHandshakeFrame,
  encodeJsonRpcFrame,
  FrameDecoder,
  parseHandshakeMessage,
  type DecodedFrame,
  MessageType
} from './protocol'
import { relayTestSocketPath } from './relay-test-socket-path'
import {
  CURRENT_RELAY_DAEMON_COMPATIBILITY,
  type RelayDaemonCompatibilityOffer
} from '../shared/relay-daemon-compatibility'
import type { SshTerminalAuthorityEndpointIdentity } from '../shared/ssh-terminal-authority-marker'

// Why: --connect normally calls process.exit on mismatch / fatal handshake
// errors. Stub it for tests so the harness sees a thrown sentinel error
// rather than tearing down the test runner.
class ExitCalled extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

const AUTHORITY_IDENTITY: SshTerminalAuthorityEndpointIdentity = {
  authorityHostId: 'authority-host',
  ownerInstanceId: 'owner-instance',
  revision: 3
}

describe('handshake round-trip over a real Socket pair', () => {
  let server: Server
  let sockPath: string
  let tmpDir: string
  let exitSpy: ReturnType<typeof vi.spyOn>

  let uncaughtHandler: (err: Error) => void

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orca-handshake-test-'))
    sockPath = relayTestSocketPath(tmpDir)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitCalled(code ?? 0)
    }) as never)
    // Why: process.exit is called from inside async callbacks
    // (process.stderr.write flush callback) which would otherwise surface
    // as an uncaughtException after the test resolves and tear down the
    // runner. We swallow ExitCalled — exitSpy still records the call so
    // assertions hold.
    uncaughtHandler = (err: Error): void => {
      if (err instanceof ExitCalled) {
        return
      }
      throw err
    }
    process.on('uncaughtException', uncaughtHandler)
  })

  afterEach(async () => {
    process.off('uncaughtException', uncaughtHandler)
    exitSpy.mockRestore()
    for (const s of liveServerSockets) {
      s.destroy()
    }
    liveServerSockets.length = 0
    if (server) {
      await new Promise<void>((r) => server.close(() => r()))
    }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const liveServerSockets: Socket[] = []
  function trackServerSocket(s: Socket): Socket {
    liveServerSockets.push(s)
    return s
  }

  function startDaemon(
    version: string,
    endpointCredential?: string,
    compatibility?: RelayDaemonCompatibilityOffer,
    authorityIdentity?: SshTerminalAuthorityEndpointIdentity
  ): Promise<{
    accepted: Promise<{
      sock: Socket
      leftover: Buffer
      clientRole: DaemonHandshakeClientRole
    }>
  }> {
    return new Promise((resolve) => {
      const acceptedDeferred: {
        promise: Promise<{
          sock: Socket
          leftover: Buffer
          clientRole: DaemonHandshakeClientRole
        }>
        resolve: (v: {
          sock: Socket
          leftover: Buffer
          clientRole: DaemonHandshakeClientRole
        }) => void
      } = (() => {
        let _resolve: (v: {
          sock: Socket
          leftover: Buffer
          clientRole: DaemonHandshakeClientRole
        }) => void = () => {}
        const promise = new Promise<{
          sock: Socket
          leftover: Buffer
          clientRole: DaemonHandshakeClientRole
        }>((r) => {
          _resolve = r
        })
        return { promise, resolve: _resolve }
      })()

      server = createServer((sock) => {
        trackServerSocket(sock)
        setupDaemonHandshake(sock, {
          launchVersion: version,
          endpointCredential,
          compatibility,
          authorityIdentity,
          onAccepted: (s, leftover, clientRole) =>
            acceptedDeferred.resolve({ sock: s, leftover, clientRole })
        })
      })
      server.listen(sockPath, () => resolve({ accepted: acceptedDeferred.promise }))
    })
  }

  it('accepts a matching version and delivers no leftover when the bridge sent only the handshake', async () => {
    const { accepted } = await startDaemon('0.1.0+match')

    const bridgeSock = connect(sockPath)
    await new Promise<void>((r) => bridgeSock.once('connect', () => r()))

    const acceptedCb = vi.fn<(leftover: Buffer) => void>()
    runConnectHandshake(bridgeSock, '0.1.0+match', { onAccepted: acceptedCb })

    const { leftover, clientRole } = await accepted
    expect(leftover.length).toBe(0)
    expect(clientRole).toBe('relay')

    await vi.waitFor(() => expect(acceptedCb).toHaveBeenCalledTimes(1))
    expect(acceptedCb.mock.calls[0][0].length).toBe(0)

    bridgeSock.destroy()
  })

  it('admits an authenticated authority probe with an exact endpoint expectation', async () => {
    const { accepted } = await startDaemon(
      '0.1.0+authority',
      'secret-credential',
      undefined,
      AUTHORITY_IDENTITY
    )
    const bridgeSock = connect(sockPath)
    await new Promise<void>((resolve) => bridgeSock.once('connect', resolve))
    const acceptedCb = vi.fn<(leftover: Buffer) => void>()

    runConnectHandshake(
      bridgeSock,
      '0.1.0+authority',
      { onAccepted: acceptedCb },
      'secret-credential',
      AUTHORITY_IDENTITY
    )

    const admission = await accepted
    expect(admission.clientRole).toBe('terminal-authority')
    await vi.waitFor(() => expect(acceptedCb).toHaveBeenCalledOnce())
    bridgeSock.destroy()
  })

  it.each([
    ['0.1.0+older-authority', '0.1.0+newer-bridge'],
    ['0.1.0+newer-authority', '0.1.0+older-bridge']
  ])('admits compatible mixed authority builds: %s / %s', async (daemonVersion, bridgeVersion) => {
    const { accepted } = await startDaemon(
      daemonVersion,
      'secret-credential',
      CURRENT_RELAY_DAEMON_COMPATIBILITY,
      AUTHORITY_IDENTITY
    )
    const bridgeSock = connect(sockPath)
    await new Promise<void>((resolve) => bridgeSock.once('connect', resolve))
    const acceptedCb = vi.fn<(leftover: Buffer) => void>()

    runConnectHandshake(
      bridgeSock,
      bridgeVersion,
      { onAccepted: acceptedCb },
      'secret-credential',
      AUTHORITY_IDENTITY
    )

    await accepted
    await vi.waitFor(() => expect(acceptedCb).toHaveBeenCalledOnce())
    expect(exitSpy).not.toHaveBeenCalled()
    bridgeSock.destroy()
  })

  it('keeps ordinary relay connections exact-build', async () => {
    await startDaemon('0.1.0+older-compatible')
    const bridgeSock = connect(sockPath)
    await new Promise<void>((resolve) => bridgeSock.once('connect', resolve))
    const acceptedCb = vi.fn<(leftover: Buffer) => void>()

    runConnectHandshake(bridgeSock, '0.1.0+newer-compatible', { onAccepted: acceptedCb })

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(EXIT_CODE_VERSION_MISMATCH))
    expect(acceptedCb).not.toHaveBeenCalled()
    bridgeSock.destroy()
  })

  it('does not let an ordinary relay opt into mixed builds with authority capabilities', async () => {
    await startDaemon('0.1.0+server')
    const bridgeSock = connect(sockPath)
    await new Promise<void>((resolve) => bridgeSock.once('connect', resolve))
    const replies: ReturnType<typeof parseHandshakeMessage>[] = []
    const decoder = new FrameDecoder((frame) => {
      if (frame.type === MessageType.Handshake) {
        replies.push(parseHandshakeMessage(frame.payload))
      }
    })
    bridgeSock.on('data', (data) => decoder.feed(Buffer.isBuffer(data) ? data : Buffer.from(data)))

    bridgeSock.write(
      encodeHandshakeFrame({
        type: 'orca-relay-handshake',
        version: '0.1.0+client',
        compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY
      })
    )

    await vi.waitFor(() => expect(replies).toHaveLength(1))
    expect(replies[0]).toMatchObject({ type: 'orca-relay-handshake-mismatch', reason: 'build' })
    bridgeSock.destroy()
  })

  it('rejects a same-build socket that lacks the detached endpoint credential', async () => {
    const { accepted } = await startDaemon('0.1.0+match', 'secret-credential')
    const bridgeSock = connect(sockPath)
    await new Promise<void>((resolve) => bridgeSock.once('connect', resolve))
    const closed = new Promise<void>((resolve) => bridgeSock.once('close', () => resolve()))

    runConnectHandshake(bridgeSock, '0.1.0+match', { onAccepted: vi.fn() }, 'wrong-credential')

    await closed
    await expect(
      Promise.race([
        accepted.then(() => 'accepted'),
        new Promise<string>((resolve) => setTimeout(() => resolve('closed'), 20))
      ])
    ).resolves.toBe('closed')
  })

  it('preserves leftover bytes on the daemon side when an extra frame is coalesced after the handshake', async () => {
    // Why: simulate an aggressive client that pipelines a frame immediately
    // after the handshake. We bypass runConnectHandshake here and write the
    // raw bytes directly so we control the coalescing behaviour.
    const { accepted } = await startDaemon('0.1.0+match')

    const bridgeSock = connect(sockPath)
    await new Promise<void>((r) => bridgeSock.once('connect', () => r()))

    const handshakeFrame = encodeHandshakeFrame({
      type: 'orca-relay-handshake',
      version: '0.1.0+match'
    })
    const trailingPayload = encodeJsonRpcFrame({ jsonrpc: '2.0', method: 'noop', params: {} }, 1, 0)
    bridgeSock.write(Buffer.concat([handshakeFrame, trailingPayload]))

    const { leftover } = await accepted

    const seen: DecodedFrame[] = []
    const dec = new FrameDecoder((f) => seen.push(f))
    dec.feed(leftover)
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe(MessageType.Regular)

    bridgeSock.destroy()
  })

  it('preserves leftover bytes on the bridge side when the daemon coalesces handshake-ok + a JSON-RPC frame', async () => {
    let serverHandshakeSeen = false
    server = createServer((sock) => {
      trackServerSocket(sock)
      const decoder = new FrameDecoder((frame) => {
        if (frame.type !== MessageType.Handshake || serverHandshakeSeen) {
          return
        }
        serverHandshakeSeen = true
        const ok = encodeHandshakeFrame({
          type: 'orca-relay-handshake-ok',
          version: '0.1.0+match'
        })
        const trailing = encodeJsonRpcFrame(
          { jsonrpc: '2.0', method: 'pty.event', params: { evt: 'data' } },
          7,
          1
        )
        sock.write(Buffer.concat([ok, trailing]))
      })
      sock.on('data', (chunk: Buffer) => decoder.feed(chunk))
    })
    await new Promise<void>((r) => server.listen(sockPath, () => r()))

    const bridgeSock = connect(sockPath)
    await new Promise<void>((r) => bridgeSock.once('connect', () => r()))

    const acceptedCb = vi.fn<(leftover: Buffer) => void>()
    runConnectHandshake(bridgeSock, '0.1.0+match', { onAccepted: acceptedCb })

    await vi.waitFor(() => expect(acceptedCb).toHaveBeenCalledTimes(1))
    const leftover = acceptedCb.mock.calls[0][0]

    const seen: DecodedFrame[] = []
    const dec = new FrameDecoder((f) => seen.push(f))
    dec.feed(leftover)
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe(MessageType.Regular)

    bridgeSock.destroy()
  })

  it('exits with EXIT_CODE_VERSION_MISMATCH when the daemon reports a mismatch', async () => {
    await startDaemon('0.1.0+server-version', undefined, {
      major: 2,
      minMinor: 0,
      maxMinor: 0,
      capabilities: ['relay.rpc.v1', 'terminal-session.authority.v1'],
      requiredCapabilities: ['relay.rpc.v1', 'terminal-session.authority.v1']
    })

    const bridgeSock = connect(sockPath)
    await new Promise<void>((r) => bridgeSock.once('connect', () => r()))

    const acceptedCb = vi.fn()
    runConnectHandshake(bridgeSock, '0.1.0+different', { onAccepted: acceptedCb })

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled())
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODE_VERSION_MISMATCH)
    expect(acceptedCb).not.toHaveBeenCalled()

    bridgeSock.destroy()
  })

  it('does not call onAccepted before any handshake-ok frame arrives', async () => {
    // Why: silent server that never replies. acceptedCb must stay
    // un-invoked even though the bridge has flushed its handshake frame.
    server = createServer((sock) => {
      trackServerSocket(sock)
      /* swallow */
    })
    await new Promise<void>((r) => server.listen(sockPath, () => r()))

    const bridgeSock = connect(sockPath)
    await new Promise<void>((r) => bridgeSock.once('connect', () => r()))

    const acceptedCb = vi.fn()
    runConnectHandshake(bridgeSock, '0.1.0+match', { onAccepted: acceptedCb })

    await new Promise((r) => setTimeout(r, 100))
    expect(acceptedCb).not.toHaveBeenCalled()

    bridgeSock.destroy()
  })
})
