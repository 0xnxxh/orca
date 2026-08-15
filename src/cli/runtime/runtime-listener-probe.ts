import { createConnection } from 'node:net'
import { findTransport, type RuntimeMetadata } from '../../shared/runtime-bootstrap'

export const RUNTIME_LISTENER_PROBE_TIMEOUT_MS = 250

/**
 * Why: a recorded pid is weak evidence of ownership — the OS recycles pids, so a
 * crashed runtime's metadata can name a live unrelated process forever. A socket
 * that completes a connection is direct evidence instead: the runtime published
 * its metadata only after binding these endpoints, so an accepted connect proves
 * a live listener owns this profile right now, even when it is too busy to answer
 * RPC. A crash leaves the socket file behind but nothing to accept on it.
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
    // Why: a connect that never completes is no evidence either way, and this
    // runs on the path to launching Orca — it must not stall the CLI.
    const timer = setTimeout(() => settle(false), timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })
}
