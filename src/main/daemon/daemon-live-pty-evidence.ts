import {
  getFreshProcessTableSnapshot,
  getProcessTableSnapshot,
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
  readCachedPosixProcessTable?: () => Promise<ProcessTableRow[]>
  queryWindowsDescendants?: typeof queryWindowsProcessDescendants
  windowsDeadlineMs?: number
  posixDeadlineMs?: number
}

/**
 * Why sampled twice: the load that wedges the daemon is the same load that can blind
 * the process-table read, so a single blind sample would lose the evidence exactly when
 * it matters most. Only blindness is retried — a conclusive answer is taken as given.
 * This runs only on the replace path, after ~60s of grace is already spent.
 */
export const PTY_OWNERSHIP_PROBE_ATTEMPTS = 2

/**
 * Windows enumeration has no budget of its own: each scan is a powershell CIM query that
 * may fall back to wmic, and the shared reader can queue behind an in-flight scan — worst
 * case tens of seconds on the launch path. Blind is a safe answer here; hanging is not.
 */
export const WINDOWS_OWNERSHIP_PROBE_DEADLINE_MS = 4_000

/**
 * POSIX needs its own ceiling for the same reason: the shared reader's `ps` timeout does not
 * cover queueing behind an in-flight scan, and this runs on a launch that fails open.
 */
export const POSIX_OWNERSHIP_PROBE_DEADLINE_MS = 4_000

/** macos-tcc-login-shell.ts wraps every darwin terminal in this. */
const MACOS_LOGIN_WRAPPER_PREFIX = '/usr/bin/login '

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
 * The daemon opens PTYs for its own probes, and forkpty makes those session leaders too, so
 * process state alone cannot tell them from a hosted terminal. Each is a fixed, argument-less
 * command the daemon issues itself, so matching them exactly costs no real terminal.
 */
const DAEMON_SELF_SPAWNED_PTY_COMMANDS = [
  // pty-subprocess.ts checkPtySpawnHealth
  { program: 'sh', args: '-c exit 0' },
  // windows-conpty-warmup.ts, which spawns COMSPEC — an absolute path on a stock install
  { program: 'cmd', args: '/c exit' }
]

/** Trailing path segment, with any Windows executable suffix removed. */
function programBasename(command: string): string {
  const base = command.split(/[\\/]/).pop() ?? command
  return base.endsWith('.exe') ? base.slice(0, -'.exe'.length) : base
}

function isDaemonSelfSpawnedPty(row: Pick<ProcessTableRow, 'command'>): boolean {
  const command = row.command.trim().toLowerCase()
  return DAEMON_SELF_SPAWNED_PTY_COMMANDS.some(({ program, args }) => {
    const suffix = ` ${args}`
    // Why the argv tail must match exactly: `sh -c` payloads are user-supplied, and treating
    // one as the daemon's own probe would discard proof that real work is running.
    if (!command.endsWith(suffix)) {
      return false
    }
    // Only the program may vary, and only by path — COMSPEC is absolute, node-pty execs
    // '/bin/sh' verbatim — so it is compared by basename rather than by the whole string.
    return programBasename(command.slice(0, command.length - suffix.length)) === program
  })
}

/**
 * A PTY child is a session leader — forkpty() calls setsid() — which the daemon's plain
 * subprocesses (a `scutil` resolver probe, a stuck credential helper) never are.
 *
 * Zombies are excluded for a correlated reason: a wedged daemon cannot reap, so its
 * already-exited PTYs linger as <defunct> and would read as still running.
 */
function isLivePtySessionLeader(row: ProcessTableRow): boolean {
  // Lowercase 's' is only ever the session-leader flag; no process state code uses it.
  return !row.stat.startsWith('Z') && row.stat.includes('s') && !isDaemonSelfSpawnedPty(row)
}

/**
 * macOS wraps every terminal in `/usr/bin/login` for TCC attribution, and the wrapper can
 * outlive the shell it wrapped (#13764) — a session leader hosting nothing. Counting those
 * would hold a daemon whose sessions have all ended, on hosts where they accumulate by the
 * hundred. A wrapper still doing its job always has the shell it exec'd beneath it.
 */
function isStrandedLoginWrapper(row: ProcessTableRow, hasChildren: boolean): boolean {
  return !hasChildren && row.command.trim().startsWith(MACOS_LOGIN_WRAPPER_PREFIX)
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
      if (
        isLivePtySessionLeader(child) &&
        !isStrandedLoginWrapper(child, childrenByPpid.has(child.pid))
      ) {
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
    const hosted = descendants.filter((row) => !isDaemonSelfSpawnedPty(row))
    return hosted.length > 0 ? 'owns-live-ptys' : 'no-live-ptys'
  }
  const deadlineMs = deps.posixDeadlineMs ?? POSIX_OWNERSHIP_PROBE_DEADLINE_MS
  const rows =
    (await withDeadline(
      (deps.readPosixProcessTable ?? getFreshProcessTableSnapshot)(),
      deadlineMs,
      null
    )) ??
    // Why fall back instead of answering 'unknown': the uncached reader queues behind the
    // scans every agent pane already drives, so the busiest host — the one this evidence
    // exists to protect — is the likeliest to blow the deadline on queueing alone. A table a
    // few hundred milliseconds old still shows whether this daemon has children, and going
    // blind here gets them killed.
    (await withDeadline(
      (deps.readCachedPosixProcessTable ?? getProcessTableSnapshot)(),
      deadlineMs,
      null
    ))
  // Why: a walk that never saw the root reports zero descendants for a process it
  // never examined. Only a root we actually observed can prove emptiness — and a read
  // that blew its deadline saw nothing at all.
  if (rows === null || !rows.some((row) => row.pid === daemonPid)) {
    return 'unknown'
  }
  return collectLivePtyDescendants(rows, daemonPid).length > 0 ? 'owns-live-ptys' : 'no-live-ptys'
}

/**
 * A session-leader descendant is positive proof that killing this daemon would destroy
 * running work. Descendants rather than direct children: macOS wraps every shell in
 * login(1) for TCC attribution, so the agent is a grandchild at best.
 *
 * Windows has no session-leader equivalent here, so its branch counts any descendant that
 * is not a known self-spawned probe — it can over-preserve where POSIX would not.
 */
export async function inspectDaemonPtyOwnership(
  daemonPid: number,
  deps: DaemonPtyOwnershipDeps = {}
): Promise<DaemonPtyOwnership> {
  const platform = deps.platform ?? process.platform
  let sawEmpty = false
  for (let attempt = 0; attempt < PTY_OWNERSHIP_PROBE_ATTEMPTS; attempt++) {
    let sample: DaemonPtyOwnership
    try {
      sample = await probeOnce(daemonPid, deps, platform)
    } catch {
      sample = 'unknown'
    }
    // Why a second look before accepting emptiness on POSIX: a terminal contributes exactly
    // one session leader — on macOS the login wrapper — and it is invisible for the moment
    // between forkpty creating it and the shell appearing beneath it. One snapshot cannot tell
    // that from a wrapper whose shell has gone. Emptiness authorizes a kill, so it is the
    // answer worth paying a second read for; 'owns-live-ptys' needs no confirmation.
    if (sample === 'no-live-ptys' && platform !== 'win32' && !sawEmpty) {
      sawEmpty = true
      continue
    }
    if (sample !== 'unknown') {
      return sample
    }
  }
  // Only reached when every sample was blind, or when the confirming read disagreed with an
  // emptiness it could not corroborate.
  return sawEmpty ? 'no-live-ptys' : 'unknown'
}
