import {
  CURRENT_RELAY_DAEMON_COMPATIBILITY,
  negotiateRelayDaemonCompatibility,
  type RelayDaemonCompatibilityGrant
} from '../../shared/relay-daemon-compatibility'
import type { SshTerminalAuthorityMarker } from '../../shared/ssh-terminal-authority-marker'
import type { RemoteHostPlatform } from './ssh-remote-platform'
import type {
  SshTerminalAuthorityDiscovery,
  SshTerminalAuthorityOwnerProof
} from './ssh-terminal-authority-discovery'
import { sshTerminalAuthorityMarkerHasExpectedPaths } from './ssh-terminal-authority-discovery'
import type { SshTerminalAuthorityEndpoint } from './ssh-terminal-authority-endpoint'

export type SshTerminalAuthorityAdmission =
  | Readonly<{ kind: 'launch-first-owner' }>
  | Readonly<{
      kind: 'connect-owner'
      marker: SshTerminalAuthorityMarker
      compatibility: RelayDaemonCompatibilityGrant
    }>

export type SshTerminalAuthorityTakeover = Readonly<{
  ownerProcessToken: string
  revision: number
}>

export type SshTerminalAuthorityAdmissionErrorCode =
  | 'discovery-inconclusive'
  | 'marker-invalid'
  | 'marker-path-mismatch'
  | 'owner-incompatible'
  | 'owner-still-alive'
  | 'owner-proof-inconclusive'
  | 'owner-state-changed'

export class SshTerminalAuthorityAdmissionError extends Error {
  readonly name = 'SshTerminalAuthorityAdmissionError'

  constructor(
    readonly code: SshTerminalAuthorityAdmissionErrorCode,
    message: string
  ) {
    super(message)
  }
}

function reject(code: SshTerminalAuthorityAdmissionErrorCode, message: string): never {
  throw new SshTerminalAuthorityAdmissionError(code, message)
}

function admitMarker(
  marker: SshTerminalAuthorityMarker,
  host: RemoteHostPlatform,
  remoteHome: string,
  endpoint: SshTerminalAuthorityEndpoint
): Extract<SshTerminalAuthorityAdmission, { kind: 'connect-owner' }> {
  if (!sshTerminalAuthorityMarkerHasExpectedPaths(marker, host, remoteHome, endpoint)) {
    reject('marker-path-mismatch', 'Terminal authority marker names an unexpected remote path')
  }
  const compatibility = negotiateRelayDaemonCompatibility(
    marker.compatibility,
    CURRENT_RELAY_DAEMON_COMPATIBILITY
  )
  if (!compatibility) {
    reject('owner-incompatible', 'Terminal authority owner requires an incompatible protocol')
  }
  return { kind: 'connect-owner', marker, compatibility }
}

export function admitSshTerminalAuthority(
  discovery: SshTerminalAuthorityDiscovery,
  host: RemoteHostPlatform,
  remoteHome: string,
  endpoint: SshTerminalAuthorityEndpoint
): SshTerminalAuthorityAdmission {
  if (discovery.status === 'absent') {
    return { kind: 'launch-first-owner' }
  }
  if (discovery.status !== 'available') {
    if (discovery.status === 'invalid') {
      reject('marker-invalid', 'Terminal authority marker is invalid')
    }
    reject('discovery-inconclusive', 'Terminal authority owner could not be read safely')
  }
  return admitMarker(discovery.marker, host, remoteHome, endpoint)
}

function markersEqual(
  expected: SshTerminalAuthorityMarker,
  current: SshTerminalAuthorityMarker
): boolean {
  return JSON.stringify(expected) === JSON.stringify(current)
}

export function admitSshTerminalAuthorityTakeover(args: {
  expectedMarker: SshTerminalAuthorityMarker
  rediscovery: SshTerminalAuthorityDiscovery
  ownerProof: SshTerminalAuthorityOwnerProof
  host: RemoteHostPlatform
  remoteHome: string
  endpoint: SshTerminalAuthorityEndpoint
}): SshTerminalAuthorityTakeover {
  assertSshTerminalAuthorityOwnerUnchanged({
    expectedMarker: args.expectedMarker,
    rediscovery: args.rediscovery,
    host: args.host,
    remoteHome: args.remoteHome,
    endpoint: args.endpoint
  })
  if (args.ownerProof === 'owner-alive') {
    reject('owner-still-alive', 'Terminal authority owner is alive but its endpoint refused')
  }
  if (args.ownerProof !== 'owner-gone') {
    reject('owner-proof-inconclusive', 'Terminal authority owner death could not be proven')
  }
  return {
    ownerProcessToken: args.expectedMarker.ownerProcessToken,
    revision: args.expectedMarker.revision
  }
}

export function assertSshTerminalAuthorityOwnerUnchanged(args: {
  expectedMarker: SshTerminalAuthorityMarker
  rediscovery: SshTerminalAuthorityDiscovery
  host: RemoteHostPlatform
  remoteHome: string
  endpoint: SshTerminalAuthorityEndpoint
}): void {
  const current = admitSshTerminalAuthority(
    args.rediscovery,
    args.host,
    args.remoteHome,
    args.endpoint
  )
  if (current.kind !== 'connect-owner' || !markersEqual(args.expectedMarker, current.marker)) {
    reject('owner-state-changed', 'Terminal authority owner changed during reconnect')
  }
}
