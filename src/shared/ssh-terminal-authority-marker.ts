import {
  parseRelayDaemonCompatibilityOffer,
  type RelayDaemonCompatibilityOffer
} from './relay-daemon-compatibility'

export const SSH_TERMINAL_AUTHORITY_MARKER_VERSION = 1

export type SshTerminalAuthorityMarker = {
  markerVersion: typeof SSH_TERMINAL_AUTHORITY_MARKER_VERSION
  authorityHostId: string
  ownerInstanceId: string
  ownerPid: number
  ownerProcessToken: string
  registryWriterOwnerToken?: string
  ownerBuildId: string
  ownerRelayDir: string
  socketPath: string
  credentialFile: string
  compatibility: RelayDaemonCompatibilityOffer
  revision: number
}

export type SshTerminalAuthorityEndpointIdentity = Pick<
  SshTerminalAuthorityMarker,
  'authorityHostId' | 'ownerInstanceId' | 'revision'
>

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

export function parseSshTerminalAuthorityMarker(value: unknown): SshTerminalAuthorityMarker | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const marker = value as Partial<SshTerminalAuthorityMarker>
  const compatibility = parseRelayDaemonCompatibilityOffer(marker.compatibility)
  if (
    marker.markerVersion !== SSH_TERMINAL_AUTHORITY_MARKER_VERSION ||
    !isBoundedString(marker.authorityHostId, 128) ||
    !isBoundedString(marker.ownerInstanceId, 128) ||
    !Number.isSafeInteger(marker.ownerPid) ||
    Number(marker.ownerPid) <= 0 ||
    !isBoundedString(marker.ownerProcessToken, 128) ||
    (marker.registryWriterOwnerToken !== undefined &&
      !isBoundedString(marker.registryWriterOwnerToken, 1_024)) ||
    !isBoundedString(marker.ownerBuildId, 512) ||
    !isBoundedString(marker.ownerRelayDir, 4_096) ||
    !isBoundedString(marker.socketPath, 4_096) ||
    !isBoundedString(marker.credentialFile, 4_096) ||
    !compatibility ||
    !Number.isSafeInteger(marker.revision) ||
    Number(marker.revision) <= 0
  ) {
    return null
  }
  return {
    ...marker,
    compatibility
  } as SshTerminalAuthorityMarker
}

export function terminalAuthorityEndpointIdentity(
  marker: SshTerminalAuthorityMarker
): SshTerminalAuthorityEndpointIdentity {
  return {
    authorityHostId: marker.authorityHostId,
    ownerInstanceId: marker.ownerInstanceId,
    revision: marker.revision
  }
}

export function parseTerminalAuthorityEndpointIdentity(
  value: unknown
): SshTerminalAuthorityEndpointIdentity | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const identity = value as Partial<SshTerminalAuthorityEndpointIdentity>
  if (
    !isBoundedString(identity.authorityHostId, 128) ||
    !isBoundedString(identity.ownerInstanceId, 128) ||
    !Number.isSafeInteger(identity.revision) ||
    Number(identity.revision) <= 0
  ) {
    return null
  }
  return {
    authorityHostId: identity.authorityHostId,
    ownerInstanceId: identity.ownerInstanceId,
    revision: Number(identity.revision)
  }
}

export function sameTerminalAuthorityEndpointIdentity(
  left: SshTerminalAuthorityEndpointIdentity,
  right: SshTerminalAuthorityEndpointIdentity
): boolean {
  return (
    left.authorityHostId === right.authorityHostId &&
    left.ownerInstanceId === right.ownerInstanceId &&
    left.revision === right.revision
  )
}
