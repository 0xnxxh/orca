import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import type { RuntimeRpcFailure } from '../../shared/runtime-rpc-envelope'
import type { CliStatusResult } from '../../shared/runtime-types'
import { probeRuntimeListener } from './runtime-listener-probe'

/** How the owner proved it is alive, strongest first. */
export type ServingProfileOwnerEvidence = 'rpc' | 'listening'

export type ServingProfileOwner = {
  pid: number | null
  evidence: ServingProfileOwnerEvidence
}

/**
 * Why: the "one Orca per profile" rule lives in the Electron main, past the
 * NSApplication init that aborts pre-JS when Launch Services is unreachable
 * (STA-4336) — so the CLI has to decide before the exec.
 *
 * Ownership is asserted only on a runtime answering for itself: an RPC reply, or a
 * socket that still accepts. A recycled pid would otherwise refuse serve forever.
 */
export async function findServingProfileOwner(
  status: CliStatusResult,
  metadata: RuntimeMetadata | null,
  probeListener: (metadata: RuntimeMetadata) => Promise<boolean> = probeRuntimeListener
): Promise<ServingProfileOwner | null> {
  const pid = status.app.pid ?? metadata?.pid ?? null
  if (status.runtime.reachable) {
    return { pid, evidence: 'rpc' }
  }
  if (metadata && (await probeListener(metadata))) {
    return { pid, evidence: 'listening' }
  }
  return null
}

/** Why: name the owner and the next step that applies to it — a refusal the user cannot act on is worse than the duplicate. */
export function serveAlreadyRunningMessage(owner: ServingProfileOwner): string {
  const who = owner.pid === null ? 'another process' : `pid ${owner.pid}`
  const lead = `[serve] Orca is already running for this userData profile as ${who}`
  if (owner.evidence === 'rpc') {
    return `${lead}; not starting a second process. Run \`orca status\` to inspect it, or stop it before serving again.`
  }
  return `${lead} — its socket is accepting connections but it is not answering \`orca status\` yet; not starting a second process. Wait for it to finish starting, or stop it before serving again.`
}

/**
 * Why: `--json` callers parse stdout. A refusal that only writes prose to stderr
 * looks to them like a serve that produced nothing.
 */
export function serveAlreadyRunningFailure(owner: ServingProfileOwner): RuntimeRpcFailure {
  return {
    id: 'local',
    ok: false,
    error: {
      code: 'runtime_serve_already_running',
      message: serveAlreadyRunningMessage(owner),
      data: { pid: owner.pid, evidence: owner.evidence }
    },
    _meta: { runtimeId: null }
  }
}
