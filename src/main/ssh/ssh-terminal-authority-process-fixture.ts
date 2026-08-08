// Why: the deploy specs stub establishSshTerminalAuthority. The stub must carry the same
// negotiated compatibility grant a live owner returns, or capability-gated deploy behavior
// silently stops being exercised.
import {
  CURRENT_RELAY_DAEMON_COMPATIBILITY,
  RELAY_DAEMON_PROTOCOL_MAJOR,
  RELAY_DAEMON_PROTOCOL_MINOR,
  type RelayDaemonCompatibilityGrant
} from '../../shared/relay-daemon-compatibility'
import { SSH_TERMINAL_AUTHORITY_MARKER_VERSION } from '../../shared/ssh-terminal-authority-marker'
import type { SshTerminalAuthorityProcess } from './ssh-terminal-authority-process'

/** What a current-version remote owner grants after negotiating against this client's offer. */
export function currentSshTerminalAuthorityGrant(): RelayDaemonCompatibilityGrant {
  return {
    major: RELAY_DAEMON_PROTOCOL_MAJOR,
    minor: RELAY_DAEMON_PROTOCOL_MINOR,
    capabilities: [...CURRENT_RELAY_DAEMON_COMPATIBILITY.capabilities]
  }
}

/** An owner one negotiation older than this client: same protocol, narrower capability set. */
export function sshTerminalAuthorityGrantWithout(
  ...withheld: readonly string[]
): RelayDaemonCompatibilityGrant {
  const grant = currentSshTerminalAuthorityGrant()
  return {
    ...grant,
    capabilities: grant.capabilities.filter((capability) => !withheld.includes(capability))
  }
}

/**
 * Why: specs that exercise the real establishSshTerminalAuthority must answer its marker read with
 * a marker the admission parser accepts, including a negotiable compatibility offer.
 */
export function sshTerminalAuthorityMarkerRead(
  options: Readonly<{ remoteHome: string; relayVersion?: string }>
): string {
  // The admission parser only accepts a content-hashed relay version directory.
  const relayVersion = options.relayVersion ?? '0.1.0+abcdef012345'
  const authorityDir = `${options.remoteHome}/.orca-remote/terminal-authority`
  const marker = {
    markerVersion: SSH_TERMINAL_AUTHORITY_MARKER_VERSION,
    authorityHostId: 'authority-host',
    ownerInstanceId: 'authority-owner',
    ownerPid: 4242,
    ownerProcessToken: 'owner-process-token',
    ownerBuildId: relayVersion,
    ownerRelayDir: `${options.remoteHome}/.orca-remote/relay-${relayVersion}`,
    socketPath: `${authorityDir}/authority.sock`,
    credentialFile: `${authorityDir}/endpoint.credential`,
    compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY,
    revision: 1
  }
  return `ORCA_TERMINAL_AUTHORITY_MARKER_PRESENT\n${JSON.stringify(marker)}\n`
}

/** The bootstrap read's combined home + authority-marker response. */
export function sshTerminalAuthorityBootstrapRead(
  remoteHome: string,
  marker = 'ORCA_TERMINAL_AUTHORITY_MARKER_ABSENT'
): string {
  return `ORCA_TERMINAL_AUTHORITY_HOME\n${remoteHome}\n${marker}\n`
}

/** execCommand responses establishSshTerminalAuthority consumes when it launches a first owner. */
export function sshTerminalAuthorityLaunchExecResponses(
  options: Readonly<{ remoteHome: string; relayVersion?: string }>
): string[] {
  return [
    '', // authority state directory
    '', // publish the per-launch endpoint credential
    'READY', // authority readiness probe
    sshTerminalAuthorityMarkerRead(options) // owner marker discovery after launch
  ]
}

export function makeSshTerminalAuthorityProcess(
  overrides: Partial<SshTerminalAuthorityProcess> & { remoteHome?: string } = {}
): SshTerminalAuthorityProcess {
  const { remoteHome = '/home/user', ...rest } = overrides
  const authorityDir = `${remoteHome}/.orca-remote/terminal-authority`
  return {
    markerPath: `${authorityDir}/active.json`,
    authorityHostId: 'authority-host',
    ownerInstanceId: 'authority-owner',
    revision: 1,
    ownerBuildId: '0.1.0+abcdef012345',
    ownerRelayDir: `${remoteHome}/.orca-remote/relay-0.1.0+abcdef012345`,
    socketPath: `${authorityDir}/authority.sock`,
    credentialFile: `${authorityDir}/endpoint.credential`,
    compatibility: currentSshTerminalAuthorityGrant(),
    ...rest
  }
}
