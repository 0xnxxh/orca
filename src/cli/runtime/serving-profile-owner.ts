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

export function serveAlreadyRunningMessage(owner: ServingProfileOwner): string {
  const who = owner.pid === null ? 'another process' : `pid ${owner.pid}`
  const qualifier = owner.reachable ? '' : ' (starting up)'
  return `[serve] Orca is already running for this userData profile as ${who}${qualifier}; not starting a second process. Run \`orca status\` to inspect it, or stop it before serving again.`
}

/**
 * Why: `--json` and `--recipe-json` callers parse stdout. A refusal that only
 * writes prose to stderr looks to them like a serve that produced nothing.
 */
export function serveAlreadyRunningFailure(owner: ServingProfileOwner): RuntimeRpcFailure {
  return {
    id: 'local',
    ok: false,
    error: {
      code: 'runtime_serve_already_running',
      message: serveAlreadyRunningMessage(owner),
      data: { pid: owner.pid, reachable: owner.reachable }
    },
    _meta: { runtimeId: null }
  }
}
