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

/**
 * Why an explicit budget: the defaults are a 5s hello *per connection step* plus a 30s
 * request timeout, so one unanswered question can cost 50s. This runs inside a launch that
 * fails open at a minute, and a caller that asks repeatedly needs each ask to be bounded.
 */
export const OCCUPANCY_IPC_BUDGET_MS = 4_000

/** Live session count over the daemon's own socket; null when it could not answer. */
async function countLiveSessionsOverIpc(
  socketPath: string,
  tokenPath: string
): Promise<number | null> {
  const client = new DaemonClient({ socketPath, tokenPath, protocolVersion: PROTOCOL_VERSION })
  try {
    await client.ensureConnectedWithin(OCCUPANCY_IPC_BUDGET_MS)
    const result = await client.request<ListSessionsResult>(
      'listSessions',
      undefined,
      OCCUPANCY_IPC_BUDGET_MS
    )
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
  const unknown: DaemonOccupancy = { state: 'unknown', liveSessions: null }
  // Why catch rather than let it propagate: 'unknown' is this module's residual, and a
  // question that could not be asked is the residual's whole purpose. An escaping throw
  // would route a failed observation into the launch path instead.
  try {
    const counted = await (deps.listSessions ?? countLiveSessionsOverIpc)(socketPath, tokenPath)
    if (counted !== null) {
      return counted > 0
        ? { state: 'occupied', liveSessions: counted }
        : { state: 'empty', liveSessions: 0 }
    }
    if (recordedPid === null) {
      return unknown
    }
    const ownership = await (deps.inspectPtyOwnership ?? inspectDaemonPtyOwnership)(recordedPid)
    return ownership === 'owns-live-ptys' ? { state: 'occupied', liveSessions: null } : unknown
  } catch {
    return unknown
  }
}

/**
 * Raise an unanswered verdict with out-of-band evidence. It can only ever raise: an
 * absent or unreadable process table leaves the verdict exactly as it was, because the
 * table can prove work exists and never that it does not.
 *
 * Separate from the IPC path so a caller waiting for the daemon to recover can re-ask it
 * cheaply, and pay for the process table once, after the waiting is done.
 */
export async function raiseOccupancyWithProcessEvidence(
  occupancy: DaemonOccupancy,
  recordedPid: number | null,
  deps: DaemonOccupancyDeps = {}
): Promise<DaemonOccupancy> {
  if (occupancy.state !== 'unknown' || recordedPid === null) {
    return occupancy
  }
  try {
    const ownership = await (deps.inspectPtyOwnership ?? inspectDaemonPtyOwnership)(recordedPid)
    return ownership === 'owns-live-ptys' ? { state: 'occupied', liveSessions: null } : occupancy
  } catch {
    return occupancy
  }
}
