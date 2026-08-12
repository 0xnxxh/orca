import {
  getFreshProcessTableSnapshot,
  type ProcessTableRow
} from '../../shared/process-table-snapshot'
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
  readPosixProcessTable?: () => Promise<ProcessTableRow[]>
  queryWindowsDescendants?: typeof queryWindowsProcessDescendants
}

/**
 * Why generous, and why sampled twice: the load that wedges the daemon is the same
 * load that makes `ps` miss a tight budget, so the evidence would go blind exactly
 * when it matters most. A positive is confirmed by a second sample so a short-lived
 * child — a resolver probe, a health-check shell — cannot masquerade as an agent.
 * This runs only on the replace path, after ~60s of grace is already spent.
 */
const PTY_OWNERSHIP_PROBE_ATTEMPTS = 2

// A wedged daemon cannot reap, so its exited PTYs linger as zombies. Counting them
// would read "every agent already exited" as "agents still running" — and that
// false positive is systematically correlated with the wedge we are diagnosing.
function isZombie(row: ProcessTableRow): boolean {
  return row.stat.startsWith('Z')
}

function collectLiveDescendants(rows: ProcessTableRow[], rootPid: number): ProcessTableRow[] {
  const childrenByPpid = new Map<number, ProcessTableRow[]>()
  for (const row of rows) {
    if (row.pid === rootPid) {
      continue
    }
    const siblings = childrenByPpid.get(row.ppid)
    if (siblings) {
      siblings.push(row)
    } else {
      childrenByPpid.set(row.ppid, [row])
    }
  }
  const visited = new Set<number>([rootPid])
  const queue: number[] = [rootPid]
  const live: ProcessTableRow[] = []
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of childrenByPpid.get(pid) ?? []) {
      if (visited.has(child.pid)) {
        continue
      }
      visited.add(child.pid)
      queue.push(child.pid)
      if (!isZombie(child)) {
        live.push(child)
      }
    }
  }
  return live
}

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
  const rows = await (deps.readPosixProcessTable ?? getFreshProcessTableSnapshot)()
  // Why: a walk that never saw the root reports zero descendants for a process it
  // never examined. Only a root we actually observed can prove emptiness.
  if (!rows.some((row) => row.pid === daemonPid)) {
    return 'unknown'
  }
  return collectLiveDescendants(rows, daemonPid).length > 0 ? 'owns-live-ptys' : 'no-live-ptys'
}

/**
 * PTY children are the daemon's only long-lived descendants, so a descendant that
 * survives two samples is positive proof that killing it would destroy running work.
 * Descendants rather than direct children: macOS wraps every shell in login(1) for
 * TCC attribution, so the agent is a grandchild at best.
 */
export async function inspectDaemonPtyOwnership(
  daemonPid: number,
  deps: DaemonPtyOwnershipDeps = {}
): Promise<DaemonPtyOwnership> {
  const platform = deps.platform ?? process.platform
  let sawLivePtys = false
  for (let attempt = 0; attempt < PTY_OWNERSHIP_PROBE_ATTEMPTS; attempt++) {
    let sample: DaemonPtyOwnership
    try {
      sample = await probeOnce(daemonPid, deps, platform)
    } catch {
      sample = 'unknown'
    }
    // An observed root with no live descendants is conclusive, and it settles the transient
    // case too: a resolver probe or health-check shell seen in one sample is gone by the next.
    if (sample === 'no-live-ptys') {
      return sample
    }
    sawLivePtys ||= sample === 'owns-live-ptys'
  }
  // Why a single sighting is enough to preserve: a blind second read is not evidence against
  // the first. Killing live agents is unrecoverable; preserving costs one degraded launch.
  return sawLivePtys ? 'owns-live-ptys' : 'unknown'
}
