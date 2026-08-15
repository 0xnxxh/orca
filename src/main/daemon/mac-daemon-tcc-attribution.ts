import { existsSync, readFileSync } from 'node:fs'
import { getDaemonPidPath } from './daemon-spawner'
import { parseDaemonPidFile } from './daemon-pid-record'
import { readVerifiedDaemonPid } from './daemon-pid-identity'
import { PROTOCOL_VERSION } from './types'

// 'severed': macOS can no longer resolve the daemon's TCC responsible process, so
// Accessibility/Automation grants on Orca silently stop covering its terminals (STA-3491).
// 'unknown' fails open: legacy pid files and probe failures must not trigger replacement.
export type MacDaemonTccAttributionHealth = 'intact' | 'severed' | 'unknown'

let cachedMacDaemonTccAttributionHealth: {
  key: string
  pending: Promise<MacDaemonTccAttributionHealth>
} | null = null

function getMacDaemonTccAttributionCacheKey(
  runtimeDir: string,
  socketPath: string,
  tokenPath: string,
  packagedAppVersion: string | null,
  protocolVersion: number
): string | null {
  try {
    const pidRecord = readFileSync(getDaemonPidPath(runtimeDir, protocolVersion), 'utf8')
    const parsedPid = parseDaemonPidFile(pidRecord)
    if (!parsedPid) {
      return null
    }
    const spawnerExists = parsedPid.spawnerExecPath ? existsSync(parsedPid.spawnerExecPath) : null
    return JSON.stringify([
      socketPath,
      tokenPath,
      packagedAppVersion,
      protocolVersion,
      pidRecord,
      spawnerExists
    ])
  } catch {
    return null
  }
}

/**
 * macOS pins a process's TCC "responsible process" to the binary that forked it,
 * by file reference. The detached daemon outlives that app instance, and once the
 * spawning binary is deleted (every packaged update replaces the bundle) tccd
 * can't resolve the grant subject — `osascript`/System Events from every terminal
 * hosted by that daemon is silently denied (-25211) no matter what the user grants.
 */
export async function getMacDaemonTccAttributionHealth(
  runtimeDir: string,
  socketPath: string,
  tokenPath: string,
  packagedAppVersion: string | null,
  protocolVersion = PROTOCOL_VERSION
): Promise<MacDaemonTccAttributionHealth> {
  if (process.platform !== 'darwin') {
    return 'unknown'
  }
  const cacheKey = getMacDaemonTccAttributionCacheKey(
    runtimeDir,
    socketPath,
    tokenPath,
    packagedAppVersion,
    protocolVersion
  )
  if (cacheKey && cachedMacDaemonTccAttributionHealth?.key === cacheKey) {
    return await cachedMacDaemonTccAttributionHealth.pending
  }

  const pending = (async (): Promise<MacDaemonTccAttributionHealth> => {
    const parsedPid = await readVerifiedDaemonPid(
      runtimeDir,
      socketPath,
      tokenPath,
      protocolVersion
    )
    if (!parsedPid) {
      return 'unknown'
    }
    // Packaged updates can replace the bundle at the same path; missing version
    // metadata also identifies a daemon from before the current packaged generation.
    if (packagedAppVersion !== null && parsedPid.appVersion !== packagedAppVersion) {
      return 'severed'
    }
    if (parsedPid.spawnerExecPath) {
      return existsSync(parsedPid.spawnerExecPath) ? 'intact' : 'severed'
    }
    return 'unknown'
  })()
  if (cacheKey) {
    cachedMacDaemonTccAttributionHealth = { key: cacheKey, pending }
  }
  const health = await pending
  if (
    health === 'unknown' &&
    cachedMacDaemonTccAttributionHealth?.key === cacheKey &&
    cachedMacDaemonTccAttributionHealth.pending === pending
  ) {
    cachedMacDaemonTccAttributionHealth = null
  }
  return health
}
