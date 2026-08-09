import type { PtySpawnResult } from '../providers/pty-spawn-result'
import { wslHookRelayManager } from './wsl-hook-relay-manager'

type ReattachResult = Pick<PtySpawnResult, 'isReattach' | 'wslDistro'>

export function ensureWslHookRelayForReattach(
  result: ReattachResult,
  connectionId: string | null | undefined,
  agentStatusHooksEnabled: boolean,
  ensureForDistro: (distro: string) => void = (distro) =>
    wslHookRelayManager.ensureForDistro(distro)
): void {
  // Why: reattach honors the same hooks gate as spawn; otherwise a disabled setting reinstalls the guest relay.
  if (!agentStatusHooksEnabled) {
    return
  }
  // Why: the current renderer preference can differ from the surviving PTY's proven distro ownership.
  if (connectionId || result.isReattach !== true || typeof result.wslDistro !== 'string') {
    return
  }
  const distro = result.wslDistro.trim()
  if (distro) {
    ensureForDistro(distro)
  }
}
