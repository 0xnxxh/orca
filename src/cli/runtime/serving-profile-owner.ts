import type { RuntimeRpcFailure } from '../../shared/runtime-rpc-envelope'
import type { CliStatusResult } from '../../shared/runtime-types'

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
export function findServingProfileOwner(status: CliStatusResult): ServingProfileOwner | null {
  if (!status.app.running) {
    return null
  }
  return { pid: status.app.pid, reachable: status.runtime.reachable }
}

/**
 * Why: an unreachable owner is believed on the strength of its recorded pid, and
 * a pid the OS has since recycled would refuse forever. Naming the file that
 * holds the claim is the only recovery instruction that always works.
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
 * Why: `--json` and `--recipe-json` callers parse stdout. A refusal that only
 * writes prose to stderr looks to them like a serve that produced nothing.
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
