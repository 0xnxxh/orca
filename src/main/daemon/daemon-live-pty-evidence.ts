import { captureDescendantSnapshot } from '../pty-descendant-termination'
import { queryWindowsProcessDescendants } from '../providers/windows-foreground-process-rows'

/**
 * Out-of-band answer to "is this daemon still hosting running terminals?".
 *
 * Deliberately never touches the daemon socket: the only caller asks precisely
 * because the daemon has already failed to answer over it, and a wedged daemon
 * cannot be asked to vouch for its own sessions. Replacing a daemon kills every
 * process it hosts, so that decision needs evidence that survives the wedge.
 *
 * 'unknown' is not "empty" — it means the process table could not be read, or
 * did not contain the daemon at all. Callers must not treat it as permission.
 */
export type DaemonPtyOwnership = 'owns-live-ptys' | 'no-live-ptys' | 'unknown'

export type DaemonPtyOwnershipDeps = {
  platform?: NodeJS.Platform
  capturePosixDescendants?: typeof captureDescendantSnapshot
  queryWindowsDescendants?: typeof queryWindowsProcessDescendants
}

/**
 * Why generous, and why retried: the load that wedges the daemon is the same load
 * that makes `ps` miss its default 1s budget, so the evidence would go blind exactly
 * when it matters most. This runs only on the replace path, after ~60s of grace has
 * already been spent — seconds here are free next to killing a live agent.
 */
const PTY_OWNERSHIP_PROBE_TIMEOUT_MS = 5_000
const PTY_OWNERSHIP_PROBE_ATTEMPTS = 2

async function probeOnce(
  daemonPid: number,
  deps: DaemonPtyOwnershipDeps,
  platform: NodeJS.Platform
): Promise<DaemonPtyOwnership> {
  if (platform === 'win32') {
    const descendants = await (deps.queryWindowsDescendants ?? queryWindowsProcessDescendants)(
      daemonPid,
      { fresh: true }
    )
    // null covers both enumeration failure and a root absent from the table.
    if (descendants === null) {
      return 'unknown'
    }
    return descendants.length > 0 ? 'owns-live-ptys' : 'no-live-ptys'
  }
  const snapshot = await (deps.capturePosixDescendants ?? captureDescendantSnapshot)(daemonPid, {
    platform,
    timeoutMs: PTY_OWNERSHIP_PROBE_TIMEOUT_MS
  })
  // Why: a walk that never saw the root reports zero descendants for a process
  // it never examined. Only a root we actually observed can prove emptiness.
  if (!snapshot || snapshot.rootPgid === null) {
    return 'unknown'
  }
  return snapshot.descendants.length > 0 ? 'owns-live-ptys' : 'no-live-ptys'
}

/**
 * PTY children are the daemon's only long-lived descendants, so a non-empty
 * descendant set is positive proof that killing it would destroy running work.
 * Descendants rather than direct children: macOS wraps every shell in login(1)
 * for TCC attribution, so the agent is a grandchild at best.
 */
export async function inspectDaemonPtyOwnership(
  daemonPid: number,
  deps: DaemonPtyOwnershipDeps = {}
): Promise<DaemonPtyOwnership> {
  const platform = deps.platform ?? process.platform
  let ownership: DaemonPtyOwnership = 'unknown'
  for (let attempt = 0; attempt < PTY_OWNERSHIP_PROBE_ATTEMPTS; attempt++) {
    try {
      ownership = await probeOnce(daemonPid, deps, platform)
    } catch {
      ownership = 'unknown'
    }
    if (ownership !== 'unknown') {
      return ownership
    }
  }
  return ownership
}
