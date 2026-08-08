import { constants, open } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import type { SshChannelMultiplexer } from '../main/ssh/ssh-channel-multiplexer'
import { createTerminalAuthoritySocketMultiplexer } from './terminal-authority-gateway-connection'
import type { LegacyPhysicalWorkerRpc } from './legacy-physical-worker-client'
import { encodeHandshakeFrame, FrameDecoder, MessageType, parseHandshakeMessage } from './protocol'

const MAX_CREDENTIAL_BYTES = 512
const CONNECT_TIMEOUT_MS = 5_000

export async function connectLegacyPhysicalWorkerSocket(input: {
  socketPath: string
  credentialFile: string
  expectedBuildId: string
}): Promise<LegacyPhysicalWorkerRpc> {
  const credential = await readPrivateCredential(input.credentialFile)
  const socket = await connectSocket(input.socketPath)
  try {
    const leftover = await negotiateLegacyRelay(socket, input.expectedBuildId, credential)
    return legacyWorkerRpc(createTerminalAuthoritySocketMultiplexer(socket, leftover))
  } catch (error) {
    socket.destroy()
    throw error
  }
}

function legacyWorkerRpc(mux: SshChannelMultiplexer): LegacyPhysicalWorkerRpc {
  let open = true
  const closeListeners = new Set<() => void>()
  mux.onDispose(() => {
    if (!open) {
      return
    }
    open = false
    for (const listener of closeListeners) {
      listener()
    }
    closeListeners.clear()
  })
  return Object.freeze({
    request: (method, params) => mux.request(method, params),
    notify: (method, params) => {
      if (!mux.notify(method, params)) {
        throw new Error(`legacy physical worker rejected ${method}`)
      }
    },
    notifyWithSettlement: (method, params, onSettled) =>
      mux.notifyWithSettlement(method, params, onSettled),
    onNotification: (listener) => mux.onNotification(listener),
    isOpen: () => open,
    onClose: (listener) => {
      if (!open) {
        queueMicrotask(listener)
        return () => {}
      }
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    close: () => mux.dispose('shutdown')
  })
}

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('legacy physical worker connection timed out'))
    }, CONNECT_TIMEOUT_MS)
    timer.unref?.()
    const onError = (error: Error): void => {
      clearTimeout(timer)
      reject(error)
    }
    socket.once('error', onError)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
      resolve(socket)
    })
  })
}

function negotiateLegacyRelay(
  socket: Socket,
  expectedBuildId: string,
  credential: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(
      () => finish(new Error('legacy physical worker handshake timed out')),
      CONNECT_TIMEOUT_MS
    )
    timer.unref?.()
    const decoder = new FrameDecoder(
      (frame) => {
        if (frame.type !== MessageType.Handshake) {
          finish(new Error('legacy physical worker returned a non-handshake frame'))
          return
        }
        let message: ReturnType<typeof parseHandshakeMessage>
        try {
          message = parseHandshakeMessage(frame.payload)
        } catch {
          finish(new Error('legacy physical worker handshake is invalid'))
          return
        }
        if (message.type !== 'orca-relay-handshake-ok' || message.version !== expectedBuildId) {
          finish(new Error('legacy physical worker build changed before connection'))
          return
        }
        const leftover = decoder.drain()
        cleanup()
        settled = true
        resolve(leftover)
      },
      (error) => finish(error)
    )
    const onData = (data: Buffer): void => decoder.feed(data)
    const onClose = (): void => finish(new Error('legacy physical worker closed during handshake'))
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
        version: expectedBuildId,
        endpointCredential: credential
      })
    )
  })
}

async function readPrivateCredential(path: string): Promise<string> {
  const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0)
  const handle = await open(path, constants.O_RDONLY | noFollow)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_CREDENTIAL_BYTES) {
      throw new Error('legacy physical worker credential is not bounded')
    }
    if (process.platform !== 'win32') {
      const effectiveUid = process.geteuid?.() ?? process.getuid?.()
      if ((effectiveUid !== undefined && stat.uid !== effectiveUid) || (stat.mode & 0o077) !== 0) {
        throw new Error('legacy physical worker credential is not private')
      }
    }
    const credential = (await handle.readFile('utf8')).trim()
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(credential)) {
      throw new Error('legacy physical worker credential is invalid')
    }
    return credential
  } finally {
    await handle.close()
  }
}
