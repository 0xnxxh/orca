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
 * 'unknown' is not "empty" — it means the process table could not be read, or did not
 * contain the daemon at all. It is not evidence of absence, and it is deliberately not
 * evidence of presence either: the only caller preserves on 'owns-live-ptys' alone and
 * treats 'unknown' as the pre-existing behavior, so that a permanently wedged daemon with
 * nothing to lose stays replaceable (#8689). Widening that is a separate decision.
 */
export type DaemonPtyOwnership = 'owns-live-ptys' | 'no-live-ptys' | 'unknown'

export type DaemonPtyOwnershipDeps = {
  platform?: NodeJS.Platform
  readPosixProcessTable?: () => Promise<ProcessTableRow[]>
  queryWindowsDescendants?: typeof queryWindowsProcessDescendants
  windowsDeadlineMs?: number
}

/**
 * Why sampled twice: the load that wedges the daemon is the same load that can blind
 * the process-table read, so a single blind sample would lose the evidence exactly when
 * it matters most. Only blindness is retried — a conclusive answer is taken as given.
 * This runs only on the replace path, after ~60s of grace is already spent.
 */
const PTY_OWNERSHIP_PROBE_ATTEMPTS = 2

/**
 * Windows enumeration has no budget of its own: each scan is a powershell CIM query that
 * may fall back to wmic, and the shared reader can queue behind an in-flight scan — worst
 * case tens of seconds on the launch path. Blind is a safe answer here; hanging is not.
 */
const WINDOWS_OWNERSHIP_PROBE_DEADLINE_MS = 6_000

function withDeadline<T>(work: Promise<T>, deadlineMs: number, onDeadline: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(onDeadline), deadlineMs)
    timer.unref?.()
    void work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(onDeadline)
      }
    )
  })
}

/**
 * A PTY child is a session leader — forkpty() calls setsid() — which no ordinary
 * helper the daemon forks ever is. That single `ps` flag separates a hosted terminal
 * from the daemon's own subprocesses (a `scutil` resolver probe, a PTY-spawn health
 * check, a stuck credential helper), any of which can outlive a re-sample and would
 * otherwise be mistaken for an agent.
 *
 * Zombies are excluded for the correlated reason: a wedged daemon cannot reap, so its
 * already-exited PTYs linger as <defunct> and would read as still running.
 */
function isLivePtySessionLeader(row: ProcessTableRow): boolean {
  // Lowercase 's' is only ever the session-leader flag; no process state code uses it.
  return !row.stat.startsWith('Z') && row.stat.includes('s')
}

function collectLivePtyDescendants(rows: ProcessTableRow[], rootPid: number): ProcessTableRow[] {
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
      if (isLivePtySessionLeader(child)) {
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
    const descendants = await withDeadline(
      (deps.queryWindowsDescendants ?? queryWindowsProcessDescendants)(daemonPid, { fresh: true }),
      deps.windowsDeadlineMs ?? WINDOWS_OWNERSHIP_PROBE_DEADLINE_MS,
      null
    )
    // null covers enumeration failure, a root absent from the table, and our own deadline.
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
  return collectLivePtyDescendants(rows, daemonPid).length > 0 ? 'owns-live-ptys' : 'no-live-ptys'
}

/**
 * A session-leader descendant is positive proof that killing this daemon would destroy
 * running work. Descendants rather than direct children: macOS wraps every shell in
 * login(1) for TCC attribution, so the agent is a grandchild at best.
 *
 * Windows has no session-leader equivalent here, so its branch counts any descendant —
 * it can over-preserve where POSIX would not.
 */
export async function inspectDaemonPtyOwnership(
  daemonPid: number,
  deps: DaemonPtyOwnershipDeps = {}
): Promise<DaemonPtyOwnership> {
  const platform = deps.platform ?? process.platform
  for (let attempt = 0; attempt < PTY_OWNERSHIP_PROBE_ATTEMPTS; attempt++) {
    let sample: DaemonPtyOwnership
    try {
      sample = await probeOnce(daemonPid, deps, platform)
    } catch {
      sample = 'unknown'
    }
    if (sample !== 'unknown') {
      return sample
    }
  }
  return 'unknown'
}
