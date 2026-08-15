import type { DaemonEndpointIdentity } from './types'

export function parseDaemonEndpointIdentity(value: unknown): DaemonEndpointIdentity | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const identity = value as {
    pid?: unknown
    startedAtMs?: unknown
    launchNonce?: unknown
    entryPath?: unknown
    appVersion?: unknown
    spawnerExecPath?: unknown
  }
  if (
    !Number.isSafeInteger(identity.pid) ||
    (identity.pid as number) <= 0 ||
    typeof identity.startedAtMs !== 'number' ||
    !Number.isFinite(identity.startedAtMs) ||
    identity.startedAtMs <= 0 ||
    typeof identity.launchNonce !== 'string' ||
    identity.launchNonce.length === 0
  ) {
    return null
  }
  return {
    pid: identity.pid as number,
    startedAtMs: identity.startedAtMs,
    launchNonce: identity.launchNonce,
    ...(typeof identity.entryPath === 'string' && identity.entryPath.length > 0
      ? { entryPath: identity.entryPath }
      : {}),
    ...(typeof identity.appVersion === 'string' && identity.appVersion.length > 0
      ? { appVersion: identity.appVersion }
      : {}),
    ...(typeof identity.spawnerExecPath === 'string' && identity.spawnerExecPath.length > 0
      ? { spawnerExecPath: identity.spawnerExecPath }
      : {})
  }
}

export function sameDaemonIdentity(
  left: DaemonEndpointIdentity | null,
  right: DaemonEndpointIdentity | null
): boolean {
  return (
    (left === null && right === null) ||
    (left !== null &&
      right !== null &&
      left.pid === right.pid &&
      left.startedAtMs === right.startedAtMs &&
      left.launchNonce === right.launchNonce)
  )
}
