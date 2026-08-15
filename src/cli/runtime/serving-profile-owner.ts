import type { RuntimeRpcFailure } from '../../shared/runtime-rpc-envelope'
import type { CliStatusResult } from '../../shared/runtime-types'

/**
 * Why: an unreachable owner is believed on its recorded pid alone, and pids get
 * recycled. Bounding that belief to a plausible startup window keeps a crashed
 * runtime whose pid was reused from refusing every serve on the profile forever.
 */
export const STARTING_OWNER_TRUST_WINDOW_MS = 120_000

export type ServingProfileOwner = {
  pid: number | null
  /** True when the owner answered RPC; false when only its pid proved alive. */
  reachable: boolean
}

/**
 * Why: the "one Orca per userData profile" rule is enforced inside the Electron
 * main, which on macOS creates NSApplication before any JS runs. When Launch
 * Services is unreachable that constructor aborts, so the rule never gets a
 * chance to apply and the duplicate launch dies via SIGABRT instead of exiting
 * cleanly (STA-4336). Deciding here — in the CLI, before the exec — keeps the
 * contract on the safe side of that boundary.
 */
export function findServingProfileOwner(
  status: CliStatusResult,
  startedAt: number | null,
  now: number = Date.now()
): ServingProfileOwner | null {
  if (!status.app.running) {
    return null
  }
  const owner = { pid: status.app.pid, reachable: status.runtime.reachable }
  if (owner.reachable) {
    return owner
  }
  // A future `startedAt` (clock skew) stays inside the window on purpose.
  const startingFor = now - (startedAt ?? now)
  return startingFor > STARTING_OWNER_TRUST_WINDOW_MS ? null : owner
}

/**
 * Why: an owner trusted on its pid alone still needs an escape hatch, because
 * the pid is the only thing standing between the user and a refusal they cannot
 * otherwise explain. Naming the file that holds the claim always works.
 */
export function serveAlreadyRunningMessage(
  owner: ServingProfileOwner,
  metadataPath: string
): string {
  const who = owner.pid === null ? 'another process' : `pid ${owner.pid}`
  if (owner.reachable) {
    return `[serve] Orca is already running for this userData profile as ${who}; not starting a second process. Run \`orca status\` to inspect it, or stop it before serving again.`
  }
  return `[serve] Orca is already starting up for this userData profile as ${who}; not starting a second process. Run \`orca status\` to inspect it, or stop it before serving again. If that process is gone, delete ${metadataPath} and retry.`
}

/**
 * Why: `--json` callers parse stdout. A refusal that only writes prose to stderr
 * looks to them like a serve that produced nothing.
 */
export function serveAlreadyRunningFailure(
  owner: ServingProfileOwner,
  metadataPath: string
): RuntimeRpcFailure {
  return {
    id: 'local',
    ok: false,
    error: {
      code: 'runtime_serve_already_running',
      message: serveAlreadyRunningMessage(owner, metadataPath),
      data: { pid: owner.pid, reachable: owner.reachable, metadataPath }
    },
    _meta: { runtimeId: null }
  }
}
