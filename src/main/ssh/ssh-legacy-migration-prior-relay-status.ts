import { DEFAULT_PTY_SOURCE_WINDOW_SU } from '../../shared/pty-source-credit-contract'
import type { SshTerminalAuthorityMarker } from '../../shared/ssh-terminal-authority-marker'
import type { TerminalLegacyEndpointIdentity } from '../../shared/terminal-legacy-cutover'
import {
  assertAuthorityId,
  assertAuthorityStoragePath
} from '../../shared/terminal-session-authority-identity'
import type { LegacyPhysicalWorkerDescriptor } from './ssh-legacy-migration-coordinator-types'
import { sshLegacyEvidenceId } from './ssh-legacy-migration-evidence-identity'
import { windowsActivePipeMarkerPath } from './ssh-relay-endpoints'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  remoteBasename,
  remoteDirname,
  type RemoteHostPlatform
} from './ssh-remote-platform'
import type { SshTerminalAuthorityDiscovery } from './ssh-terminal-authority-discovery'
import { TERMINAL_AUTHORITY_SOCKET_NAME } from './ssh-terminal-authority-endpoint'

/** Isolation target for the legacy endpoint; siblings of the legacy relay's own state. */
export const SSH_LEGACY_CUTOVER_PRIVATE_DIRECTORY = '.orca-legacy-cutover'

export type SshLegacyPriorRelayOwner = Readonly<{
  authorityHostId: string
  ownerInstanceId: string
  revision: number
}>

export type SshLegacyPriorRelayStatus =
  /** No prior owner was recorded before this attempt launched its own authority. */
  | Readonly<{ kind: 'none' }>
  /** The recorded prior owner is the owner this attempt attached to; nothing is legacy. */
  | Readonly<{ kind: 'adopted' }>
  /** Evidence exists but cannot identify a prior owner; never treated as absence. */
  | Readonly<{ kind: 'unknown'; reason: string }>
  /** A distinct prior owner was recorded and this attempt superseded it. */
  | Readonly<{ kind: 'superseded'; marker: SshTerminalAuthorityMarker }>

export function resolveSshLegacyPriorRelayStatus(
  input: Readonly<{
    discovery: SshTerminalAuthorityDiscovery
    owner: SshLegacyPriorRelayOwner
  }>
): SshLegacyPriorRelayStatus {
  if (input.discovery.status === 'absent') {
    return Object.freeze({ kind: 'none' })
  }
  if (input.discovery.status !== 'available') {
    return Object.freeze({
      kind: 'unknown',
      reason: `recorded prior relay status is ${input.discovery.status}`
    })
  }
  const marker = input.discovery.marker
  if (marker.authorityHostId !== input.owner.authorityHostId) {
    return Object.freeze({
      kind: 'unknown',
      reason: 'recorded prior relay status names a different authority host'
    })
  }
  if (marker.ownerInstanceId === input.owner.ownerInstanceId) {
    return marker.revision === input.owner.revision
      ? Object.freeze({ kind: 'adopted' })
      : Object.freeze({
          kind: 'unknown',
          reason: 'recorded prior relay status revision does not match the attached owner'
        })
  }
  return Object.freeze({ kind: 'superseded', marker })
}

export type SshLegacyPriorRelayDescriptorInput = Readonly<{
  marker: SshTerminalAuthorityMarker
  hostPlatform: RemoteHostPlatform
  clientInstanceId: string
  requestedSourceWindowSu?: number
  expectedEndpoint: TerminalLegacyEndpointIdentity
}>

/**
 * Why derived and not probed: every field below is already recorded evidence. A wrong derivation
 * cannot silently import — the owning host compares it against what it observes and the mismatch
 * lands in the non-destructive recovery surface.
 */
export function sshLegacyPriorRelayWorkerDescriptor(
  input: SshLegacyPriorRelayDescriptorInput
): LegacyPhysicalWorkerDescriptor {
  const marker = input.marker
  assertAuthorityId(marker.ownerInstanceId, 'prior relay ownerInstanceId')
  assertAuthorityId(marker.ownerProcessToken, 'prior relay ownerProcessToken')
  assertAuthorityId(marker.ownerBuildId, 'prior relay ownerBuildId')
  assertAuthorityStoragePath(marker.ownerRelayDir, 'prior relay ownerRelayDir')
  assertAuthorityStoragePath(marker.socketPath, 'prior relay socketPath')
  assertAuthorityStoragePath(marker.credentialFile, 'prior relay credentialFile')
  assertAuthorityId(input.clientInstanceId, 'prior relay clientInstanceId')
  const host = input.hostPlatform
  const privateStateDirectory = joinRemotePath(
    host,
    marker.ownerRelayDir,
    SSH_LEGACY_CUTOVER_PRIVATE_DIRECTORY
  )
  const base = {
    version: 1 as const,
    workerId: marker.ownerInstanceId,
    routeId: sshLegacyEvidenceId('ssh-legacy-route', [
      marker.authorityHostId,
      marker.ownerInstanceId,
      marker.ownerRelayDir,
      marker.revision
    ]),
    ownerIncarnationId: marker.ownerProcessToken,
    buildId: marker.ownerBuildId,
    clientInstanceId: input.clientInstanceId,
    relayDirectory: marker.ownerRelayDir,
    process: Object.freeze({ pid: marker.ownerPid, birthMarker: marker.ownerProcessToken }),
    expectedEndpoint: input.expectedEndpoint,
    requestedSourceWindowSu: input.requestedSourceWindowSu ?? DEFAULT_PTY_SOURCE_WINDOW_SU,
    publicCredentialFile: marker.credentialFile,
    privateCredentialFile: joinRemotePath(
      host,
      privateStateDirectory,
      remoteBasename(marker.credentialFile, host)
    ),
    privateStateDirectory
  }
  if (!isWindowsRemoteHost(host)) {
    return Object.freeze({
      ...base,
      platform: host.os === 'darwin' ? ('darwin' as const) : ('linux' as const),
      publicSocketPath: marker.socketPath,
      privateSocketPath: joinRemotePath(
        host,
        privateStateDirectory,
        remoteBasename(marker.socketPath, host)
      )
    })
  }
  const activePipeMarkerPath = windowsActivePipeMarkerPath(
    host,
    remoteDirname(marker.credentialFile, host),
    TERMINAL_AUTHORITY_SOCKET_NAME
  )
  return Object.freeze({
    ...base,
    platform: 'win32' as const,
    pipeName: marker.socketPath,
    activePipeMarkerPath,
    privateActivePipeMarkerPath: joinRemotePath(
      host,
      privateStateDirectory,
      remoteBasename(activePipeMarkerPath, host)
    )
  })
}

/**
 * The Windows endpoint is a named pipe, so its identity is fully recorded: the pipe path in the
 * marker plus the owner's process token the marker was published with.
 */
export function sshLegacyPriorRelayWindowsEndpoint(
  marker: SshTerminalAuthorityMarker
): TerminalLegacyEndpointIdentity {
  return Object.freeze({
    kind: 'windows-named-pipe',
    pipeName: marker.socketPath,
    processCreationMarker: marker.ownerProcessToken
  })
}
