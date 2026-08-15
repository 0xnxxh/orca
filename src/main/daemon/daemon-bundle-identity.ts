import { getDaemonCommandLine, readVerifiedDaemonPid } from './daemon-pid-identity'
import { PROTOCOL_VERSION } from './types'

export type DaemonLaunchIdentity = 'match' | 'mismatch' | 'unknown'

export async function getDaemonLaunchIdentity(
  runtimeDir: string,
  socketPath: string,
  tokenPath: string,
  expectedEntryPath: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<DaemonLaunchIdentity> {
  const parsedPid = await readVerifiedDaemonPid(runtimeDir, socketPath, tokenPath, protocolVersion)
  if (!parsedPid) {
    return 'unknown'
  }

  if (parsedPid.entryPath) {
    return parsedPid.entryPath === expectedEntryPath ? 'match' : 'mismatch'
  }

  // Why: older pid files did not persist entryPath. The command line still
  // carries daemon-entry.js, so use it to stop dev worktrees from reusing a
  // daemon forked from a deleted sibling checkout. If command-line probing is
  // unavailable, fail open so we don't kill live sessions unnecessarily.
  const commandLine = await getDaemonCommandLine(parsedPid.pid)
  if (!commandLine) {
    return 'unknown'
  }
  return commandLine.includes(expectedEntryPath) ? 'match' : 'mismatch'
}

export async function isDaemonStaleForCurrentBundle(
  runtimeDir: string,
  socketPath: string,
  tokenPath: string,
  currentAppVersion: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<boolean> {
  const parsedPid = await readVerifiedDaemonPid(runtimeDir, socketPath, tokenPath, protocolVersion)
  if (!parsedPid) {
    return false
  }

  if (parsedPid.appVersion !== null) {
    return parsedPid.appVersion !== currentAppVersion
  }

  // Why: older packaged daemons do not carry a reliable build-generation
  // marker. Replacing them once prevents archive-preserved mtimes from
  // reusing stale native modules across the first metadata-aware upgrade.
  return true
}
