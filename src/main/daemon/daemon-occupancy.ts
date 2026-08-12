import { DaemonClient } from './client'
import { inspectDaemonPtyOwnership } from './daemon-live-pty-evidence'
import { PROTOCOL_VERSION, type ListSessionsResult } from './types'

/**
 * How much work a daemon is hosting, and how sure we are.
 *
 * The distinction that matters: only the daemon itself can prove it is *empty*.
 * The OS process table can prove work exists, but a table that shows nothing may
 * simply have failed to observe it — so it may only ever add protection, never
 * license a kill. 'unknown' is the residual, and it is not permission.
 */
export type DaemonOccupancy =
  | { state: 'occupied'; liveSessions: number | null }
  | { state: 'empty'; liveSessions: 0 }
  | { state: 'unknown'; liveSessions: null }

export type DaemonOccupancyDeps = {
  listSessions?: (socketPath: string, tokenPath: string) => Promise<number | null>
  inspectPtyOwnership?: typeof inspectDaemonPtyOwnership
}

/** Live session count over the daemon's own socket; null when it could not answer. */
async function countLiveSessionsOverIpc(
  socketPath: string,
  tokenPath: string
): Promise<number | null> {
  const client = new DaemonClient({ socketPath, tokenPath, protocolVersion: PROTOCOL_VERSION })
  try {
    await client.ensureConnected()
    const result = await client.request<ListSessionsResult>('listSessions', undefined)
    return result.sessions.filter((session) => session.isAlive).length
  } catch {
    return null
  } finally {
    client.disconnect()
  }
}

/**
 * Ask the daemon first — a reply is authoritative both ways. Only when it cannot
 * answer do we fall back to the process table, and then only to *raise* the answer
 * to 'occupied'. A blind or empty-looking table stays 'unknown', because a daemon
 * too wedged to list its sessions is exactly as likely to be hosting them.
 *
 * `recordedPid` must already be identity-verified, or the evidence could describe
 * a recycled pid's children rather than this daemon's terminals.
 */
export async function resolveDaemonOccupancy(args: {
  socketPath: string
  tokenPath: string
  recordedPid: number | null
  deps?: DaemonOccupancyDeps
}): Promise<DaemonOccupancy> {
  const { socketPath, tokenPath, recordedPid, deps = {} } = args
  const counted = await (deps.listSessions ?? countLiveSessionsOverIpc)(socketPath, tokenPath)
  if (counted !== null) {
    return counted > 0
      ? { state: 'occupied', liveSessions: counted }
      : { state: 'empty', liveSessions: 0 }
  }
  if (recordedPid === null) {
    return { state: 'unknown', liveSessions: null }
  }
  const ownership = await (deps.inspectPtyOwnership ?? inspectDaemonPtyOwnership)(recordedPid)
  return ownership === 'owns-live-ptys'
    ? { state: 'occupied', liveSessions: null }
    : { state: 'unknown', liveSessions: null }
}
