import type { Socket } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { encodeNdjson } from './ndjson'
import { CLEAN_DISCONNECT_PROTOCOL_VERSION, DaemonProtocolError } from './types'
import type { DaemonEndpointIdentity, HelloMessage, HelloResponse } from './types'
import { addNodePtyRecoveryHint } from './node-pty-error-hints'
import { parseDaemonEndpointIdentity } from './daemon-endpoint-identity'

export type DaemonHelloHandshakeOptions = {
  socket: Socket
  token: string
  role: 'control' | 'stream'
  clientId: string
  protocolVersion: number
  timeoutMs: number
}

export function sendDaemonHello(
  options: DaemonHelloHandshakeOptions
): Promise<DaemonEndpointIdentity | null> {
  const { socket, token, role, clientId, protocolVersion, timeoutMs } = options
  return new Promise((resolve, reject) => {
    const hello: HelloMessage = {
      type: 'hello',
      version: protocolVersion,
      token,
      clientId,
      role
    }

    let buffer = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('close', onClose)
    }
    const finish = (error?: Error, identity: DaemonEndpointIdentity | null = null): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (error) {
        reject(error)
        return
      }
      resolve(identity)
    }
    // Why: daemon socket chunks can split emoji/box-drawing UTF-8 bytes.
    // Decoding each Buffer independently would permanently inject U+FFFD.
    const decoder = new StringDecoder('utf8')
    const onData = (chunk: Buffer): void => {
      buffer += decoder.write(chunk)
      const newlineIdx = buffer.indexOf('\n')
      if (newlineIdx === -1) {
        return
      }

      const line = buffer.slice(0, newlineIdx)
      try {
        const response = JSON.parse(line) as HelloResponse
        if (response.ok) {
          const identity = parseDaemonEndpointIdentity(response.daemonIdentity)
          if (
            (protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION && identity === null) ||
            (response.daemonIdentity !== undefined && identity === null)
          ) {
            finish(new DaemonProtocolError('Invalid daemon identity'))
            return
          }
          finish(undefined, identity)
        } else {
          finish(
            new DaemonProtocolError(addNodePtyRecoveryHint(response.error ?? 'Hello rejected'))
          )
        }
      } catch {
        finish(new DaemonProtocolError('Invalid hello response'))
      }
    }
    const onError = (error: Error): void => finish(error)
    const onClose = (): void =>
      finish(new DaemonProtocolError('Connection closed before hello response'))

    timer = setTimeout(() => {
      // Why: a stale daemon can accept the socket but never answer hello;
      // without a handshake timeout, startup waits forever on ensureConnected().
      finish(new DaemonProtocolError('Hello response timed out'))
      socket.destroy()
    }, timeoutMs)
    socket.on('data', onData)
    socket.on('error', onError)
    socket.on('close', onClose)
    socket.write(encodeNdjson(hello))
  })
}
