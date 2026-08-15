import { createConnection } from 'node:net'
import { findTransport, type RuntimeMetadata } from '../../shared/runtime-bootstrap'

export const RUNTIME_LISTENER_PROBE_TIMEOUT_MS = 250

/**
 * Why: a recorded pid is weak evidence — the OS recycles pids. The runtime binds its
 * endpoints before publishing metadata, so an accepted connect proves a live owner
 * even when it is too busy for RPC; a crash leaves a path with nothing accepting.
 */
export function probeRuntimeListener(
  metadata: RuntimeMetadata,
  timeoutMs: number = RUNTIME_LISTENER_PROBE_TIMEOUT_MS
): Promise<boolean> {
  const transport = findTransport(metadata, 'unix', 'named-pipe')
  if (!transport) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const socket = createConnection(transport.endpoint)
    let settled = false
    const settle = (accepted: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(accepted)
    }
    // Why: an incomplete connect is no evidence, and this sits on the launch path.
    const timer = setTimeout(() => settle(false), timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })
}
