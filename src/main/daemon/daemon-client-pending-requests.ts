import type { Socket } from 'node:net'
import { encodeNdjson } from './ndjson'
import { DaemonProtocolError } from './types'
import type { RpcResponse } from './types'
import { addNodePtyRecoveryHint } from './node-pty-error-hints'
import { decodeDaemonResponseError } from './daemon-errors'

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export async function sendDaemonRequest<T = unknown>(
  socket: Socket,
  pendingRequests: Map<string, PendingRequest>,
  id: string,
  type: string,
  payload: unknown,
  timeoutMs: number
): Promise<T> {
  const msg = { id, type, ...(payload !== undefined ? { payload } : {}) }
  const encoded = encodeNdjson(msg)

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new DaemonProtocolError(`Request ${type} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer
    })

    socket.write(encoded)
  })
}

export function writeDaemonNotify(
  socket: Socket,
  id: string,
  type: string,
  payload: unknown
): boolean {
  const msg = { id, type, ...(payload !== undefined ? { payload } : {}) }
  try {
    socket.write(encodeNdjson(msg))
    return true
  } catch {
    // Notifications are best-effort; an oversized payload must not tear down the caller.
    return false
  }
}

export function settlePendingResponse(
  pendingRequests: Map<string, PendingRequest>,
  response: RpcResponse
): void {
  if (response.id) {
    const pending = pendingRequests.get(response.id)
    if (pending) {
      pendingRequests.delete(response.id)
      clearTimeout(pending.timer)
      if (response.ok) {
        pending.resolve(response.payload)
      } else {
        const decoded = decodeDaemonResponseError(response.error)
        pending.reject(
          decoded instanceof DaemonProtocolError
            ? new DaemonProtocolError(addNodePtyRecoveryHint(response.error))
            : decoded
        )
      }
    }
  }
}

export function rejectAllPendingRequests(
  pendingRequests: Map<string, PendingRequest>,
  message: string
): void {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new DaemonProtocolError(message))
    pendingRequests.delete(id)
  }
}
