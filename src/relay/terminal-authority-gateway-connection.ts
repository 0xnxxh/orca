import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { SshChannelMultiplexer } from '../main/ssh/ssh-channel-multiplexer'
import type { MultiplexerTransport } from '../main/ssh/ssh-multiplexer-transport-writer'
import {
  CURRENT_RELAY_DAEMON_COMPATIBILITY,
  relayDaemonGrantSatisfiesOffer,
  type RelayDaemonCompatibilityGrant
} from '../shared/relay-daemon-compatibility'
import {
  parseSshTerminalAuthorityMarker,
  parseTerminalAuthorityEndpointIdentity,
  sameTerminalAuthorityEndpointIdentity,
  terminalAuthorityEndpointIdentity,
  type SshTerminalAuthorityMarker
} from '../shared/ssh-terminal-authority-marker'
import { encodeHandshakeFrame, FrameDecoder, MessageType, parseHandshakeMessage } from './protocol'

const MAX_MARKER_BYTES = 16 * 1024
const MAX_CREDENTIAL_BYTES = 512
const CONNECT_TIMEOUT_MS = 5_000

export type TerminalAuthorityGatewayExpectation = Readonly<{
  markerPath: string
  authorityHostId: string
  ownerInstanceId: string
  revision: number
}>

export type TerminalAuthorityGatewayConnection = Readonly<{
  marker: SshTerminalAuthorityMarker
  mux: SshChannelMultiplexer
  compatibility: RelayDaemonCompatibilityGrant
}>

export async function connectTerminalAuthorityGateway(
  expectation: TerminalAuthorityGatewayExpectation,
  gatewayBuildId: string
): Promise<TerminalAuthorityGatewayConnection> {
  const marker = readExpectedMarker(expectation)
  const credential = readCredential(marker.credentialFile)
  const socket = await connectSocket(marker.socketPath)
  try {
    const negotiated = await negotiateAuthoritySocket(socket, marker, gatewayBuildId, credential)
    const connected = createTerminalAuthoritySocketMultiplexer(socket, negotiated.leftover)
    return Object.freeze({ marker, mux: connected, compatibility: negotiated.compatibility })
  } catch (error) {
    socket.destroy()
    throw error
  }
}

function endpointIdentityMatchesMarker(
  value: unknown,
  marker: SshTerminalAuthorityMarker
): boolean {
  const identity = parseTerminalAuthorityEndpointIdentity(value)
  return Boolean(
    identity &&
    sameTerminalAuthorityEndpointIdentity(terminalAuthorityEndpointIdentity(marker), identity)
  )
}

function readExpectedMarker(
  expectation: TerminalAuthorityGatewayExpectation
): SshTerminalAuthorityMarker {
  let raw: string
  try {
    raw = readPrivateBoundedFile(expectation.markerPath, MAX_MARKER_BYTES)
  } catch (error) {
    throw new Error(
      `Terminal authority gateway marker is unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Terminal authority gateway marker is invalid')
  }
  const marker = parseSshTerminalAuthorityMarker(parsed)
  if (
    !marker ||
    marker.authorityHostId !== expectation.authorityHostId ||
    marker.ownerInstanceId !== expectation.ownerInstanceId ||
    marker.revision !== expectation.revision
  ) {
    throw new Error('Terminal authority owner changed before gateway connection')
  }
  return marker
}

function readCredential(path: string): string {
  const credential = readPrivateBoundedFile(path, MAX_CREDENTIAL_BYTES).trim()
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(credential)) {
    throw new Error('Terminal authority gateway credential is invalid')
  }
  return credential
}

function readPrivateBoundedFile(path: string, maxBytes: number): string {
  const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0)
  const fd = openSync(path, constants.O_RDONLY | noFollow)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) {
      throw new Error('file is not a bounded regular file')
    }
    if (process.platform !== 'win32') {
      const effectiveUid = process.geteuid?.() ?? process.getuid?.()
      if ((effectiveUid !== undefined && stat.uid !== effectiveUid) || (stat.mode & 0o077) !== 0) {
        throw new Error('file permissions are not private')
      }
    }
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let offset = 0
    while (offset <= maxBytes) {
      const bytesRead = readSync(fd, buffer, offset, buffer.length - offset, null)
      if (bytesRead === 0) {
        return buffer.subarray(0, offset).toString('utf8')
      }
      offset += bytesRead
    }
    throw new Error('file exceeded its bounded capacity while reading')
  } finally {
    closeSync(fd)
  }
}

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Terminal authority gateway connection timed out'))
    }, CONNECT_TIMEOUT_MS)
    timer.unref?.()
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
      resolve(socket)
    })
    const onError = (error: Error): void => {
      clearTimeout(timer)
      reject(error)
    }
    socket.once('error', onError)
  })
}

function negotiateAuthoritySocket(
  socket: Socket,
  marker: SshTerminalAuthorityMarker,
  gatewayBuildId: string,
  credential: string
): Promise<Readonly<{ leftover: Buffer; compatibility: RelayDaemonCompatibilityGrant }>> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(
      () => finish(new Error('Terminal authority gateway handshake timed out')),
      CONNECT_TIMEOUT_MS
    )
    timer.unref?.()
    const decoder = new FrameDecoder(
      (frame) => {
        if (frame.type !== MessageType.Handshake) {
          finish(new Error('Terminal authority gateway received a non-handshake frame'))
          return
        }
        let message: ReturnType<typeof parseHandshakeMessage>
        try {
          message = parseHandshakeMessage(frame.payload)
        } catch {
          finish(new Error('Terminal authority gateway handshake response is invalid'))
          return
        }
        if (
          message.type !== 'orca-relay-handshake-ok' ||
          message.version !== marker.ownerBuildId ||
          !relayDaemonGrantSatisfiesOffer(
            message.compatibility,
            CURRENT_RELAY_DAEMON_COMPATIBILITY
          ) ||
          !endpointIdentityMatchesMarker(message.authorityIdentity, marker)
        ) {
          finish(new Error('Terminal authority gateway handshake was not admitted'))
          return
        }
        const leftover = decoder.drain()
        const compatibility = {
          major: message.compatibility.major,
          minor: message.compatibility.minor,
          capabilities: [...message.compatibility.capabilities]
        }
        cleanup()
        settled = true
        resolve(Object.freeze({ leftover, compatibility }))
      },
      (error) => finish(error)
    )
    const onData = (data: Buffer): void => decoder.feed(data)
    const onClose = (): void =>
      finish(new Error('Terminal authority gateway closed during handshake'))
    const onError = (error: Error): void => finish(error)
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('close', onClose)
      socket.removeListener('error', onError)
    }
    const finish = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    socket.on('data', onData)
    socket.once('close', onClose)
    socket.once('error', onError)
    socket.write(
      encodeHandshakeFrame({
        type: 'orca-relay-handshake',
        version: gatewayBuildId,
        endpointCredential: credential,
        compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY,
        authorityExpectation: terminalAuthorityEndpointIdentity(marker)
      })
    )
  })
}

export function createTerminalAuthoritySocketMultiplexer(
  socket: Socket,
  leftover: Buffer
): SshChannelMultiplexer {
  const dataListeners = new Set<(data: Buffer) => void>()
  const closeListeners = new Set<() => void>()
  let closed = false
  const notifyClosed = (): void => {
    if (closed) {
      return
    }
    closed = true
    for (const listener of closeListeners) {
      listener()
    }
    closeListeners.clear()
    dataListeners.clear()
  }
  const transport: MultiplexerTransport = {
    supportsWriteSettlement: true,
    write: (data, onSettled) => {
      try {
        return socket.write(data, (error) => {
          onSettled?.(error ? { ok: false, error } : { ok: true })
        })
      } catch (error) {
        onSettled?.({
          ok: false,
          error: error instanceof Error ? error : new Error(String(error))
        })
        return false
      }
    },
    onData: (listener) => {
      dataListeners.add(listener)
    },
    onClose: (listener) => {
      closeListeners.add(listener)
    },
    onDrain: (listener) => {
      socket.on('drain', listener)
      return () => socket.off('drain', listener)
    },
    pauseReads: () => socket.pause(),
    resumeReads: () => socket.resume(),
    close: () => socket.destroy()
  }
  socket.on('data', (data: Buffer) => {
    for (const listener of dataListeners) {
      listener(data)
    }
  })
  const onSocketError = (): void => {
    notifyClosed()
    socket.destroy()
  }
  socket.on('error', onSocketError)
  socket.once('close', () => {
    socket.off('error', onSocketError)
    notifyClosed()
  })
  const mux = new SshChannelMultiplexer(transport)
  if (leftover.length > 0) {
    for (const listener of dataListeners) {
      listener(leftover)
    }
  }
  return mux
}
