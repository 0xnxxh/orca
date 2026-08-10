import type { PtySpawnResult } from '../providers/pty-spawn-result'
import { wslHookRelayManager } from './wsl-hook-relay-manager'

type ReattachResult = Pick<PtySpawnResult, 'isReattach' | 'wslDistro'>

export const WSL_HOOK_RELAY_REATTACH_FAIL_OPEN_MS = 60_000

export async function ensureWslHookRelayForReattach(
  result: ReattachResult,
  connectionId?: string | null,
  ensureForDistro: (distro: string) => void | Promise<void> = (distro) =>
    wslHookRelayManager.ensureForDistroReady(distro)
): Promise<void> {
  // Why: the current renderer preference can differ from the surviving PTY's proven distro ownership.
  if (connectionId || result.isReattach !== true || typeof result.wslDistro !== 'string') {
    return
  }
  const distro = result.wslDistro.trim()
  if (distro) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.resolve().then(() => ensureForDistro(distro)),
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            console.warn(`[agent-hooks] WSL hook relay reattach timed out for '${distro}'`)
            resolve()
          }, WSL_HOOK_RELAY_REATTACH_FAIL_OPEN_MS)
        })
      ])
    } catch (error) {
      console.warn(`[agent-hooks] WSL hook relay reattach failed for '${distro}':`, error)
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }
}
