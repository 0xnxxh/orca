import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'

// Why: Codex OAuth uses rotating refresh tokens stored in each home's auth.json.
// Two Orca-spawned codex processes refreshing the same home concurrently can
// consume one rotation twice and permanently invalidate the stored credential,
// so Orca's own spawns (quota probes, commit-message runs) serialize per home.
// User terminal panes are intentionally not serialized here.

type LockTail = {
  settled: Promise<void>
  /** Bounds the running hold; only needed once someone is queued behind it. */
  armReleaseCap: () => void
}

const lockTails = new Map<string, LockTail>()

export function resolveCodexHomeProcessLockKey(codexHomePath?: string | null): string {
  const home = codexHomePath ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
  return normalizeRuntimePathForComparison(home)
}

export function resolveCodexHomeProcessLockKeyForSpawnEnv(
  env: NodeJS.ProcessEnv | undefined,
  wslDistro?: string | null
): string {
  if (wslDistro) {
    // buildWslLauncherEnv forwards only explicit values that differ from the
    // host process; all other cases use the distro user's default home.
    const codexHome = env?.CODEX_HOME !== process.env.CODEX_HOME ? (env?.CODEX_HOME ?? null) : null
    // Why: WSL spawns carry a Linux CODEX_HOME; key it through the same UNC
    // normalization the probe's \\wsl$ home path uses so both lanes collide.
    // Without an explicit home the distro default is unknowable from the host;
    // a sentinel still serializes same-distro default spawns with each other.
    return normalizeRuntimePathForComparison(
      `//wsl$/${wslDistro}${codexHome ?? '/.orca-default-codex-home'}`
    )
  }
  // An explicit env is the child's complete environment. If CODEX_HOME was
  // deliberately stripped, the child uses ~/.codex regardless of our ambient env.
  const codexHome = env === undefined ? process.env.CODEX_HOME : env.CODEX_HOME
  return normalizeRuntimePathForComparison(codexHome ?? join(homedir(), '.codex'))
}

// Why: a hold that never settles (a killed codex child whose descendant keeps
// the inherited stdio open never reports close) would kill this home for the
// rest of the session. Far above the 60s generation timeout so healthy runs and
// their process teardown never trip it.
export const CODEX_HOME_PROCESS_LOCK_MAX_HOLD_MS = 5 * 60_000

export function withCodexHomeProcessLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prior = lockTails.get(lockKey)
  prior?.armReleaseCap()
  const started = prior?.settled ?? Promise.resolve()
  const run = started.then(fn)
  const tail = createLockTail(started, run, lockKey)
  lockTails.set(lockKey, tail)
  void tail.settled.then(() => {
    if (lockTails.get(lockKey) === tail) {
      lockTails.delete(lockKey)
    }
  })
  return run
}

function createLockTail(
  started: Promise<unknown>,
  run: Promise<unknown>,
  lockKey: string
): LockTail {
  let capTimer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let queuedBehind = false
  let release!: () => void
  const settled = new Promise<void>((resolve) => {
    release = () => {
      running = false
      if (capTimer) {
        clearTimeout(capTimer)
        capTimer = null
      }
      resolve()
    }
  })
  // The cap only counts time this entry actually holds the lock, so waiting
  // behind a slow predecessor never shortens a run's own budget.
  const armIfHolding = (): void => {
    if (!running || !queuedBehind || capTimer) {
      return
    }
    capTimer = setTimeout(() => {
      console.warn(
        `[codex-home-lock] releasing ${lockKey} after ${CODEX_HOME_PROCESS_LOCK_MAX_HOLD_MS}ms without completion`
      )
      release()
    }, CODEX_HOME_PROCESS_LOCK_MAX_HOLD_MS)
    if (typeof capTimer === 'object' && 'unref' in capTimer) {
      capTimer.unref()
    }
  }
  void started.then(() => {
    running = true
    armIfHolding()
  })
  // Why: keep the queue alive past a failed run so later entrants still start.
  void run.then(release, release)
  return {
    settled,
    armReleaseCap: () => {
      queuedBehind = true
      armIfHolding()
    }
  }
}
